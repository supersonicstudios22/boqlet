package com.boqlet.api.identity;

import com.boqlet.api.org.OrgAccess;
import com.boqlet.api.extension.CoreModules;
import com.boqlet.contract.api.MeApi;
import com.boqlet.contract.model.Me;
import com.boqlet.contract.model.MeMembershipsInner;
import com.boqlet.contract.model.NotificationPreferences;
import com.boqlet.contract.model.UpdateMeRequest;
import com.boqlet.contract.model.User;
import com.boqlet.contract.model.UserPreferences;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
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
    private final OrgAccess orgs;
    private final CoreModules modules;

    MeController(IdentityService identities, JdbcTemplate database, ObjectMapper json, OrgAccess orgs, CoreModules modules) {
        this.identities = identities;
        this.database = database;
        this.json = json;
        this.orgs = orgs;
        this.modules = modules;
    }

    @Override
    public ResponseEntity<Me> getMe() {
        var login = Login.current();
        var memberships = orgs.list(login.userId()).stream()
                .map(membership -> new MeMembershipsInner(membership.org(), membership.role())).toList();
        return ResponseEntity.ok(new Me().user(identities.user(login.userId())).memberships(memberships)
                .preferences(interfacePreferences(login.userId()))
                .session(login.session()).modules(modules.profile(login.userId())));
    }

    @Override
    public ResponseEntity<User> updateMe(UpdateMeRequest request) {
        var user = Login.current().userId();
        String name = request.getName();
        if (name != null && name.isBlank()) {
            throw IdentityService.failure(HttpStatus.BAD_REQUEST, "invalid_body", "The name can't be empty.");
        }
        if (request.getLocale() != null && !languageTag(request.getLocale())) {
            throw new com.boqlet.api.http.ApiException(HttpStatus.BAD_REQUEST, "invalid_body",
                    "The locale must be a language tag such as en or sr-Latn.", Map.of("field", "locale"));
        }
        var split = request.getPreferences() == null ? null : request.getPreferences().getSheetSplit();
        if (split != null && (split < 30 || split > 75)) {
            throw new com.boqlet.api.http.ApiException(HttpStatus.BAD_REQUEST, "invalid_body",
                    "The sheet's share of the width is a percentage from 30 to 75.", Map.of("field", "preferences.sheetSplit"));
        }
        // Preferences merge: a key the request leaves out keeps its stored value (TF-109).
        String preferences = request.getPreferences() == null ? null : json.valueToTree(request.getPreferences()).toString();
        database.update("""
                UPDATE users SET name = coalesce(?, name), locale = coalesce(?, locale),
                    preferences = preferences || coalesce(CAST(? AS jsonb), '{}'), updated_at = now()
                WHERE id = ?
                """, name == null ? null : name.trim(), request.getLocale(), preferences, user);
        return ResponseEntity.ok(identities.user(user));
    }

    /**
     * A well-formed BCP 47 language tag (TF-121). Not limited to the app's UI languages: mails come in
     * more of them, and the app falls back to its default for a language it doesn't have.
     */
    static boolean languageTag(String value) {
        if (value.isBlank() || !value.matches("[A-Za-z0-9-]{2,64}")) return false;
        try {
            new java.util.Locale.Builder().setLanguageTag(value);
            return true;
        } catch (java.util.IllformedLocaleException failure) {
            return false;
        }
    }

    @Override
    public ResponseEntity<NotificationPreferences> getNotificationPreferences() {
        return ResponseEntity.ok(preferences(Login.current().userId()));
    }

    @Override
    public ResponseEntity<NotificationPreferences> setNotificationPreferences(NotificationPreferences request) {
        Map<String, Boolean> provided = request.getEmail();
        if (provided != null) {
            if (provided.keySet().stream().anyMatch(key -> !categories().contains(key))
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

    /** The interface preferences (Q55, TF-109): stored keys the contract no longer has are left out. */
    private UserPreferences interfacePreferences(UUID user) {
        var stored = read(database.queryForObject("SELECT preferences::text FROM users WHERE id = ?", String.class, user),
                com.fasterxml.jackson.databind.JsonNode.class);
        var preferences = new UserPreferences();
        if (stored != null && stored.path("notInModelsCollapsed").isBoolean()) {
            preferences.notInModelsCollapsed(stored.path("notInModelsCollapsed").asBoolean());
        }
        if (stored != null && stored.path("sheetModelOpen").isBoolean()) {
            preferences.sheetModelOpen(stored.path("sheetModelOpen").asBoolean());
        }
        if (stored != null && stored.path("sheetSplit").isInt()) {
            preferences.sheetSplit(stored.path("sheetSplit").asInt());
        }
        if (stored != null && stored.path("sheetDensity").isTextual()) {
            try {
                preferences.sheetDensity(UserPreferences.SheetDensityEnum.fromValue(stored.path("sheetDensity").asText()));
            } catch (IllegalArgumentException unknown) {
                // A value the contract no longer has is left out, as an unknown key is.
            }
        }
        if (stored != null && stored.path("sheetWrapText").isBoolean()) {
            preferences.sheetWrapText(stored.path("sheetWrapText").asBoolean());
        }
        return preferences;
    }

    private NotificationPreferences preferences(UUID user) {
        String encoded = database.queryForObject("""
                SELECT notification_preferences::text FROM users WHERE id = ?
                """, String.class, user);
        var saved = read(encoded, com.fasterxml.jackson.databind.JsonNode.class);
        var email = new LinkedHashMap<String, Boolean>();
        categories().stream().sorted().forEach(category -> email.put(category, saved.path(category).asBoolean(true)));
        return new NotificationPreferences().email(email);
    }

    private Set<String> categories() {
        var categories = new java.util.HashSet<>(CATEGORIES);
        modules.emailTemplates().values().forEach(template -> categories.add(template.category()));
        return categories;
    }

    private <T> T read(String encoded, Class<T> type) {
        try {
            return encoded == null ? null : json.readValue(encoded, type);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException("Invalid stored identity data.", failure);
        }
    }
}
