package com.boqlet.api.realtime;

import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.identity.Login;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.http.HttpStatus;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class Realtime {
    private final JdbcTemplate database;
    private final StoredJson json;
    private final EventWakeup wakeup;
    private final java.util.concurrent.ExecutorService streams = Executors.newVirtualThreadPerTaskExecutor();

    /** Open live-update streams on this instance (deployment.md "SSE connections"). */
    private final java.util.concurrent.atomic.AtomicInteger open = new java.util.concurrent.atomic.AtomicInteger();

    Realtime(JdbcTemplate database, StoredJson json, EventWakeup wakeup, io.micrometer.core.instrument.MeterRegistry meters) {
        io.micrometer.core.instrument.Gauge.builder("boqlet.sse.connections", open, java.util.concurrent.atomic.AtomicInteger::get)
                .register(meters);
        this.database = database;
        this.json = json;
        this.wakeup = wakeup;
    }

    public void project(UUID org, UUID project, String event, Object data) {
        database.query("SELECT boq_event(?, ?, NULL, NULL, ?, CAST(? AS jsonb))", row -> {},
                org, project, event, json.object(data).toString());
    }

    public SseEmitter connect(Login login, String lastId, Instant expiry) {
        long cursor = cursor(lastId);
        UUID actor = login.userId();
        UUID session = login.session().getId();
        Instant stop = Instant.now().plus(Duration.ofMinutes(5));
        if (expiry != null && expiry.isBefore(stop)) stop = expiry;
        long duration = Math.max(1000, Duration.between(Instant.now(), stop).toMillis());
        var emitter = new SseEmitter(duration + 5000);
        var alive = new AtomicBoolean(true);
        emitter.onCompletion(() -> alive.set(false));
        emitter.onError(error -> alive.set(false));
        emitter.onTimeout(() -> alive.set(false));
        Instant until = stop;
        streams.submit(() -> stream(emitter, alive, actor, session, cursor, until));
        return emitter;
    }

    private void stream(SseEmitter emitter, AtomicBoolean alive, UUID actor, UUID session, long cursor, Instant until) {
        open.incrementAndGet();
        try {
            streamEvents(emitter, alive, actor, session, cursor, until);
        } finally {
            open.decrementAndGet();
        }
    }

    private void streamEvents(SseEmitter emitter, AtomicBoolean alive, UUID actor, UUID session, long cursor, Instant until) {
        try {
            emitter.send(SseEmitter.event().comment("connected").reconnectTime(1000));
            long heartbeat = System.nanoTime();
            while (alive.get() && Instant.now().isBefore(until)) {
                long observed = wakeup.generation();
                List<Event> data = page(actor, session, cursor);
                for (Event item : data) {
                    emitter.send(SseEmitter.event().id(Long.toString(item.id())).name(item.name()).data(item.data()));
                    cursor = item.id();
                    if (item.name().equals("session.revoked")) {
                        emitter.complete();
                        return;
                    }
                }
                if (data.size() >= 200) continue;
                if (!active(actor, session)) {
                    for (Event item : page(actor, session, cursor)) {
                        if (item.name().equals("session.revoked")) {
                            emitter.send(SseEmitter.event().id(Long.toString(item.id())).name(item.name()).data(item.data()));
                        }
                    }
                    break;
                }
                long now = System.nanoTime();
                if (now - heartbeat >= TimeUnit.SECONDS.toNanos(25)) {
                    emitter.send(SseEmitter.event().comment("heartbeat"));
                    heartbeat = now;
                }
                wakeup.await(observed);
            }
            emitter.complete();
        } catch (IOException | InterruptedException stopped) {
            if (stopped instanceof InterruptedException) Thread.currentThread().interrupt();
            emitter.complete();
        } catch (RuntimeException stopped) {
            emitter.completeWithError(stopped);
        }
    }

    private List<Event> page(UUID actor, UUID session, long after) {
        return database.query("""
                SELECT e.seq, e.event_type, e.data::text FROM realtime_events e
                WHERE e.seq > ? AND e.created_at >= now() - interval '5 minutes'
                  AND (e.session_id IS NULL OR e.session_id = ?)
                  AND (e.user_id IS NULL OR e.user_id = ?)
                  AND (e.event_type = 'session.revoked' OR EXISTS(
                        SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id
                        WHERE s.id = ? AND s.status = 'active'
                          AND s.last_seen_at > now() - interval '12 hours' AND u.deleted_at IS NULL))
                  AND (e.org_id IS NULL OR EXISTS(
                        SELECT 1 FROM memberships m JOIN orgs o ON o.id = m.org_id
                        LEFT JOIN project_members p ON p.org_id = m.org_id AND p.user_id = m.user_id AND p.project_id = e.project_id
                        WHERE m.org_id = e.org_id AND m.user_id = ? AND (o.status <> 'deleting' OR e.event_type = 'entity.changed')
                             AND (e.project_id IS NULL OR m.role IN ('owner','admin') OR p.user_id IS NOT NULL)))
                  AND (e.event_type NOT IN ('boq.line_edited','boq.presence') OR EXISTS(
                        SELECT 1 FROM boq_presence p WHERE p.boq_id::text = e.data->>'boqId' AND p.user_id = ?
                        AND p.expires_at > now()))
                ORDER BY e.seq LIMIT 200
                """, (row, index) -> new Event(row.getLong("seq"), row.getString("event_type"),
                    json.read(row.getString("data"), JsonNode.class)), after, session, actor, session, actor, actor);
    }

    private boolean active(UUID actor, UUID session) {
        return Boolean.TRUE.equals(database.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id
                   WHERE s.id = ? AND s.user_id = ? AND s.status = 'active'
                     AND s.last_seen_at > now() - interval '12 hours' AND u.deleted_at IS NULL)
                """, Boolean.class, session, actor));
    }

    private long cursor(String value) {
        long maximum = database.queryForObject("SELECT coalesce(max(seq), 0) FROM realtime_events", Long.class);
        if (value == null || value.isBlank()) return maximum;
        try {
            long parsed = Long.parseLong(value);
            if (parsed >= 0) return Math.min(parsed, maximum);
        } catch (NumberFormatException ignored) {
            // The caller sent an invalid replay cursor.
        }
        throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_param", "The event cursor is invalid.", Map.of());
    }

    @PreDestroy
    @EventListener(ContextClosedEvent.class)
    void stop() { streams.shutdownNow(); }

    private record Event(long id, String name, JsonNode data) {}
}
