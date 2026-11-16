package com.boqlet.api.audit;

import com.boqlet.api.db.Ids;
import com.boqlet.api.http.RequestContext;
import com.fasterxml.jackson.databind.JsonNode;
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

    public AuditWriter(JdbcTemplate database) {
        this.database = database;
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
    }
}
