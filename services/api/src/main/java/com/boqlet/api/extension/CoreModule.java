package com.boqlet.api.extension;

import com.boqlet.contract.model.AdminOverviewTilesValue;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.BiFunction;

public interface CoreModule {
    String key();

    default Map<String, Object> profile(UUID user) { return Map.of(); }
    default String accountKind(UUID user) { return null; }
    default Map<String, AdminOverviewTilesValue> metrics(LocalDate from, LocalDate to) { return Map.of(); }
    default Map<String, EmailTemplate> notificationTemplates() { return Map.of(); }
    default Set<String> auditActions() { return Set.of(); }
    default Map<String, EntitlementType> entitlementKeys() { return Map.of(); }
    default List<ScheduledTask> scheduledTasks() { return List.of(); }

    enum EntitlementType { NUMBER, BOOLEAN }

    record EmailTemplate(String category, BiFunction<String, JsonNode, EmailText> render) {}
    record EmailText(String subject, String body) {}
    record ScheduledTask(String name, Duration interval, Runnable action) {}
}
