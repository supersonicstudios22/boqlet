package com.boqlet.api.audit;

import com.boqlet.api.db.StoredJson;
import com.boqlet.contract.model.AuditEvent;
import com.boqlet.contract.model.AuditPage;
import com.boqlet.api.http.ApiException;
import com.boqlet.contract.model.UserRef;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AuditReader {
    private final NamedParameterJdbcTemplate database;
    private final StoredJson json;

    AuditReader(NamedParameterJdbcTemplate database, StoredJson json) {
        this.database = database;
        this.json = json;
    }

    public AuditPage page(UUID org, UUID project, String cursor, int limit, String actorId, String action,
                          String entityType, OffsetDateTime from, OffsetDateTime to) {
        int offset = offset(cursor);
        int count = Math.clamp(limit, 1, 1000);
        var parameters = new MapSqlParameterSource().addValue("org", org)
                .addValue("count", count + 1).addValue("offset", offset);
        var sql = new StringBuilder("""
                SELECT a.*, u.name AS actor_name, u.email AS actor_email FROM audit_events a
                LEFT JOIN users u ON u.id = a.actor_id AND u.deleted_at IS NULL
                WHERE a.org_id = :org
                """);
        filter(sql, parameters, "project", "a.project_id = :project", project);
        filter(sql, parameters, "actor", "a.actor_id::text = :actor", actorId);
        filter(sql, parameters, "action", "a.action = :action", action);
        filter(sql, parameters, "entity", "a.entity_type = :entity", entityType);
        filter(sql, parameters, "start", "a.created_at >= :start", from);
        filter(sql, parameters, "end", "a.created_at <= :end", to);
        sql.append(" ORDER BY a.created_at DESC, a.id DESC LIMIT :count OFFSET :offset");
        var rows = database.query(sql.toString(), parameters, (row, index) -> {
            var event = new AuditEvent(row.getObject("id", UUID.class), row.getString("action"),
                    row.getString("entity_type"), row.getString("entity_id"),
                    row.getObject("created_at", OffsetDateTime.class))
                    .actorKind(AuditEvent.ActorKindEnum.fromValue(row.getString("actor_kind")))
                    .projectId(row.getObject("project_id", UUID.class));
            if (row.getString("actor_name") != null) {
                event.setActor(new UserRef(row.getObject("actor_id", UUID.class), row.getString("actor_name"))
                        .email(row.getString("actor_email")));
            }
            event.setData(json.read(row.getString("data"), Map.class));
            return event;
        });
        return rows.size() > count ? new AuditPage(rows.subList(0, count)).nextCursor(Long.toString((long) offset + count))
                : new AuditPage(rows).nextCursor(null);
    }

    private static int offset(String cursor) {
        if (cursor == null) return 0;
        try {
            int value = Integer.parseInt(cursor);
            if (value >= 0) return value;
        } catch (NumberFormatException ignored) {
            // The API reports opaque cursors that cannot be reused.
        }
        throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_cursor", "The audit cursor is invalid.", Map.of());
    }

    private static void filter(StringBuilder sql, MapSqlParameterSource parameters, String key, String expression, Object value) {
        if (value != null) {
            sql.append(" AND ").append(expression);
            parameters.addValue(key, value);
        }
    }
}
