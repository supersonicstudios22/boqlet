package com.boqlet.api.admin;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.billing.EntitlementCatalogue;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.http.RequestContext;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class AdminOrganisations {
    private static final Map<String, String> SORTS = Map.of("name", "lower(name)", "planId", "plan_id", "country", "country",
            "createdAt", "created_at", "lastActivityAt", "activity_at", "trialEndsAt", "trial_ends_at",
            "limitHits30d", "limit_hits", "seats", "seats", "activeProjects", "active_projects", "processingMinutes", "processing_minutes");
    private static final Map<String, String> SIGNALS = Map.of(
            "hit_limit", "limit_hits > 0",
            "inactive_30d", "activity_at < now() - interval '30 days'",
            "trial_ending_7d", "trial_ends_at > now() AND trial_ends_at <= now() + interval '7 days'",
            "stuck_in_setup", "setup_at IS NULL");
    private static final List<String> STEPS = List.of("signed_up", "org_at", "setup_at", "model_at", "boq_at", "saved_at", "shared_at");
    private static final String ORGS = """
            SELECT id, name, country, plan_id, status, subscription_status, trial_ends_at, seats, active_projects,
                   processing_minutes, entitlements::text, limit_hits, activity_at, owner_email, to_json(tags)::text, created_at
            FROM admin_org_rows WHERE true
            """;
    private final JdbcTemplate database;
    private final NamedParameterJdbcTemplate named;
    private final StoredJson json;
    private final AuditWriter audit;
    private final EntitlementCatalogue catalogue;

    AdminOrganisations(JdbcTemplate database, NamedParameterJdbcTemplate named, StoredJson json, AuditWriter audit,
                       EntitlementCatalogue catalogue) {
        this.database = database;
        this.named = named;
        this.json = json;
        this.audit = audit;
        this.catalogue = catalogue;
    }

    record Filter(String plan, String status, String country, String tag, String signal, AdminFunnelStep stuckAt,
                  String query, String sort) {}

    List<AdminOrgRow> list(Filter filter, Integer limit, int offset) {
        var args = new MapSqlParameterSource();
        var sql = new StringBuilder(ORGS);
        condition(sql, args, "plan", filter.plan(), "plan_id = :plan");
        condition(sql, args, "status", filter.status(), "(status = :status OR subscription_status = :status)");
        condition(sql, args, "country", filter.country(), "lower(country) = lower(:country)");
        condition(sql, args, "tag", filter.tag(), ":tag = ANY(tags)");
        condition(sql, args, "q", filter.query(), """
                strpos(lower(concat_ws(' ', name, slug, owner_email)), lower(:q)) > 0
                """);
        if (filter.signal() != null) {
            var signal = SIGNALS.get(filter.signal());
            if (signal == null) throw invalid("invalid_parameter", "Unknown organisation signal.");
            sql.append(" AND ").append(signal);
        }
        if (filter.stuckAt() != null) {
            int step = filter.stuckAt().ordinal();
            if (step <= 1) return List.of();
            for (int earlier = 2; earlier < step; earlier++) sql.append(" AND ").append(STEPS.get(earlier)).append(" IS NOT NULL");
            sql.append(" AND ").append(STEPS.get(step)).append(" IS NULL");
        }
        String sort = Objects.requireNonNullElse(filter.sort(), "-createdAt");
        boolean desc = sort.startsWith("-");
        String field = SORTS.get(desc ? sort.substring(1) : sort);
        if (field == null) throw invalid("invalid_parameter", "Unknown organisation sort.");
        sql.append(" ORDER BY ").append(field).append(desc ? " DESC" : " ASC").append(" NULLS LAST, lower(name), id");
        if (limit != null) {
            sql.append(" LIMIT :limit OFFSET :offset");
            args.addValue("limit", limit).addValue("offset", offset);
        }
        return named.query(sql.toString(), args, this::row);
    }

    @Transactional
    AdminOrgDetail view(UUID actor, UUID org) {
        var detail = detail(org);
        record(actor, null, "admin.org_viewed", "org", org, Map.of("orgId", org));
        return detail;
    }

    @Transactional
    AdminOrgDetail update(UUID actor, UUID org, AdminUpdateOrgRequest request) {
        lock(org);
        String reason = required(request.getReason(), "reason");
        var current = require(org);
        var requestedTags = request.getTags().orElse(null);
        if (requestedTags != null && !requestedTags.equals(current.getTags())) {
            var tags = requestedTags.stream().map(String::strip).filter(value -> !value.isBlank()).distinct().sorted().toList();
            database.update("""
                    UPDATE orgs SET tags = ARRAY(SELECT jsonb_array_elements_text(CAST(? AS jsonb))) WHERE id = ?
                    """, json.object(Map.of("tags", tags)).path("tags").toString(), org);
            record(actor, null, "admin.org_tagged", "org", org,
                    Map.of("orgId", org, "from", current.getTags(), "to", tags, "reason", reason));
        }
        if (request.getStatus() != null && !request.getStatus().getValue().equals(current.getStatus())) {
            String status = request.getStatus().getValue();
            database.update("UPDATE orgs SET status = ?, updated_at = now() WHERE id = ?", status, org);
            record(actor, org, status.equals("suspended") ? "org.suspended" : "org.reactivated", "org", org,
                    Map.of("from", current.getStatus(), "to", status, "reason", reason));
        }
        return detail(org);
    }

    @Transactional
    AdminOrgDetail subscription(UUID actor, UUID org, AdminSetSubscriptionRequest request) {
        lock(org);
        String reason = required(request.getReason(), "reason");
        var current = require(org);
        String plan = request.getPlanId();
        if (plan == null && !request.getTrialEndsAt().isPresent()) throw invalid("invalid_body", "Change the plan or trial.");
        if (plan != null && !plan.equals(current.getPlanId())) {
            if (database.update("""
                    UPDATE subscriptions SET plan_id = ?, provider = 'manual', updated_at = now()
                    WHERE org_id = ? AND EXISTS(SELECT 1 FROM plans WHERE id = ?)
                    """, plan, org, plan) == 0) throw missing("plan");
            record(actor, org, "org.plan_changed", "org", org, Map.of("from", current.getPlanId(), "to", plan, "reason", reason));
        }
        if (request.getTrialEndsAt().isPresent()) {
            var end = request.getTrialEndsAt().orElse(null);
            database.update("""
                    UPDATE subscriptions SET trial_ends_at = ?, status = CASE WHEN CAST(? AS timestamptz) > now()
                        THEN 'trialing' WHEN status = 'trialing' THEN 'active' ELSE status END, provider = 'manual', updated_at = now()
                    WHERE org_id = ?
                    """, end, end, org);
            var change = new LinkedHashMap<String, Object>();
            change.put("from", current.getTrialEndsAt().orElse(null));
            change.put("to", end);
            change.put("reason", reason);
            record(actor, org, "org.trial_changed", "org", org, change);
        }
        return detail(org);
    }

    @Transactional
    AdminOrgDetail overrides(UUID actor, UUID org, AdminSetEntitlementOverridesRequest request) {
        lock(org);
        String reason = required(request.getReason(), "reason");
        var current = json.read(database.queryForObject("SELECT overrides::text FROM subscriptions WHERE org_id = ?", String.class, org),
                com.fasterxml.jackson.databind.node.ObjectNode.class);
        var changes = current.deepCopy();
        // Only the keys the backend enforces, each with a valid value (P57, EntitlementCatalogue).
        request.getOverrides().forEach((key, value) -> {
            if (value == null) {
                changes.remove(key);
                return;
            }
            JsonNode node = json.object(Map.of("value", value)).path("value");
            if (!catalogue.valid(key, node)) throw invalid("invalid_body", "Invalid entitlement override for " + key + ".");
            changes.set(key, node);
        });
        database.update("UPDATE subscriptions SET overrides = ?::jsonb, updated_at = now() WHERE org_id = ?", changes.toString(), org);
        record(actor, org, "org.entitlements_overridden", "org", org, Map.of("from", current, "to", changes, "reason", reason));
        return detail(org);
    }

    List<AdminNote> notes(UUID org) {
        require(org);
        return readNotes(org, null);
    }

    @Transactional
    AdminNote addNote(UUID actor, UUID org, String value) {
        lock(org);
        String text = required(value, "text");
        UUID id = Ids.newId();
        database.update("INSERT INTO admin_notes (id, org_id, author_id, text) VALUES (?, ?, ?, ?)", id, org, actor, text);
        record(actor, null, "admin.note_added", "adminNote", id, Map.of("orgId", org));
        return readNotes(org, id).getFirst();
    }

    private List<AdminNote> readNotes(UUID org, UUID id) {
        return database.query("""
                SELECT n.id, n.text, n.author_id, n.created_at, u.name, u.email
                FROM admin_notes n JOIN users u ON u.id = n.author_id
                WHERE n.org_id = ? AND (CAST(? AS uuid) IS NULL OR n.id = ?) ORDER BY n.created_at DESC, n.id
                """, (row, index) -> new AdminNote(row.getObject("id", UUID.class), row.getString("text"),
                        new UserRef(row.getObject("author_id", UUID.class), row.getString("name")).email(row.getString("email")),
                        time(row, "created_at")), org, id, id);
    }

    private AdminOrgDetail detail(UUID org) {
        var row = require(org);
        var detail = json.read(json.object(row).toString(), AdminOrgDetail.class);
        database.query("""
                SELECT o.settings::text, o.setup::text, v.entitlements::text, s.overrides::text, s.provider, s.current_period_end
                FROM orgs o JOIN admin_org_rows v ON v.id = o.id JOIN subscriptions s ON s.org_id = o.id WHERE o.id = ?
                """, r -> {
                    detail.settings(json.read(r.getString("settings"), OrgSettings.class));
                    detail.setup(json.read(r.getString("setup"), OrgSetup.class));
                    detail.entitlements(json.read(r.getString("entitlements"), Map.class));
                    detail.overrides(json.read(r.getString("overrides"), Map.class));
                    detail.provider(r.getString("provider"));
                    detail.currentPeriodEnd(time(r, "current_period_end"));
                }, org);
        detail.members(database.query("""
                SELECT u.id, u.name, u.email, m.role, greatest(m.last_active_at,
                    (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id)) AS active_at,
                    EXISTS(SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.status = 'active'
                        AND s.last_seen_at > now() - interval '12 hours') AS active
                FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.org_id = ? AND u.deleted_at IS NULL ORDER BY lower(u.name), u.id
                """, (r, index) -> new AdminOrgDetailAllOfMembers().userId(r.getObject("id", UUID.class))
                .name(r.getString("name")).email(r.getString("email")).role(OrgRole.fromValue(r.getString("role")))
                .lastActiveAt(time(r, "active_at")).activeSession(r.getBoolean("active")), org));
        detail.planHistory(database.query("""
                SELECT a.data->>'to' AS plan, a.created_at AS at, u.name
                FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
                WHERE a.org_id = ? AND a.action = 'org.plan_changed' ORDER BY a.created_at DESC, a.id
                """, (r, index) -> new AdminOrgDetailAllOfPlanHistory().planId(r.getString("plan")).at(time(r, "at")).by(r.getString("name")), org));
        detail.limitEvents(database.query("""
                SELECT limit_name, current_value, max_value, action, at FROM limit_events
                WHERE org_id = ? ORDER BY at DESC, id LIMIT 100
                """, (r, index) -> new AdminOrgDetailAllOfLimitEvents().limit(r.getString("limit_name"))
                .current(r.getBigDecimal("current_value")).max(r.getBigDecimal("max_value"))
                .action(r.getString("action")).at(time(r, "at")), org));
        detail.usageByMonth(database.query("""
                SELECT to_char(at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, kind,
                       round(sum(duration_ms) / 60000.0, 2) AS minutes FROM usage_events
                WHERE org_id = ? GROUP BY month, kind ORDER BY month DESC, kind
                """, (r, index) -> new AdminOrgDetailAllOfUsageByMonth().month(r.getString("month"))
                .kind(r.getString("kind")).minutes(r.getBigDecimal("minutes")), org));
        return detail.counts(counts(org));
    }

    private Map<String, Integer> counts(UUID org) {
        return database.queryForObject("""
                WITH projects_in_org AS (SELECT id, status FROM projects WHERE org_id = ?),
                models_in_org AS (SELECT m.id FROM models m JOIN projects_in_org p ON p.id = m.project_id),
                boqs_in_org AS (SELECT b.id, b.status FROM boqs b JOIN projects_in_org p ON p.id = b.project_id)
                SELECT (SELECT count(*) FROM projects_in_org WHERE status = 'active') AS "projectsActive",
                    (SELECT count(*) FROM projects_in_org WHERE status = 'archived') AS "projectsArchived",
                    (SELECT count(*) FROM models_in_org) AS models,
                    (SELECT count(*) FROM model_versions v JOIN models_in_org m ON m.id = v.model_id WHERE v.deleted_at IS NULL) AS versions,
                    (SELECT count(*) FROM boqs_in_org) AS boqs,
                    (SELECT count(*) FROM boqs_in_org WHERE status = 'confirmed') AS "confirmedBoqs",
                    (SELECT count(*) FROM boq_revisions v JOIN boqs_in_org b ON b.id = v.boq_id WHERE v.status = 'issued') AS "savedVersions",
                    (SELECT count(*) FROM runs WHERE org_id = ?) AS runs,
                    (SELECT count(*) FROM exports WHERE org_id = ? AND storage_key IS NOT NULL) AS exports,
                    (SELECT count(*) FROM share_links l JOIN boqs_in_org b ON b.id = l.boq_id) AS "shareLinks"
                """, (row, index) -> {
                    var data = new LinkedHashMap<String, Integer>();
                    for (int i = 1; i <= row.getMetaData().getColumnCount(); i++) data.put(row.getMetaData().getColumnLabel(i), row.getInt(i));
                    return data;
                }, org, org, org);
    }

    private AdminOrgRow require(UUID org) {
        return database.query(ORGS + " AND id = ?", this::row, org).stream().findFirst().orElseThrow(() -> missing("organisation"));
    }

    private void lock(UUID org) {
        if (database.queryForList("SELECT id FROM orgs WHERE id = ? AND status <> 'deleting' FOR NO KEY UPDATE",
                UUID.class, org).isEmpty()) throw missing("organisation");
    }

    private AdminOrgRow row(ResultSet r, int index) throws SQLException {
        JsonNode limits = json.read(r.getString("entitlements"), JsonNode.class);
        return new AdminOrgRow(r.getObject("id", UUID.class), r.getString("name"), r.getString("plan_id"), r.getString("status"))
                .country(Objects.toString(r.getString("country"), "")).subscriptionStatus(r.getString("subscription_status"))
                .trialEndsAt(time(r, "trial_ends_at")).seats(usage(r.getInt("seats"), limits.path("seats")))
                .activeProjects(usage(r.getInt("active_projects"), limits.path("activeProjects")))
                .processingMinutes(new AdminOrgRowProcessingMinutes().used(r.getBigDecimal("processing_minutes"))
                        .max(limits.path("processingMinutesPerMonth").isNumber() ? limits.path("processingMinutesPerMonth").decimalValue() : null))
                .limitHits30d(r.getInt("limit_hits")).lastActivityAt(time(r, "activity_at"))
                .ownerEmail(Objects.toString(r.getString("owner_email"), "")).tags(List.of(json.read(r.getString(15), String[].class)))
                .createdAt(time(r, "created_at"));
    }

    private static AdminOrgRowSeats usage(int used, JsonNode max) {
        return new AdminOrgRowSeats().used(used).max(max.isNumber() ? max.asInt() : null);
    }

    /** A platform-admin read (P54 Q59, TF-156), in a transaction of its own: the reads themselves have none. */
    @Transactional
    public void viewed(UUID actor, String action, String entity, UUID id, Map<String, ?> data) {
        record(actor, null, action, entity, id, data);
    }

    void record(UUID actor, UUID org, String action, String entity, UUID id, Map<String, ?> data) {
        audit.record(new RequestContext(actor, null, org, null), AuditWriter.ActorKind.PLATFORM_ADMIN,
                null, action, entity, id, json.object(data));
    }

    private static void condition(StringBuilder sql, MapSqlParameterSource args, String key, String value, String expression) {
        if (value != null && !value.isBlank()) {
            sql.append(" AND ").append(expression);
            args.addValue(key, value.strip());
        }
    }

    static OffsetDateTime time(ResultSet row, String name) throws SQLException { return row.getObject(name, OffsetDateTime.class); }

    static ApiException missing(String entity) {
        return new ApiException(HttpStatus.NOT_FOUND, "not_found", "The " + entity + " was not found.", Map.of());
    }

    static ApiException invalid(String code, String text) { return new ApiException(HttpStatus.BAD_REQUEST, code, text, Map.of()); }

    private static String required(String value, String name) {
        if (value == null || value.isBlank() || value.length() > 4000) throw invalid("invalid_body", "Enter a valid " + name + ".");
        return value.strip();
    }
}
