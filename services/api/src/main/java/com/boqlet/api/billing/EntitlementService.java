package com.boqlet.api.billing;

import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.contract.model.Entitlements;
import com.boqlet.contract.model.EntitlementsResponse;
import com.boqlet.contract.model.EntitlementsResponseUsage;
import com.boqlet.contract.model.Plan;
import com.boqlet.contract.model.Subscription;
import com.boqlet.contract.model.UsageResponse;
import com.boqlet.contract.model.UsageResponseByProjectInner;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class EntitlementService {
    private final JdbcTemplate database;
    private final StoredJson json;

    EntitlementService(JdbcTemplate database, StoredJson json) {
        this.database = database;
        this.json = json;
    }

    public List<Plan> plans() {
        return database.query("""
                SELECT id, name, entitlements::text FROM plans WHERE public ORDER BY default_plan DESC,
                    array_position(ARRAY['free','professional','team','enterprise'], id) NULLS LAST, created_at, id
                """,
                (row, index) -> new Plan(row.getString("id"), row.getString("name"),
                        json.read(row.getString("entitlements"), Entitlements.class)));
    }

    public Subscription subscription(UUID org) {
        return database.queryForObject("SELECT * FROM subscriptions WHERE org_id = ?", (row, index) ->
                new Subscription(row.getString("plan_id"), Subscription.StatusEnum.fromValue(row.getString("status")),
                        row.getString("provider")).trialEndsAt(row.getObject("trial_ends_at", OffsetDateTime.class))
                        .currentPeriodEnd(row.getObject("current_period_end", OffsetDateTime.class)).plans(plans()), org);
    }

    public EntitlementsResponse snapshot(UUID org) {
        var plan = effective(org);
        var usage = new EntitlementsResponseUsage().seats(Math.toIntExact(seats(org)))
                .activeProjects(Math.toIntExact(activeProjects(org)))
                .processingMinutesThisMonth(minutes(processingMillis(org, YearMonth.now(ZoneOffset.UTC))));
        return new EntitlementsResponse(plan.id(), json.read(plan.limits(), Entitlements.class), usage);
    }

    public void checkCapacity(UUID org, UUID actor, String key, long used) {
        check(org, actor, key, BigDecimal.valueOf(used), true);
    }

    public void checkSize(UUID org, UUID actor, String key, BigDecimal size) {
        check(org, actor, key, size, false);
    }

    public void checkConsumption(UUID org, UUID actor, String key, BigDecimal units, int unitsPerLimit) {
        JsonNode maximum = json.read(effective(org).limits(), JsonNode.class).path(key);
        if (maximum.isNumber() && units.compareTo(maximum.decimalValue().multiply(BigDecimal.valueOf(unitsPerLimit))) >= 0) {
            throw new LimitReached(org, actor, key,
                    units.divide(BigDecimal.valueOf(unitsPerLimit), 2, RoundingMode.HALF_UP), maximum.decimalValue());
        }
    }

    public void requireFeature(UUID org, UUID actor, String key) {
        requireFeature(org, actor, key, effective(org).limits());
    }

    public boolean enabled(UUID org, String key) {
        return json.read(effective(org).limits(), JsonNode.class).path(key).asBoolean(false);
    }

    public void requirePlanFeature(String plan, String key) {
        requireFeature(null, null, key, database.queryForObject(
                "SELECT entitlements::text FROM plans WHERE id = ?", String.class, plan));
    }

    private void requireFeature(UUID org, UUID actor, String key, String limits) {
        if (!json.read(limits, JsonNode.class).path(key).asBoolean(false)) {
            throw new LimitReached(org, actor, key, BigDecimal.ZERO, BigDecimal.ZERO);
        }
    }

    private void check(UUID org, UUID actor, String key, BigDecimal current, boolean fullAtMaximum) {
        JsonNode maximum = json.read(effective(org).limits(), JsonNode.class).path(key);
        if (maximum.isNumber()) {
            int comparison = current.compareTo(maximum.decimalValue());
            if (comparison > 0 || (fullAtMaximum && comparison == 0)) {
                throw new LimitReached(org, actor, key, current, maximum.decimalValue());
            }
        }
    }

    public long seats(UUID org) {
        return database.queryForObject("""
                SELECT (SELECT count(*) FROM memberships WHERE org_id = ?)
                     + (SELECT count(*) FROM org_invitations WHERE org_id = ? AND status = 'pending' AND expires_at > now())
                """, Long.class, org, org);
    }

    public long activeProjects(UUID org) {
        return database.queryForObject("SELECT count(*) FROM projects WHERE org_id = ? AND status = 'active' AND NOT sample",
                Long.class, org);
    }

    public void recordUsage(UUID org, UUID project, UUID job, String kind, OffsetDateTime startedAt,
                            long durationMillis, Long modelBytes, Long elements, String outcome) {
        database.update("""
                INSERT INTO usage_events (id, org_id, project_id, job_id, kind, started_at, duration_ms, model_bytes,
                                          element_count, outcome)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (job_id) DO NOTHING
                """, Ids.newId(), org, project, job, kind, startedAt, durationMillis, modelBytes, elements, outcome);
    }

    public UsageResponse usage(UUID org, String month) {
        YearMonth period = period(month);
        OffsetDateTime start = start(period);
        OffsetDateTime end = start(period.plusMonths(1));
        var byProject = database.query("""
                SELECT p.id, p.name, sum(u.duration_ms) AS millis FROM usage_events u
                JOIN projects p ON p.org_id = u.org_id AND p.id = u.project_id
                WHERE u.org_id = ? AND u.at >= ? AND u.at < ?
                GROUP BY p.id, p.name ORDER BY millis DESC, p.id
                """, (row, index) -> new UsageResponseByProjectInner().projectId(row.getObject("id", UUID.class))
                        .projectName(row.getString("name")).minutes(minutes(row.getBigDecimal("millis"))), org, start, end);
        var kinds = database.query("""
                SELECT kind, sum(duration_ms) AS millis FROM usage_events
                WHERE org_id = ? AND at >= ? AND at < ? GROUP BY kind ORDER BY kind
                """, (row, index) -> Map.entry(row.getString("kind"), row.getBigDecimal("millis")), org, start, end);
        var byKind = new LinkedHashMap<String, BigDecimal>();
        kinds.forEach(entry -> byKind.put(entry.getKey(), minutes(entry.getValue())));
        BigDecimal total = kinds.stream().map(Map.Entry::getValue).reduce(BigDecimal.ZERO, BigDecimal::add);
        return new UsageResponse(period.toString(), minutes(total), byProject, byKind);
    }

    public BigDecimal processingMillis(UUID org, YearMonth month) {
        return database.queryForObject("""
                SELECT coalesce(sum(duration_ms), 0) FROM usage_events WHERE org_id = ? AND at >= ? AND at < ?
                """, BigDecimal.class, org, start(month), start(month.plusMonths(1)));
    }

    private Effective effective(UUID org) {
        return database.queryForObject("""
                SELECT p.id, (p.entitlements || s.overrides)::text AS limits FROM subscriptions s
                JOIN plans p ON p.id = s.plan_id WHERE s.org_id = ?
                """, (row, index) -> new Effective(row.getString("id"), row.getString("limits")), org);
    }

    private static YearMonth period(String value) {
        try {
            if (value == null) return YearMonth.now(ZoneOffset.UTC);
            if (value.matches("[0-9]{4}-[0-9]{2}")) return YearMonth.parse(value);
        } catch (DateTimeParseException ignored) {
            // Keep the contract's parameter error below.
        }
        throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_param", "Month must be YYYY-MM.", Map.of("month", value));
    }

    private static OffsetDateTime start(YearMonth month) {
        return month.atDay(1).atStartOfDay().atOffset(ZoneOffset.UTC);
    }

    private static BigDecimal minutes(BigDecimal milliseconds) {
        return milliseconds.divide(BigDecimal.valueOf(60_000), 2, RoundingMode.HALF_UP);
    }

    private record Effective(String id, String limits) {}
}
