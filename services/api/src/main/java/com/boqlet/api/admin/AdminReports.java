package com.boqlet.api.admin;

import com.boqlet.contract.model.*;
import com.boqlet.api.extension.CoreModules;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.*;
import java.time.temporal.WeekFields;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
class AdminReports {
    private static final List<String> ACTIVITY = List.of("signUps", "newOrgs", "modelsParsed", "runs",
            "processingMinutes", "exports", "savedVersions", "confirmedBoqs", "shareLinkViews");
    private final JdbcTemplate database;
    private final CoreModules modules;

    AdminReports(JdbcTemplate database, CoreModules modules) {
        this.database = database;
        this.modules = modules;
    }

    AdminOverview overview(LocalDate from, LocalDate to) {
        var period = period(from, to);
        var buckets = period.buckets();
        var reports = database.query("""
                WITH visible_orgs AS (SELECT id FROM orgs WHERE status <> 'deleting'),
                activity AS (
                    SELECT 'signUps' AS kind, created_at AS at, 1 AS weight FROM users WHERE deleted_at IS NULL
                    UNION ALL SELECT 'newOrgs', created_at, 1 FROM orgs WHERE status <> 'deleting'
                    UNION ALL SELECT 'modelsParsed', j.finished_at, 1 FROM jobs j JOIN visible_orgs o ON o.id = j.org_id
                        WHERE j.type = 'parse' AND j.status = 'succeeded'
                    UNION ALL SELECT 'runs', r.created_at, 1 FROM runs r JOIN visible_orgs o ON o.id = r.org_id
                    UNION ALL SELECT 'processingMinutes', u.at, u.duration_ms / 60000.0
                        FROM usage_events u JOIN visible_orgs o ON o.id = u.org_id
                    UNION ALL SELECT 'exports', e.created_at, 1 FROM exports e JOIN visible_orgs o ON o.id = e.org_id
                        WHERE e.storage_key IS NOT NULL
                    UNION ALL SELECT CASE a.action WHEN 'version.saved' THEN 'savedVersions' ELSE 'confirmedBoqs' END,
                        a.created_at, 1 FROM audit_events a JOIN visible_orgs o ON o.id = a.org_id
                        WHERE a.action IN ('version.saved', 'boq.confirmed')
                    UNION ALL SELECT 'shareLinkViews', l.last_viewed_at, l.views FROM share_links l
                        JOIN boqs b ON b.id = l.boq_id JOIN projects p ON p.id = b.project_id
                        JOIN visible_orgs o ON o.id = p.org_id WHERE l.last_viewed_at IS NOT NULL
                )
                SELECT kind, (at AT TIME ZONE 'UTC')::date AS day, sum(weight) AS value FROM activity
                WHERE at >= ? AND at < ? GROUP BY kind, day
                """, (row, index) -> new Daily(row.getString("kind"), row.getObject("day", LocalDate.class),
                row.getBigDecimal("value")), beginning(period.previous()), beginning(period.end()));
        var tiles = new LinkedHashMap<String, AdminOverviewTilesValue>();
        for (String kind : ACTIVITY) {
            var days = reports.stream().filter(report -> report.kind().equals(kind)).toList();
            var series = buckets.stream().map(bucket -> sum(days, bucket.start(), bucket.end())).toList();
            tiles.put(kind, new AdminOverviewTilesValue().value(sum(days, period.start(), period.end()))
                    .previous(sum(days, period.previous(), period.start())).series(series));
        }
        var activeBuckets = new ArrayList<>(buckets);
        activeBuckets.add(new Range(period.start(), period.end()));
        activeBuckets.add(new Range(period.previous(), period.start()));
        var active = database.query("""
                SELECT bucket.idx, count(DISTINCT r.org_id) AS count FROM
                    unnest(string_to_array(?, ',')::date[], string_to_array(?, ',')::date[])
                        WITH ORDINALITY AS bucket(start, finish, idx)
                LEFT JOIN runs r ON r.created_at >= bucket.start::timestamp AT TIME ZONE 'UTC'
                    AND r.created_at < bucket.finish::timestamp AT TIME ZONE 'UTC'
                    AND EXISTS(SELECT 1 FROM orgs o WHERE o.id = r.org_id AND o.status <> 'deleting')
                GROUP BY bucket.idx ORDER BY bucket.idx
                """, (row, index) -> row.getBigDecimal("count"), dates(activeBuckets, true), dates(activeBuckets, false));
        int totalIndex = active.size() - 2;
        tiles.put("activeOrgs", new AdminOverviewTilesValue().value(active.get(totalIndex))
                .previous(active.get(totalIndex + 1)).series(active.subList(0, totalIndex)));
        database.query("""
                SELECT count(*) FILTER (WHERE plan_id <> 'free' AND subscription_status = 'active') AS paid,
                       coalesce(sum(seats), 0) AS seats, coalesce(sum(active_projects), 0) AS projects,
                       coalesce(sum(CASE WHEN jsonb_typeof(entitlements->'seats') = 'number'
                            THEN greatest(0,(entitlements->>'seats')::numeric - seats) END), 0) AS available
                FROM admin_org_rows
                """, row -> {
                    tiles.put("payingOrgs", snapshot(row.getBigDecimal("paid")));
                    tiles.put("seatsUsed", snapshot(row.getBigDecimal("seats")));
                    tiles.put("seatsAvailable", snapshot(row.getBigDecimal("available")));
                    tiles.put("activeProjects", snapshot(row.getBigDecimal("projects")));
                });
        tiles.put("revenue", snapshot(null));
        for (var module : modules.installed()) {
            module.metrics(period.start(), period.end().minusDays(1)).forEach((name, metric) -> tiles.put(module.key() + "." + name, metric));
        }
        var byPlan = new LinkedHashMap<String, Integer>();
        database.query("SELECT plan_id, count(*) AS count FROM admin_org_rows GROUP BY plan_id ORDER BY plan_id",
                row -> { byPlan.put(row.getString("plan_id"), row.getInt("count")); });
        return new AdminOverview().period(new AdminOverviewPeriod().from(period.start()).to(period.end().minusDays(1)))
                .tiles(tiles).orgsByPlan(byPlan);
    }

