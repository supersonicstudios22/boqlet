package com.boqlet.api.extension;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.PreDestroy;
import java.util.UUID;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Component
public class CoreEvents {
    private static final Logger LOG = LoggerFactory.getLogger(CoreEvents.class);
    private final ApplicationEventPublisher publisher;
    private final java.util.concurrent.ExecutorService deliveries = Executors.newVirtualThreadPerTaskExecutor();

    public record Event(String name, UUID orgId, UUID projectId, UUID subjectId, JsonNode data) {}

    CoreEvents(ApplicationEventPublisher publisher) { this.publisher = publisher; }

    public void afterCommit(Event event) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                if (deliveries.isShutdown()) return;
                try {
                    deliveries.submit(() -> {
                        try {
                            publisher.publishEvent(event);
                        } catch (RuntimeException failure) {
                            LOG.error("Core event {} could not be delivered for {}", event.name(), event.subjectId(), failure);
                        }
                    });
                } catch (java.util.concurrent.RejectedExecutionException stopped) {
                    LOG.debug("Event publisher stopped during shutdown");
                }
            }
        });
    }

    @PreDestroy
    void close() { deliveries.shutdownNow(); }
}
