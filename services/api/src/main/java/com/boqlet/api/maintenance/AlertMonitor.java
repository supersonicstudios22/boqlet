package com.boqlet.api.maintenance;

import com.boqlet.api.storage.ObjectStorage;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The alerts of deployment.md "Observability" (BE-025), checked every minute by each API instance:
 * queue wait over 5 min, job failure rate over 5 % in the last hour, API 5xx over 1 % in the last
 * 5 min, database connections over 80 % of the pool, and storage errors (a probe). Alerts go to the
 * log only for now (the owner, 2026-11-21): a WARN line `alert.firing` when one starts and an INFO
 * line `alert.resolved` when it ends, each with `alert`, `value` and `threshold` fields, plus a
 * `boqlet.alerts.firing` gauge per alert for a monitoring system to route later.
 */
@Component
public class AlertMonitor {
    private static final Logger log = LoggerFactory.getLogger(AlertMonitor.class);
    static final String QUEUE_WAIT = "queue_wait", JOB_FAILURES = "job_failure_rate", API_ERRORS = "api_5xx_rate",
            DB_CONNECTIONS = "db_connections", STORAGE = "storage_errors";

    /** A measurement: its value, the threshold, and whether there was enough to judge (no data: unknown). */
    record Reading(double value, double threshold, boolean known) {
        static Reading unknown(double threshold) {
            return new Reading(0, threshold, false);
        }

        boolean over() {
            return known && value > threshold;
        }
    }

    private final JdbcTemplate database;
    private final MeterRegistry meters;
    private final ObjectStorage storage;
    private final boolean storageConfigured;
    private final Map<String, AtomicInteger> firing = new ConcurrentHashMap<>();
    /** (total, 5xx) request counts at each of the last minutes, for a 5-minute window. */
    private final ArrayDeque<long[]> requests = new ArrayDeque<>();

    public AlertMonitor(JdbcTemplate database, MeterRegistry meters, ObjectStorage storage,
                        @Value("${boqlet.storage.bucket:}") String bucket) {
        this.database = database;
        this.meters = meters;
        this.storage = storage;
        this.storageConfigured = !bucket.isBlank();
        for (String alert : new String[] {QUEUE_WAIT, JOB_FAILURES, API_ERRORS, DB_CONNECTIONS, STORAGE}) {
            var state = new AtomicInteger();
            firing.put(alert, state);
            Gauge.builder("boqlet.alerts.firing", state, AtomicInteger::get).tag("alert", alert).register(meters);
        }
    }

    @Scheduled(fixedDelayString = "${BOQLET_ALERT_POLL_MS:60000}", initialDelay = 60000)
    public void check() {
        judge(QUEUE_WAIT, queueWait());
        judge(JOB_FAILURES, jobFailures());
        judge(API_ERRORS, apiErrors());
        judge(DB_CONNECTIONS, dbConnections());
        judge(STORAGE, storageProbe());
    }

    /** Logs a change of state (firing or resolved); an unknown reading keeps the state. Returns whether it fires. */
    boolean judge(String alert, Reading reading) {
        var state = firing.get(alert);
        if (!reading.known()) return state.get() == 1;
        int now = reading.over() ? 1 : 0;
        if (state.getAndSet(now) != now) {
            var line = (now == 1 ? log.atWarn() : log.atInfo()).addKeyValue("alert", alert)
                    .addKeyValue("value", reading.value()).addKeyValue("threshold", reading.threshold());
            line.log(now == 1 ? "alert.firing {}: {} > {}" : "alert.resolved {}: {} <= {}", alert, reading.value(), reading.threshold());
        }
        return now == 1;
    }

    /** Seconds the oldest due job has waited, in the pool where it is longest. */
    Reading queueWait() {
        Double seconds = database.queryForObject("""
                SELECT extract(epoch FROM now() - min(available_at)) FROM jobs
                WHERE status = 'queued' AND available_at <= now()
                """, Double.class);
        return seconds == null ? new Reading(0, 300, true) : new Reading(seconds, 300, true);
    }

    /** Failed share of the jobs finished in the last hour; judged from 20 jobs on. */
    Reading jobFailures() {
        var counts = database.queryForMap("""
                SELECT count(*) AS total, count(*) FILTER (WHERE status = 'failed') AS failed FROM jobs
                WHERE finished_at > now() - interval '1 hour' AND status IN ('succeeded', 'failed')
                """);
        long total = ((Number) counts.get("total")).longValue();
        long failed = ((Number) counts.get("failed")).longValue();
        return total < 20 ? Reading.unknown(0.05) : new Reading((double) failed / total, 0.05, true);
    }

    /** Share of API responses that were 5xx over the last 5 minutes; judged from 100 requests on. */
    Reading apiErrors() {
        long total = 0, errors = 0;
        for (Timer timer : meters.find("http.server.requests").timers()) {
            long count = timer.count();
            total += count;
            if ("SERVER_ERROR".equals(timer.getId().getTag("outcome"))) errors += count;
        }
        requests.addLast(new long[] {total, errors});
        while (requests.size() > 6) requests.removeFirst();
        long[] first = requests.getFirst();
        long window = total - first[0];
        return window < 100 ? Reading.unknown(0.01) : new Reading((double) (errors - first[1]) / window, 0.01, true);
    }

    /** Active share of the database connection pool. */
    Reading dbConnections() {
        var active = meters.find("hikaricp.connections.active").gauge();
        var max = meters.find("hikaricp.connections.max").gauge();
        if (active == null || max == null || max.value() <= 0) return Reading.unknown(0.8);
        return new Reading(active.value() / max.value(), 0.8, true);
    }

    /** 1 when object storage cannot be reached (a HEAD on a probe key), else 0. */
    Reading storageProbe() {
        if (!storageConfigured) return Reading.unknown(0);
        try {
            storage.exists("health/alert-probe");
            return new Reading(0, 0, true);
        } catch (RuntimeException failure) {
            log.atWarn().addKeyValue("alert", STORAGE).setCause(failure).log("Storage probe failed");
            return new Reading(1, 0, true);
        }
    }
}
