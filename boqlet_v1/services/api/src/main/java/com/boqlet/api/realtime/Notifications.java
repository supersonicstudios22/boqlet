package com.boqlet.api.realtime;

import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.extension.CoreModules;
import com.boqlet.api.http.ApiException;
import com.boqlet.contract.model.ListNotifications200Response;
import com.boqlet.contract.model.Notification;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class Notifications {
    private static final String ACCESS = """
             AND (n.org_id IS NULL OR EXISTS (
                  SELECT 1 FROM memberships m JOIN orgs o ON o.id = m.org_id AND o.status <> 'deleting'
                  LEFT JOIN project_members p ON p.org_id = m.org_id AND p.user_id = m.user_id AND p.project_id = n.project_id
                  WHERE m.org_id = n.org_id AND m.user_id = n.user_id
                    AND (n.project_id IS NULL OR m.role IN ('owner','admin') OR p.user_id IS NOT NULL)))
            """;
    private final JdbcTemplate database;
    private final StoredJson json;
    private final CoreModules modules;

    Notifications(JdbcTemplate database, StoredJson json, CoreModules modules) {
        this.database = database;
        this.json = json;
        this.modules = modules;
    }

    public void send(UUID user, UUID org, UUID project, String kind, String category, Map<String, ?> params,
                     String url, String entity, UUID entityId) {
        UUID id = Ids.newId();
        String data = json.object(params).toString();
        database.update("""
                INSERT INTO notifications (id, user_id, org_id, project_id, kind, params, url, entity_type, entity_id)
                VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?)
                """, id, user, org, project, kind, data, url, entity, entityId);
        var template = modules.emailTemplates().get(kind);
        if (template != null) category = template.category();
        if (org == null || category == null) return;
        database.update("""
                INSERT INTO email_outbox (id, org_id, kind, entity_id, recipient, payload)
                SELECT ?, ?, 'notification', ?, email, CAST(? AS jsonb)
                FROM users WHERE id = ? AND deleted_at IS NULL
                    AND coalesce((notification_preferences->>?)::boolean, true)
                """, Ids.newId(), org, id, json.object(Map.of("kind", kind, "category", category, "url", url, "params", params)).toString(),
                user, category);
    }

    public List<UUID> projectAudience(UUID org, UUID project, UUID actor) {
        return database.queryForList("""
                SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
                LEFT JOIN project_members p ON p.org_id = m.org_id AND p.project_id = ? AND p.user_id = m.user_id
                WHERE m.org_id = ? AND m.user_id IS DISTINCT FROM CAST(? AS uuid)
                    AND (m.role IN ('owner','admin') OR p.user_id IS NOT NULL)
                """, UUID.class, project, org, actor);
    }

    public String projectUrl(UUID org, UUID project) {
        String slug = database.queryForObject("SELECT slug FROM orgs WHERE id = ?", String.class, org);
        return "/" + slug + "/projects/" + project;
    }

    ListNotifications200Response list(UUID actor, String cursor, int limit, boolean unreadOnly) {
        int start = start(cursor);
        int size = Math.clamp(limit, 1, 200);
        String filter = " FROM notifications n WHERE n.user_id = ? " + ACCESS;
        int unread = database.queryForObject("SELECT count(*)" + filter + " AND n.read_at IS NULL", Integer.class, actor);
        var items = database.query("SELECT n.*" + filter + (unreadOnly ? " AND n.read_at IS NULL" : "")
                + " ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?", this::view, actor, size + 1, start);
        return new ListNotifications200Response(items.size() > size ? items.subList(0, size) : items, unread)
                .nextCursor(items.size() > size ? Long.toString((long) start + size) : null);
    }

    void mark(UUID actor, UUID id) {
        String sql = "UPDATE notifications n SET read_at = coalesce(n.read_at, now()) WHERE n.user_id = ?" + ACCESS;
        if (id == null) {
            database.update(sql + " AND n.read_at IS NULL", actor);
        } else if (database.update(sql + " AND n.id = ?", actor, id) == 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "The notification was not found.", Map.of());
        }
    }

    private Notification view(ResultSet row, int index) throws SQLException {
        return new Notification(row.getObject("id", UUID.class), row.getString("kind"),
                json.read(row.getString("params"), Map.class), row.getString("url"), row.getObject("created_at", OffsetDateTime.class))
                .orgId(row.getObject("org_id", UUID.class)).entityType(row.getString("entity_type"))
                .entityId(row.getString("entity_id")).readAt(row.getObject("read_at", OffsetDateTime.class));
    }

    private static int start(String cursor) {
        if (cursor == null) return 0;
        try {
            int value = Integer.parseInt(cursor);
            if (value >= 0) return value;
        } catch (NumberFormatException ignored) {
            // The caller can retry without a cursor.
        }
        throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_param", "The notification cursor is invalid.", Map.of());
    }
}
