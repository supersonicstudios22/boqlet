package com.boqlet.api.org;

import com.boqlet.api.audit.AuditReader;
import com.boqlet.api.identity.Login;
import com.boqlet.api.http.Idempotency;
import com.boqlet.contract.api.OrgsApi;
import com.boqlet.contract.model.*;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
class OrgController implements OrgsApi {
    private final OrgAccess access;
    private final Orgs orgs;
    private final Invitations invitations;
    private final AuditReader audit;
    private final Attention attention;
    private final Idempotency idempotency;

    OrgController(OrgAccess access, Orgs orgs, Invitations invitations, AuditReader audit, Attention attention,
                  Idempotency idempotency) {
        this.access = access;
        this.orgs = orgs;
        this.invitations = invitations;
        this.audit = audit;
        this.attention = attention;
        this.idempotency = idempotency;
    }

    @Override
    public ResponseEntity<List<Org>> listOrgs() {
        return ResponseEntity.ok(access.list(actor()).stream().map(OrgAccess.MemberOrg::org).toList());
    }

    @Override
    public ResponseEntity<Org> createOrg(OrgCreate request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(orgs.create(actor(), request));
    }

    @Override
    public ResponseEntity<Org> getOrg(UUID org) {
        return ResponseEntity.ok(access.require(org, actor()).org());
    }

    @Override
    public ResponseEntity<Org> updateOrg(UUID org, OrgUpdate request) {
        return ResponseEntity.ok(orgs.update(org, actor(), request));
    }

    @Override
    public ResponseEntity<Void> deleteOrg(UUID org, DeleteOrgRequest request) {
        orgs.delete(org, actor(), request.getConfirmName());
        return ResponseEntity.accepted().build();
    }

    @Override
    public ResponseEntity<OrgSetup> getOrgSetup(UUID org) {
        OrgSetup setup = access.require(org, actor()).org().getSetup();
        return setup == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(setup);
    }

    @Override
    public ResponseEntity<OrgSetup> putOrgSetup(UUID org, OrgSetupUpdate request) {
        return ResponseEntity.ok(orgs.setup(org, actor(), request));
    }

    @Override
    public ResponseEntity<List<Membership>> listMembers(UUID org) {
        return ResponseEntity.ok(orgs.members(org, actor()));
    }

    @Override
    public ResponseEntity<Membership> updateMember(UUID org, UUID user, UpdateMemberRequest request) {
        return ResponseEntity.ok(orgs.changeRole(org, actor(), user, request.getRole()));
    }

    @Override
    public ResponseEntity<Void> removeMember(UUID org, UUID user) {
        orgs.removeMember(org, actor(), user);
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<List<OrgInvitation>> listOrgInvitations(UUID org) {
        return ResponseEntity.ok(invitations.list(org, actor()));
    }

    @Override
    public ResponseEntity<OrgInvitation> inviteMember(UUID org, InviteMemberRequest request) {
        UUID actor = actor();
        return ResponseEntity.status(HttpStatus.CREATED).body(idempotency.once(actor, idempotency.key(), 201, OrgInvitation.class,
                () -> access.lock(org, actor, OrgRole.OWNER, OrgRole.ADMIN), () -> invitations.invite(org, actor, request)));
    }

    @Override
    public ResponseEntity<OrgInvitation> resendOrgInvitation(UUID org, UUID id) {
        UUID actor = actor();
        return ResponseEntity.ok(idempotency.once(actor, idempotency.key(), 200, OrgInvitation.class,
                () -> access.lock(org, actor, OrgRole.OWNER, OrgRole.ADMIN), () -> invitations.resend(org, actor, id)));
    }

    @Override
    public ResponseEntity<Void> revokeOrgInvitation(UUID org, UUID id) {
        invitations.revoke(org, actor(), id);
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<PreviewOrgInvitation200Response> previewOrgInvitation(String token) {
        return ResponseEntity.ok(invitations.preview(token));
    }

    @Override
    public ResponseEntity<Membership> acceptOrgInvitation(String token) {
        return ResponseEntity.ok(invitations.accept(token, actor()));
    }

    @Override
    public ResponseEntity<AuditPage> listOrgAudit(UUID org, String cursor, Integer limit, String actorId, String action,
                                                 String entityType, OffsetDateTime from, OffsetDateTime to) {
        OrgAccess.checkRole(access.require(org, actor()).role(), OrgRole.OWNER, OrgRole.ADMIN);
        return ResponseEntity.ok(audit.page(org, null, cursor, limit, actorId, action, entityType, from, to));
    }

    @Override
    public ResponseEntity<List<AttentionItem>> getAttention(UUID org) {
        return ResponseEntity.ok(attention.list(org, actor()));
    }

    private static UUID actor() {
        return Login.current().userId();
    }
}
