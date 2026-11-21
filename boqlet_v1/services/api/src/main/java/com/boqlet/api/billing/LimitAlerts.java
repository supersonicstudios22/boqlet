package com.boqlet.api.billing;

import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.realtime.Notifications;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class LimitAlerts {
    private final JdbcTemplate database;
    private final EntitlementService entitlements;
    private final StoredJson json;
    private final Notifications notifications;
    private final TransactionTemplate transactions;

    private final io.micrometer.core.instrument.MeterRegistry meters;

    LimitAlerts(JdbcTemplate database, EntitlementService entitlements, StoredJson json,
                Notifications notifications, TransactionTemplate transactions, io.micrometer.core.instrument.MeterRegistry meters) {
        this.meters = meters;
        this.database = database;
        this.entitlements = entitlements;
        this.json = json;
        this.notifications = notifications;
        this.transactions = transactions;
    }

    @Transactional
    public void refused(LimitReached failure, String action) {
        meters.counter("boqlet.limits.hits", "limit", String.valueOf(failure.key)).increment();
        if (failure.org == null) return;
        database.update("""
                INSERT INTO limit_events (id, org_id, user_id, limit_name, current_value, max_value, action)
                SELECT ?, id, ?, ?, ?, ?, ? FROM orgs WHERE id = ?
                """, Ids.newId(), failure.actor, failure.key, failure.current, failure.maximum, action, failure.org);
        publish(failure.org, failure.key, failure.current, failure.maximum, "limit.reached");
    }

    @Scheduled(fixedDelayString = "${BOQLET_LIMIT_ALERT_POLL_MS:3600000}", initialDelay = 60000)
    void check() {
        for (UUID org : database.queryForList("SELECT id FROM orgs WHERE status = 'active' ORDER BY id", UUID.class)) {
            transactions.executeWithoutResult(status -> {
                if (!Boolean.TRUE.equals(database.queryForObject(
                        "SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0))", Boolean.class, "limits:" + org))) return;
                var snapshot = entitlements.snapshot(org);
                JsonNode limits = json.object(snapshot.getLimits());
                near(org, "seats", BigDecimal.valueOf(snapshot.getUsage().getSeats()), limits);
                near(org, "activeProjects", BigDecimal.valueOf(snapshot.getUsage().getActiveProjects()), limits);
                near(org, "processingMinutesPerMonth", snapshot.getUsage().getProcessingMinutesThisMonth(), limits);
            });
        }
    }

    private void near(UUID org, String key, BigDecimal usage, JsonNode effective) {
        JsonNode limit = effective.path(key);
        if (limit.isNumber() && limit.decimalValue().signum() > 0
                && usage.compareTo(limit.decimalValue().multiply(new BigDecimal("0.8"))) >= 0) {
            publish(org, key, usage, limit.decimalValue(),
                    usage.compareTo(limit.decimalValue()) >= 0 ? "limit.reached" : "limit.near");
        }
    }

    private void publish(UUID org, String key, BigDecimal usage, BigDecimal max, String kind) {
        LocalDate month = LocalDate.now(ZoneOffset.UTC).withDayOfMonth(1);
        int first = database.update("""
                INSERT INTO limit_notifications (org_id, limit_name, kind, period)
                SELECT id, ?, ?, ? FROM orgs WHERE id = ? AND status = 'active' ON CONFLICT DO NOTHING
                """, key, kind, month, org);
        if (first == 0) return;
        String slug = database.queryForObject("SELECT slug FROM orgs WHERE id = ?", String.class, org);
        for (UUID user : database.queryForList("""
                SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
                WHERE m.org_id = ? AND m.role IN ('owner','admin')
                """, UUID.class, org)) {
            notifications.send(user, org, null, kind, "limits", Map.of("limit", key, "current", usage, "max", max),
                    "/" + slug + "/settings/usage", "org", org);
        }
    }
}
