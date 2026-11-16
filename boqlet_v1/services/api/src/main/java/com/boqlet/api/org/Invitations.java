package com.boqlet.api.org;

import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.Ids;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.identity.IdentityService;
import com.boqlet.contract.model.InviteMemberRequest;
import com.boqlet.contract.model.Membership;
import com.boqlet.contract.model.OrgInvitation;
import com.boqlet.contract.model.OrgRole;
import com.boqlet.contract.model.PreviewOrgInvitation200Response;
import com.boqlet.contract.model.UserRef;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import static com.boqlet.contract.model.OrgRole.ADMIN;
import static com.boqlet.contract.model.OrgRole.OWNER;

@Service
public class Invitations {
    private static final String SELECT = """
            SELECT i.*, o.name AS org_name, o.status AS org_status, u.name AS inviter_name, u.email AS inviter_email,
                   CASE WHEN i.status = 'pending' AND i.expires_at <= now() THEN 'expired'
                        ELSE i.status END AS effective_status
            FROM org_invitations i JOIN orgs o ON o.id = i.org_id
            JOIN users u ON u.id = i.invited_by WHERE o.status <> 'deleting'
            """;
    private final JdbcTemplate database;
    private final OrgAccess access;
    private final Orgs orgs;
    private final IdentityService identities;
    private final EntitlementService limits;
    private final byte[] deliverySecret;

    Invitations(JdbcTemplate database, OrgAccess access, Orgs orgs, IdentityService identities, EntitlementService limits,
                @Value("${boqlet.auth.invitation-secret:}") String secret) {
        this.database = database;
        this.access = access;
        this.orgs = orgs;
        this.identities = identities;
        this.limits = limits;
        this.deliverySecret = secret.getBytes(StandardCharsets.UTF_8);
    }

    public List<OrgInvitation> list(UUID org, UUID actor) {
        OrgAccess.checkRole(access.require(org, actor).role(), OWNER, ADMIN);
        return database.query(SELECT + " AND i.org_id = ? AND i.status <> 'revoked' ORDER BY i.created_at, i.id",
                Invitations::map, org).stream().map(Row::invitation).toList();
    }

    @Transactional
    public OrgInvitation invite(UUID org, UUID actor, InviteMemberRequest request) {
        var scope = access.lock(org, actor, OWNER, ADMIN);
        if (request.getRole() == OWNER) OrgAccess.checkRole(scope.role(), OWNER);
        String email = request.getEmail().strip().toLowerCase(Locale.ROOT);
        if (exists("""
                SELECT EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.org_id = ? AND lower(u.email) = ?)
                """, org, email)) {
            throw Orgs.failure(HttpStatus.CONFLICT, "already_member", "This address already belongs to a member.");
        }
        if (exists("""
                SELECT EXISTS (SELECT 1 FROM org_invitations WHERE org_id = ? AND lower(email) = ?
                AND status = 'pending' AND expires_at > now())
                """, org, email)) {
            throw Orgs.failure(HttpStatus.CONFLICT, "already_invited", "This address already has a pending invitation.");
        }
        limits.checkCapacity(org, actor, "seats", limits.seats(org));
        UUID id = Ids.newId();
        UUID nonce = UUID.randomUUID();
        database.update("""
                INSERT INTO org_invitations (id, org_id, email, role, token_hash, expires_at, invited_by, delivery_nonce)
                VALUES (?, ?, ?, ?, ?, now() + interval '14 days', ?, ?)
                """, id, org, email, request.getRole().getValue(), hash(deliveryToken(id, nonce)), actor, nonce);
        orgs.enqueueEmail(org, "invitation", id, email, Map.of("nonce", nonce));
        orgs.record(org, actor, "member.invited", "invitation", id, Map.of("email", email, "role", request.getRole().getValue()));
        return get(org, id).invitation();
    }

    @Transactional
    public OrgInvitation resend(UUID org, UUID actor, UUID id) {
        var scope = access.lock(org, actor, OWNER, ADMIN);
        Row row = get(org, id);
        if (row.invitation().getRole() == OWNER) OrgAccess.checkRole(scope.role(), OWNER);
        if (!row.storedStatus().equals("pending")) throw invalidStatus(row.storedStatus());
        if (row.invitation().getStatus() == OrgInvitation.StatusEnum.EXPIRED) {
            limits.checkCapacity(org, actor, "seats", limits.seats(org));
            if (exists("""
                    SELECT EXISTS (SELECT 1 FROM org_invitations WHERE org_id = ? AND lower(email) = ?
                    AND status = 'pending' AND expires_at > now())
                    """, org, row.invitation().getEmail())) {
                throw Orgs.failure(HttpStatus.CONFLICT, "already_invited", "This address already has a pending invitation.");
            }
        }
        UUID nonce = UUID.randomUUID();
        database.update("""
                UPDATE org_invitations SET token_hash = ?, delivery_nonce = ?, expires_at = now() + interval '14 days',
                                           updated_at = now()
                WHERE id = ?
                """, hash(deliveryToken(id, nonce)), nonce, id);
        cancelDelivery(org, id);
        orgs.enqueueEmail(org, "invitation", id, row.invitation().getEmail(), Map.of("nonce", nonce));
        orgs.record(org, actor, "member.invitation_resent", "invitation", id, Map.of("email", row.invitation().getEmail()));
        return get(org, id).invitation();
    }

