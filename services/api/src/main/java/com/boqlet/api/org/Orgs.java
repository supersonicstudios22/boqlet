package com.boqlet.api.org;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.identity.IdentityService;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import static com.boqlet.contract.model.OrgRole.*;

@Service
public class Orgs {
    private static final Set<String> RESERVED = Set.of("admin", "account", "api", "app", "invite",
            "notifications", "onboarding", "s", "session-conflict", "sign-in", "sign-up", "settings",
            "help", "support", "docs", "status", "www", "static", "public", "areas");
    private static final Map<String, Object> DEFAULT_SETTINGS = Map.of(
            "fourEyes", false, "approvalRequired", false, "publicLinksAllowed", true,
            "defaultLocale", "en", "defaultLanguage", "en", "defaultCurrency", "EUR", "defaultUnitSystem", "metric",
            "numberFormat", Map.of("decimal", ".", "thousands", "\u202f"));

    private final JdbcTemplate database;
    private final OrgAccess access;
    private final StoredJson json;
    private final IdentityService identities;
    private final AuditWriter audit;
    private final EntitlementService limits;

    Orgs(JdbcTemplate database, OrgAccess access, StoredJson json, IdentityService identities, AuditWriter audit,
         EntitlementService limits) {
        this.database = database;
        this.access = access;
        this.json = json;
        this.identities = identities;
        this.audit = audit;
        this.limits = limits;
    }

    @Transactional
    public Org create(UUID actor, OrgCreate request) {
        checkSlug(request.getSlug());
        String name = name(request.getName());
        UUID org = Ids.newId();
        ObjectNode settings = merge(json.object(DEFAULT_SETTINGS), request.getSettings());
        String plan = database.queryForObject("SELECT id FROM plans WHERE default_plan", String.class);
        if (approvalEnabled(settings)) limits.requirePlanFeature(plan, "approvalWorkflow");
        int created = database.update("""
                INSERT INTO orgs (id, name, slug, settings) VALUES (?, ?, ?, CAST(? AS jsonb))
                ON CONFLICT (slug) DO NOTHING
                """, org, name, request.getSlug(), settings.toString());
        if (created == 0) throw slugTaken(request.getSlug());
        database.update("INSERT INTO memberships (org_id, user_id, role) VALUES (?, ?, 'owner')", org, actor);
        database.update("INSERT INTO subscriptions (org_id, plan_id) VALUES (?, ?)", org, plan);
        record(org, actor, "org.created", "org", org, Map.of("name", name, "slug", request.getSlug()));
        return access.require(org, actor).org();
    }

    @Transactional
    public Org update(UUID org, UUID actor, OrgUpdate request) {
        Org current = access.lock(org, actor, OWNER, ADMIN).org();
        String slug = request.getSlug() == null ? current.getSlug() : request.getSlug();
        if (!slug.equals(current.getSlug())) checkSlug(slug);
        String displayName = request.getName() == null ? current.getName() : name(request.getName());
        ObjectNode settings = merge(json.object(current.getSettings()), request.getSettings());
        if (approvalEnabled(settings) && !approvalEnabled(json.object(current.getSettings()))) {
            limits.requireFeature(org, actor, "approvalWorkflow");
        }
        try {
            database.update("""
                    UPDATE orgs SET name = ?, slug = ?, settings = CAST(? AS jsonb), updated_at = now() WHERE id = ?
                    """, displayName, slug, settings.toString(), org);
        } catch (DuplicateKeyException failure) {
            throw slugTaken(slug);
        }
        record(org, actor, "org.updated", "org", org, changes(current, displayName, slug, settings));
        return access.require(org, actor).org();
    }

