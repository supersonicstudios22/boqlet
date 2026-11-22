package com.boqlet.api.worker;

import com.boqlet.api.db.StoredJson;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
class JobDispatcher {
    private static final Logger LOG = LoggerFactory.getLogger(JobDispatcher.class);
    private final Jobs jobs;
    private final WorkerClient worker;
    private final StoredJson json;
    private final Duration timeout;
    private final Semaphore slots;
    private final UUID id = UUID.randomUUID();
    private final AtomicBoolean queueWakeScheduled = new AtomicBoolean();
    private final ExecutorService running = Executors.newVirtualThreadPerTaskExecutor();
    private final java.util.concurrent.ScheduledExecutorService poller = Executors.newSingleThreadScheduledExecutor();

    JobDispatcher(Jobs jobs, WorkerClient worker, StoredJson json, @Value("${boqlet.worker.concurrency}") int slots,
                  @Value("${boqlet.worker.job-timeout}") Duration timeout) {
        this.jobs = jobs;
        this.worker = worker;
        this.json = json;
        this.slots = new Semaphore(Math.max(0, slots));
        this.timeout = timeout;
    }

    @EventListener(ApplicationReadyEvent.class)
    void poll() {
        poller.scheduleWithFixedDelay(this::dispatch, 0, 500, TimeUnit.MILLISECONDS);
        poller.scheduleWithFixedDelay(this::ingestQueue, 500, 1000, TimeUnit.MILLISECONDS);
        poller.scheduleWithFixedDelay(this::reclaim, 30, 30, TimeUnit.SECONDS);
    }

    private void reclaim() {
        try {
            jobs.reclaimLostJobs();
        } catch (RuntimeException failure) {
            LOG.error("Could not reclaim a lost worker job.", failure);
        }
    }

    @EventListener
    void queueWake(QueueWakeup signal) {
        if (!poller.isShutdown() && queueWakeScheduled.compareAndSet(false, true)) {
            try {
                poller.submit(() -> {
                    queueWakeScheduled.set(false);
                    ingestQueue();
                });
            } catch (java.util.concurrent.RejectedExecutionException shutdown) {
                queueWakeScheduled.set(false);
            }
        }
    }

    private void ingestQueue() {
        try {
            for (UUID job : jobs.pendingQueueJobs()) {
                try {
                    jobs.ingestQueueJob(job, false);
                } catch (RuntimeException failure) {
                    LOG.error("Could not ingest queue job {}.", job, failure);
                    jobs.ingestQueueJob(job, true);
                }
            }
        } catch (RuntimeException failure) {
            LOG.error("Could not process queue results.", failure);
        }
    }

    private void dispatch() {
        while (slots.tryAcquire()) {
            try {
                Jobs.Attempt attempt = jobs.claim(id);
                if (attempt == null) {
                    slots.release();
                    return;
                }
                running.submit(() -> {
                    try {
                        execute(attempt);
                    } finally {
                        slots.release();
                    }
                });
            } catch (RuntimeException failure) {
                slots.release();
                LOG.error("Could not claim a worker job.", failure);
                return;
            }
        }
    }

    private void execute(Jobs.Attempt attempt) {
        var subscriber = new java.util.function.Consumer<JsonNode>() {
            private String lastStage = "";
            private long updated;

            @Override
            public void accept(JsonNode event) {
                String stage = event.path("stage").asText();
                long now = System.nanoTime();
                if (!lastStage.equals(stage) || now - updated >= TimeUnit.SECONDS.toNanos(1)) {
                    jobs.progress(attempt, event);
                    lastStage = stage;
                    updated = now;
                }
            }
        };
        Future<JsonNode> exchange = running.submit(() -> worker.run(attempt.type(), attempt.envelope(), subscriber));
        try {
            jobs.finish(attempt, id, await(attempt, exchange));
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
        } catch (RuntimeException failure) {
            LOG.error("Could not ingest job {}.", attempt.id(), failure);
            try {
                jobs.finish(attempt, id, failed("ingestion_failed", "The server could not ingest the worker result.", true));
            } catch (RuntimeException retryFailure) {
                LOG.error("Could not record ingestion failure for job {}.", attempt.id(), retryFailure);
            }
        } finally {
            exchange.cancel(true);
        }
    }

    private JsonNode await(Jobs.Attempt attempt, Future<JsonNode> exchange) throws InterruptedException {
        long until = System.nanoTime() + timeout.toNanos();
        while (true) {
            long remaining = until - System.nanoTime();
            // Not retried: the same input times out again, and each attempt holds a worker for the whole timeout (TF-037).
            if (remaining <= 0) return failed("engine_timeout", "The worker exceeded the job timeout.", false);
            try {
                return exchange.get(Math.min(TimeUnit.SECONDS.toNanos(1), remaining), TimeUnit.NANOSECONDS);
            } catch (TimeoutException ignored) {
                if (!jobs.heartbeat(attempt, id)) return json.object(Map.of("status", "cancelled"));
            } catch (ExecutionException failure) {
                LOG.warn("Worker exchange failed for job {}.", attempt.id(), failure.getCause());
                return failed("engine_unavailable", "The worker could not finish this job.", true);
            }
        }
    }

    private JsonNode failed(String code, String message, boolean retryable) {
        return json.object(Map.of("status", "failed", "error", Map.of("code", code, "message", message, "retryable", retryable)));
    }

    @PreDestroy
    void stop() {
        poller.shutdownNow();
        running.shutdownNow();
    }
}
