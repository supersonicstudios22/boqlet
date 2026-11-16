package com.boqlet.api.identity;

import com.boqlet.contract.api.MeApi;
import com.boqlet.contract.model.Me;
import com.boqlet.contract.model.MeMembershipsInner;
import com.boqlet.contract.model.NotificationPreferences;
import com.boqlet.contract.model.Org;
import com.boqlet.contract.model.OrgRole;
import com.boqlet.contract.model.OrgSettings;
import com.boqlet.contract.model.OrgSetup;
import com.boqlet.contract.model.UpdateMeRequest;
import com.boqlet.contract.model.User;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.RestController;

@RestController
class MeController implements MeApi {
    private static final Set<String> CATEGORIES = Set.of("jobs", "versions", "reviews", "membership", "limits");

    private final IdentityService identities;
    private final JdbcTemplate database;
    private final ObjectMapper json;

    MeController(IdentityService identities, JdbcTemplate database, ObjectMapper json) {
        this.identities = identities;
        this.database = database;
        this.json = json;
    }

    @Override
    public ResponseEntity<Me> getMe() {
        var login = Login.current();
        var memberships = database.query("""
                SELECT o.id, o.name, o.slug, o.settings::text, o.setup::text, o.status, o.created_at, m.role
                FROM memberships m JOIN orgs o ON o.id = m.org_id
                WHERE m.user_id = ? AND o.status IN ('active', 'suspended')
                ORDER BY o.name, o.id
                """, (row, index) -> {
            Org org = new Org(row.getObject("id", UUID.class), row.getString("name"), row.getString("slug"),
                    "free", read(row.getString("settings"), OrgSettings.class));
            org.setStatus(Org.StatusEnum.fromValue(row.getString("status")));
            org.setSetup(read(row.getString("setup"), OrgSetup.class));
            org.setCreatedAt(row.getObject("created_at", OffsetDateTime.class));
            return new MeMembershipsInner(org, OrgRole.fromValue(row.getString("role")));
        }, login.userId());
        return ResponseEntity.ok(new Me(identities.user(login.userId()), memberships).session(login.session()));
    }

    @Override
    public ResponseEntity<User> updateMe(UpdateMeRequest request) {
        var user = Login.current().userId();
        String name = request.getName();
        if (name != null && name.isBlank()) {
            throw IdentityService.failure(HttpStatus.BAD_REQUEST, "invalid_body", "The name can't be empty.");
        }
        database.update("""
                UPDATE users SET name = coalesce(?, name), locale = coalesce(?, locale), updated_at = now()
                WHERE id = ?
                """, name == null ? null : name.trim(), request.getLocale(), user);
        return ResponseEntity.ok(identities.user(user));
    }

    @Override
    public ResponseEntity<NotificationPreferences> getNotificationPreferences() {
        return ResponseEntity.ok(preferences(Login.current().userId()));
    }

    @Override
    public ResponseEntity<NotificationPreferences> setNotificationPreferences(NotificationPreferences request) {
        Map<String, Boolean> provided = request.getEmail();
        if (provided != null) {
            if (provided.keySet().stream().anyMatch(key -> !CATEGORIES.contains(key))
                    || provided.containsValue(null)) {
                throw IdentityService.failure(HttpStatus.BAD_REQUEST, "invalid_body", "Invalid notification category.");
            }
            database.update("""
                    UPDATE users SET notification_preferences = notification_preferences || CAST(? AS jsonb), updated_at = now()
                    WHERE id = ?
                    """, json.valueToTree(provided).toString(), Login.current().userId());
        }
        return getNotificationPreferences();
    }

    private NotificationPreferences preferences(UUID user) {
        String encoded = database.queryForObject("""
                SELECT notification_preferences::text FROM users WHERE id = ?
                """, String.class, user);
        var saved = read(encoded, com.fasterxml.jackson.databind.JsonNode.class);
        var email = new LinkedHashMap<String, Boolean>();
        CATEGORIES.stream().sorted().forEach(category -> email.put(category, saved.path(category).asBoolean(true)));
        return new NotificationPreferences().email(email);
    }

    private <T> T read(String encoded, Class<T> type) {
        try {
            return encoded == null ? null : json.readValue(encoded, type);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException("Invalid stored identity data.", failure);
        }
    }
}