    @Transactional
    public void delete(UUID org, UUID actor, String confirmation) {
        Org current = access.lock(org, actor, OWNER).org();
        if (!current.getName().equals(confirmation)) {
            throw failure(HttpStatus.BAD_REQUEST, "confirm_mismatch", "Type the organisation's name to confirm.");
        }
        database.update("UPDATE orgs SET status = 'deleting', deleting_at = now(), updated_at = now() WHERE id = ?", org);
        database.update("""
                UPDATE jobs SET cancel_requested = true, status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
                    finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END
                WHERE org_id = ? AND status IN ('queued','running')
                """, org);
        database.update("""
                UPDATE email_outbox SET canceled_at = now()
                WHERE org_id = ? AND sent_at IS NULL AND canceled_at IS NULL AND kind = 'invitation'
                """, org);
        database.queryForList("""
                SELECT u.email FROM users u JOIN memberships m ON m.user_id = u.id
                WHERE m.org_id = ? AND u.deleted_at IS NULL
                """, String.class, org).forEach(email -> enqueueEmail(org, "org_deleted", org, email,
                        Map.of("orgName", current.getName())));
        record(org, actor, "org.deleted", "org", org, Map.of());
    }

    @Transactional
    public OrgSetup setup(UUID org, UUID actor, OrgSetupUpdate update) {
        var current = access.lock(org, actor, OWNER, ADMIN, LIBRARY_EDITOR).org().getSetup();
        var now = OffsetDateTime.now(ZoneOffset.UTC);
        if (current == null) {
            User by = identities.user(actor);
            current = new OrgSetup(OrgSetup.StatusEnum.IN_PROGRESS, OrgSetup.StepEnum.START, now)
                    .startedBy(new UserRef(by.getId(), by.getName()).email(by.getEmail()));
        }
        boolean wasDone = current.getStatus() == OrgSetup.StatusEnum.DONE;
        if (update.getStatus() != null) current.setStatus(OrgSetup.StatusEnum.fromValue(update.getStatus().getValue()));
        if (update.getStep() != null) current.setStep(OrgSetup.StepEnum.fromValue(update.getStep().getValue()));
        if (update.getModelVersionId().isPresent()) current.setModelVersionId(update.getModelVersionId().get());
        if (update.getRuleSetPresetId() != null) current.setRuleSetPresetId(update.getRuleSetPresetId());
        if (update.getClassificationPresetId() != null) current.setClassificationPresetId(update.getClassificationPresetId());
        if (update.getDictionaryPresetId() != null) current.setDictionaryPresetId(update.getDictionaryPresetId());
        current.setUpdatedAt(now);
        if (current.getStatus() == OrgSetup.StatusEnum.IN_PROGRESS) current.setCompletedAt(null);
        if (current.getStatus() == OrgSetup.StatusEnum.DONE && !wasDone) {
            current.setCompletedAt(now);
            record(org, actor, "org.setup_done", "org", org, Map.of());
        }
        database.update("UPDATE orgs SET setup = CAST(? AS jsonb), updated_at = now() WHERE id = ?",
                json.object(current).toString(), org);
        return current;
    }

    List<Membership> members(UUID org, UUID actor) {
        access.require(org, actor);
        return queryMembers(org, null);
    }

    Membership member(UUID org, UUID user) {
        return queryMembers(org, user).stream().findFirst().orElseThrow(() -> OrgAccess.missing("member"));
    }

    @Transactional
    public Membership changeRole(UUID org, UUID actor, UUID user, OrgRole newRole) {
        var scope = access.lock(org, actor, OWNER, ADMIN);
        OrgRole oldRole = member(org, user).getRole();
        if (actor.equals(user)) throw failure(HttpStatus.CONFLICT, "own_role", "You can't change your own role.");
        if (oldRole == OWNER || newRole == OWNER) OrgAccess.checkRole(scope.role(), OWNER);
        if (oldRole == OWNER && newRole != OWNER) keepOwner(org);
        database.update("UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?", newRole.getValue(), org, user);
        record(org, actor, "member.role_changed", "user", user, Map.of("from", oldRole.getValue(), "to", newRole.getValue()));
        return member(org, user);
    }

    @Transactional
    public void removeMember(UUID org, UUID actor, UUID user) {
        boolean self = actor.equals(user);
        var scope = self ? access.lock(org, actor) : access.lock(org, actor, OWNER, ADMIN);
        OrgRole oldRole = member(org, user).getRole();
        if (oldRole == OWNER) {
            if (!self) OrgAccess.checkRole(scope.role(), OWNER);
            keepOwner(org);
        }
        database.update("DELETE FROM memberships WHERE org_id = ? AND user_id = ?", org, user);
        record(org, actor, "member.removed", "user", user, Map.of("role", oldRole.getValue(), "left", self));
    }

