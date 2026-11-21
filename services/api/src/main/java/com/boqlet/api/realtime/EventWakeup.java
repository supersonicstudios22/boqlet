package com.boqlet.api.realtime;

import com.boqlet.api.worker.QueueWakeup;

import jakarta.annotation.PreDestroy;
import java.sql.SQLException;
import java.util.concurrent.Executors;
import javax.sql.DataSource;
import org.postgresql.PGConnection;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

@Component
class EventWakeup {
    private final DataSource pool;
    private final ApplicationEventPublisher events;
    private final java.util.concurrent.ExecutorService listener = Executors.newSingleThreadExecutor();
    private long generation;

    EventWakeup(DataSource pool, ApplicationEventPublisher events) {
        this.pool = pool;
        this.events = events;
    }

    @EventListener(ApplicationReadyEvent.class)
    void start() { listener.submit(this::listen); }

    synchronized long generation() { return generation; }

    synchronized void await(long observed) throws InterruptedException {
        if (observed == generation) wait(1000);
    }

    private synchronized void wake() {
        generation++;
        notifyAll();
    }

    private void listen() {
        while (!Thread.currentThread().isInterrupted()) {
            try (var connection = pool.getConnection(); var statement = connection.createStatement()) {
                statement.execute("LISTEN boqlet_events");
                statement.execute("LISTEN job_finished");
                PGConnection pg = connection.unwrap(PGConnection.class);
                while (!Thread.currentThread().isInterrupted()) {
                    var notices = pg.getNotifications(1000);
                    if (notices == null) continue;
                    boolean queue = false;
                    boolean realtime = false;
                    for (var notice : notices) {
                        queue |= "job_finished".equals(notice.getName());
                        realtime |= "boqlet_events".equals(notice.getName());
                    }
                    if (queue) events.publishEvent(new QueueWakeup());
                    if (realtime) wake();
                }
                statement.execute("UNLISTEN *");
            } catch (SQLException error) {
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException stopped) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }

    @PreDestroy
    void stop() { listener.shutdownNow(); }
}
