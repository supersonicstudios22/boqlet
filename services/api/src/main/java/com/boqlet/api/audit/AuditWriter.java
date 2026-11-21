package com.boqlet.api.audit;

import com.boqlet.api.db.Ids;
import com.boqlet.api.extension.CoreEvents;
import com.boqlet.api.extension.CoreModules;
import com.boqlet.api.http.RequestContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.util.Set;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuditWriter {
    public enum ActorKind {
        USER("user"), SYSTEM("system"), PLATFORM_ADMIN("platform_admin");

        private final String databaseValue;

        ActorKind(String databaseValue) {
            this.databaseValue = databaseValue;
        }
    }

    private final JdbcTemplate database;
    private final CoreEvents events;
    private final CoreModules modules;
    private static final Set<String> CORE_EVENTS = Set.of("run.completed", "version.saved", "boq.confirmed",
            "boq.reopened", "project.archived", "org.deleted", "user.deleted", "line.edited");

    public AuditWriter(JdbcTemplate database, CoreEvents events, CoreModules modules) {
        this.database = database;
        this.events = events;
        this.modules = modules;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(RequestContext context, ActorKind actorKind, UUID projectId, String action,
            String entityType, UUID entityId, JsonNode data) {
        database.update("""
                INSERT INTO audit_events
                    (id, org_id, project_id, actor_id, actor_kind, action, entity_type, entity_id, data, request_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?)
                """,
                Ids.newId(), context == null ? null : context.orgId(), projectId,
                context == null ? null : context.userId(), actorKind.databaseValue, action,
                entityType, entityId, data == null ? "{}" : data.toString(), MDC.get("requestId"));
        if (CORE_EVENTS.contains(action)) {
            String name = switch (action) {
                case "org.deleted" -> "org.deleting";
                case "line.edited" -> "line_edits.changed";
                default -> action;
            };
            var payload = JsonNodeFactory.instance.objectNode();
            if (data != null) {
                for (String key : Set.of("boqId", "revisionId", "runId", "status", "label", "lineKeys")) {
                    if (data.has(key)) payload.set(key, data.get(key).deepCopy());
                }
            }
            events.afterCommit(new CoreEvents.Event(name, context == null ? null : context.orgId(), projectId, entityId, payload));
        }
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void recordModule(RequestContext context, ActorKind actor, UUID project, String action,
                             String entityType, UUID entity, JsonNode data) {
        if (!modules.hasAuditAction(action)) throw new IllegalArgumentException("Unregistered module audit action.");
        record(context, actor, project, action, entityType, entity, data);
    }
}