    void record(UUID org, UUID actor, String action, String type, UUID subject, Map<String, ?> data) {
        record(org, actor, action, type, subject, json.object(data));
    }

    private void record(UUID org, UUID actor, String action, String type, UUID subject, ObjectNode data) {
        audit.record(new RequestContext(actor, null, org, null), AuditWriter.ActorKind.USER, null, action, type, subject, data);
    }

    void enqueueEmail(UUID org, String kind, UUID entity, String email, Map<String, ?> data) {
        database.update("""
                INSERT INTO email_outbox (id, org_id, kind, entity_id, recipient, payload)
                VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb))
                """, Ids.newId(), org, kind, entity, email, json.object(data).toString());
    }

    private List<Membership> queryMembers(UUID org, UUID user) {
        String select = """
                SELECT u.*, m.role, m.created_at AS joined_at, m.last_active_at
                FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.org_id = ? AND u.deleted_at IS NULL
                """;
        return database.query(select + (user == null ? " ORDER BY u.name, u.id" : " AND m.user_id = ?"), (row, index) ->
                new Membership(IdentityService.mapUser(row, index), OrgRole.fromValue(row.getString("role")),
                        row.getObject("joined_at", OffsetDateTime.class))
                        .lastActiveAt(row.getObject("last_active_at", OffsetDateTime.class)),
                user == null ? new Object[]{org} : new Object[]{org, user});
    }

    private void keepOwner(UUID org) {
        if (database.queryForObject("SELECT count(*) FROM memberships WHERE org_id = ? AND role = 'owner'",
                Long.class, org) <= 1) {
            throw failure(HttpStatus.CONFLICT, "last_owner", "An organisation needs at least one owner.");
        }
    }

    private ObjectNode merge(ObjectNode target, Object patch) {
        json.object(patch).fields().forEachRemaining(field -> {
            if (!field.getValue().isNull()) target.set(field.getKey(), field.getValue());
        });
        return target;
    }

    /**
     * What an org update changed (BR-51, TF-119): name and slug before and after, as before, and every
     * setting whose value changed, under `settings` on both sides (a new key is null before).
     */
    private ObjectNode changes(Org current, String name, String slug, ObjectNode settings) {
        ObjectNode previous = json.object(current.getSettings());
        ObjectNode data = json.object(Map.of());
        ObjectNode before = data.putObject("before").put("name", current.getName()).put("slug", current.getSlug());
        ObjectNode after = data.putObject("after").put("name", name).put("slug", slug);
        ObjectNode settingsBefore = json.object(Map.of());
        ObjectNode settingsAfter = json.object(Map.of());
        settings.properties().forEach(entry -> {
            var old = previous.get(entry.getKey());
            if (!entry.getValue().equals(old)) {
                settingsBefore.set(entry.getKey(), old == null ? com.fasterxml.jackson.databind.node.NullNode.getInstance() : old);
                settingsAfter.set(entry.getKey(), entry.getValue());
            }
        });
        if (!settingsAfter.isEmpty()) {
            before.set("settings", settingsBefore);
            after.set("settings", settingsAfter);
        }
        return data;
    }

    private boolean approvalEnabled(ObjectNode settings) {
        return settings.path("approvalRequired").asBoolean() || settings.path("fourEyes").asBoolean();
    }

    private static String name(String value) {
        if (value.isBlank()) throw failure(HttpStatus.BAD_REQUEST, "invalid_body", "The name can't be empty.");
        return value.strip();
    }

    private static void checkSlug(String slug) {
        if (RESERVED.contains(slug)) throw slugTaken(slug);
    }

    private static ApiException slugTaken(String slug) {
        return new ApiException(HttpStatus.CONFLICT, "slug_taken", "This address is taken.", Map.of("slug", slug));
    }

    static ApiException failure(HttpStatus status, String code, String message) {
        return new ApiException(status, code, message, Map.of());
    }
}