    AdminFunnel funnel(LocalDate from, LocalDate to) {
        var period = period(from, to);
        var definitions = AdminFunnelStep.values();
        var counts = new int[definitions.length];
        var waits = new ArrayList<List<Double>>(definitions.length);
        for (var ignored : definitions) waits.add(new ArrayList<>());
        var cohorts = new TreeMap<String, int[]>();
        database.query("""
                SELECT created_at FROM users WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ?
                """, row -> {
                    cohorts.computeIfAbsent(week(AdminOrganisations.time(row, "created_at")), ignored -> new int[definitions.length])[0]++;
                    counts[0]++;
                }, beginning(period.start()), beginning(period.end()));
        database.query("""
                SELECT signed_up, org_at, setup_at, model_at, boq_at, saved_at, shared_at
                FROM admin_org_rows WHERE org_at >= ? AND org_at < ?
                """, row -> {
                    var orgCreated = AdminOrganisations.time(row, "org_at");
                    int[] cohort = cohorts.computeIfAbsent(week(orgCreated), ignored -> new int[definitions.length]);
                    var before = AdminOrganisations.time(row, "signed_up");
                    for (int index = 1; index < definitions.length; index++) {
                        var at = row.getObject(index + 1, OffsetDateTime.class);
                        if (at == null) break;
                        cohort[index]++;
                        counts[index]++;
                        if (before != null && !at.isBefore(before)) {
                            waits.get(index).add(Duration.between(before, at).toMillis() / 3_600_000.0);
                        }
                        before = at;
                    }
                }, beginning(period.start()), beginning(period.end()));
        var steps = new ArrayList<AdminFunnelStepsInner>();
        for (int index = 0; index < definitions.length; index++) {
            var step = new AdminFunnelStepsInner(definitions[index], counts[index]).medianHoursFromPrevious(median(waits.get(index)));
            if (index > 0) {
                step.conversionPct(counts[index - 1] == 0 ? BigDecimal.ZERO
                        : round(BigDecimal.valueOf(100.0 * counts[index] / counts[index - 1])));
            }
            steps.add(step);
        }
        return new AdminFunnel().steps(steps).cohorts(cohorts.entrySet().stream().map(entry ->
                new AdminFunnelCohortsInner().week(entry.getKey()).counts(Arrays.stream(entry.getValue()).boxed().toList())).toList());
    }