    @Transactional
    public void revoke(UUID org, UUID actor, UUID id) {
        var scope = access.lock(org, actor, OWNER, ADMIN);
        Row row = get(org, id);
        if (row.invitation().getRole() == OWNER) OrgAccess.checkRole(scope.role(), OWNER);
        if (row.storedStatus().equals("pending")) {
            database.update("UPDATE org_invitations SET status = 'revoked', updated_at = now() WHERE id = ?", id);
            cancelDelivery(org, id);
            orgs.record(org, actor, "member.invitation_revoked", "invitation", id, Map.of("email", row.invitation().getEmail()));
        }
    }

    public PreviewOrgInvitation200Response preview(String token) {
        Row row = byToken(token);
        var invite = row.invitation();
        return new PreviewOrgInvitation200Response(row.orgName(), invite.getEmail(), invite.getRole(),
                PreviewOrgInvitation200Response.StatusEnum.fromValue(invite.getStatus().getValue()));
    }

    @Transactional
    public Membership accept(String token, UUID actor) {
        access.lockOrg(byToken(token).org());
        Row row = byToken(token);
        OrgInvitation invite = row.invitation();
        if (row.orgStatus().equals("suspended")) {
            throw Orgs.failure(HttpStatus.CONFLICT, "org_suspended", "The organisation is suspended.");
        }
        if (invite.getStatus() != OrgInvitation.StatusEnum.PENDING) throw invalidStatus(invite.getStatus().getValue());
        if (!invite.getEmail().equalsIgnoreCase(identities.user(actor).getEmail())) {
            throw new ApiException(HttpStatus.CONFLICT, "email_mismatch",
                    "The invitation was sent to another email address.", Map.of("invitedEmail", invite.getEmail()));
        }
        int joined = database.update("""
                INSERT INTO memberships (org_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING
                """, row.org(), actor, invite.getRole().getValue());
        if (joined == 0) throw Orgs.failure(HttpStatus.CONFLICT, "already_member", "You already belong to this organisation.");
        database.update("UPDATE org_invitations SET status = 'accepted', updated_at = now() WHERE id = ?", invite.getId());
        cancelDelivery(row.org(), invite.getId());
        orgs.record(row.org(), actor, "member.joined", "user", actor,
                Map.of("role", invite.getRole().getValue(), "invitationId", invite.getId()));
        return orgs.member(row.org(), actor);
    }

    public String deliveryToken(UUID invitation, UUID nonce) {
        if (deliverySecret.length < 32) throw Orgs.failure(HttpStatus.SERVICE_UNAVAILABLE, "invitation_unavailable",
                "Invitation delivery is not configured.");
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(deliverySecret, "HmacSHA256"));
            byte[] bytes = mac.doFinal((invitation + ":" + nonce).getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("Cannot sign invitation.", failure);
        }
    }

    private static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("Cannot hash invitation.", failure);
        }
    }

    private boolean exists(String query, UUID org, String email) {
        return Boolean.TRUE.equals(database.queryForObject(query, Boolean.class, org, email));
    }

    private Row byToken(String token) {
        if (!token.matches("[A-Za-z0-9_-]{43}")) throw OrgAccess.missing("invitation");
        return database.query(SELECT + " AND i.token_hash = ?", Invitations::map, hash(token))
                .stream().findFirst().orElseThrow(() -> OrgAccess.missing("invitation"));
    }

    private Row get(UUID org, UUID id) {
        return database.query(SELECT + " AND i.org_id = ? AND i.id = ?", Invitations::map, org, id)
                .stream().findFirst().orElseThrow(() -> OrgAccess.missing("invitation"));
    }

    private void cancelDelivery(UUID org, UUID invitation) {
        database.update("""
                UPDATE email_outbox SET canceled_at = now() WHERE org_id = ? AND entity_id = ?
                AND kind = 'invitation' AND sent_at IS NULL AND canceled_at IS NULL
                """, org, invitation);
    }

    private static ApiException invalidStatus(String status) {
        return new ApiException(HttpStatus.CONFLICT, "invalid_transition",
                "The invitation is " + status + ".", Map.of("status", status));
    }

    private static Row map(ResultSet row, int ignored) throws SQLException {
        var invite = new OrgInvitation(row.getObject("id", UUID.class), row.getString("email"),
                OrgRole.fromValue(row.getString("role")), OrgInvitation.StatusEnum.fromValue(row.getString("effective_status")),
                row.getObject("expires_at", OffsetDateTime.class))
                .invitedBy(new UserRef(row.getObject("invited_by", UUID.class), row.getString("inviter_name"))
                        .email(row.getString("inviter_email")));
        return new Row(row.getObject("org_id", UUID.class), row.getString("org_name"), row.getString("org_status"),
                row.getString("status"), invite);
    }

    private record Row(UUID org, String orgName, String orgStatus, String storedStatus, OrgInvitation invitation) {}
}
