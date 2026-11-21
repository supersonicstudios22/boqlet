package com.boqlet.api.worker;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
class JobMetrics {
    private final JdbcTemplate database;
    private final MeterRegistry meters;
    private final Map<String, Pool> pools = new ConcurrentHashMap<>();

    JobMetrics(JdbcTemplate database, MeterRegistry meters) {
        this.database = database;
        this.meters = meters;
    }

    @Scheduled(fixedDelayString = "${BOQLET_JOB_METRICS_POLL_MS:30000}", initialDelay = 5000)
    void collect() {
        Set<String> seen = new HashSet<>();
        database.query("""
                SELECT pool, count(*) FILTER (WHERE status = 'queued') AS queued,
                    count(*) FILTER (WHERE status = 'running') AS running,
                    coalesce(extract(epoch FROM (now() - min(available_at) FILTER (
                        WHERE status = 'queued' AND available_at <= now()))), 0)::bigint AS oldest
                FROM jobs WHERE status IN ('queued','running') GROUP BY pool
                """, row -> {
                    String name = row.getString("pool");
                    var pool = pools.computeIfAbsent(name, this::register);
                    pool.set(row.getLong("queued"), row.getLong("running"), row.getLong("oldest"));
                    seen.add(name);
                });
        pools.forEach((name, pool) -> { if (!seen.contains(name)) pool.set(0, 0, 0); });
    }

    private Pool register(String name) {
        var counters = new Pool(new AtomicLong(), new AtomicLong(), new AtomicLong());
        Gauge.builder("boqlet.jobs.queued", counters.queued(), AtomicLong::get).tag("pool", name).register(meters);
        Gauge.builder("boqlet.jobs.running", counters.running(), AtomicLong::get).tag("pool", name).register(meters);
        Gauge.builder("boqlet.jobs.oldest.wait.seconds", counters.oldest(), AtomicLong::get).tag("pool", name).register(meters);
        return counters;
    }

    private record Pool(AtomicLong queued, AtomicLong running, AtomicLong oldest) {
        void set(long queueSize, long active, long waiting) {
            queued.set(queueSize);
            running.set(active);
            oldest.set(waiting);
        }
    }
}