    AdminHealth200Response health() {
        var response = new AdminHealth200Response();
        database.query("""
                SELECT (finished_at AT TIME ZONE 'UTC')::date AS day, count(*) AS count
                FROM jobs WHERE status = 'failed' AND finished_at >= now() - interval '30 days'
                GROUP BY day ORDER BY day
                """, row -> { response.addFailedJobsPerDayItem(new AdminHealth200ResponseFailedJobsPerDayInner()
                    .date(row.getObject("day", LocalDate.class)).count(row.getInt("count"))); });
        database.query("""
                SELECT type, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (finished_at - started_at))*1000) AS p50,
                      percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (finished_at - started_at))*1000) AS p95
                FROM jobs WHERE started_at IS NOT NULL AND finished_at >= now() - interval '30 days' GROUP BY type
                """, row -> { response.putJobDurationsMsItem(row.getString("type"),
                    new AdminHealth200ResponseJobDurationsMsValue().p50(row.getBigDecimal("p50")).p95(row.getBigDecimal("p95"))); });
        return response;
    }

    private static OffsetDateTime beginning(LocalDate day) { return day.atStartOfDay().atOffset(ZoneOffset.UTC); }

    private static Period period(LocalDate from, LocalDate to) {
        LocalDate last = Objects.requireNonNullElseGet(to, () -> LocalDate.now(ZoneOffset.UTC));
        LocalDate first = Objects.requireNonNullElseGet(from, () -> last.minusDays(29));
        long days = java.time.temporal.ChronoUnit.DAYS.between(first, last) + 1;
        if (days <= 0 || days > 3660) throw AdminOrganisations.invalid("invalid_parameter", "Select a valid reporting period of up to ten years.");
        return new Period(first, last.plusDays(1), first.minusDays(days), days <= 31 ? 1 : 7);
    }

    private static String dates(List<Range> buckets, boolean start) {
        return String.join(",", buckets.stream().map(bucket -> (start ? bucket.start() : bucket.end()).toString()).toList());
    }

    private static BigDecimal sum(List<Daily> days, LocalDate from, LocalDate end) {
        return round(days.stream().filter(day -> !day.day().isBefore(from) && day.day().isBefore(end))
                .map(Daily::value).reduce(BigDecimal.ZERO, BigDecimal::add));
    }

    private static BigDecimal round(BigDecimal number) { return number.setScale(2, RoundingMode.HALF_UP); }

    private static BigDecimal median(List<Double> values) {
        if (values.isEmpty()) return null;
        Collections.sort(values);
        int middle = values.size() / 2;
        return round(BigDecimal.valueOf(values.size() % 2 == 1 ? values.get(middle)
                : (values.get(middle) + values.get(middle - 1)) / 2));
    }

    private static String week(OffsetDateTime time) {
        var day = time.withOffsetSameInstant(ZoneOffset.UTC).toLocalDate();
        return "%04d-W%02d".formatted(day.get(WeekFields.ISO.weekBasedYear()), day.get(WeekFields.ISO.weekOfWeekBasedYear()));
    }

    private static AdminOverviewTilesValue snapshot(BigDecimal value) {
        return new AdminOverviewTilesValue().value(value).previous(null).series(List.of());
    }

    private record Daily(String kind, LocalDate day, BigDecimal value) {}
    private record Range(LocalDate start, LocalDate end) {}
    private record Period(LocalDate start, LocalDate end, LocalDate previous, int bucketDays) {
        List<Range> buckets() {
            var result = new ArrayList<Range>();
            for (var date = start; date.isBefore(end); date = date.plusDays(bucketDays)) {
                LocalDate after = date.plusDays(bucketDays);
                result.add(new Range(date, after.isBefore(end) ? after : end));
            }
            return result;
        }
    }
}
