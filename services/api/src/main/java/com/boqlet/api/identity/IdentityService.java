package com.boqlet.api.identity;

import com.boqlet.api.db.Ids;
import com.boqlet.api.http.ApiException;
import com.boqlet.contract.model.User;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IdentityService {
    private final JdbcTemplate database;
    private final Set<String> pilotEmails;

    public IdentityService(JdbcTemplate database, @Value("${boqlet.auth.pilot-emails:}") String allowed) {
        this.database = database;
        this.pilotEmails = Arrays.stream(allowed.split(","))
                .map(IdentityService::normalizeEmail).filter(email -> !email.isEmpty()).collect(Collectors.toUnmodifiableSet());
    }

    @Transactional
    public Login authenticate(Jwt token) {
        String subject = token.getSubject();
        String email = token.getClaimAsString("email");
        String providerSession = token.getClaimAsString("sid");
        if (subject == null || subject.isBlank() || providerSession == null || providerSession.isBlank()) {
            throw failure(HttpStatus.UNAUTHORIZED, "unauthenticated", "The identity token is missing a login session.");
        }
        if (email == null || email.isBlank() || !Boolean.TRUE.equals(token.getClaimAsBoolean("email_verified"))) {
            throw failure(HttpStatus.FORBIDDEN, "email_unverified", "Verify your email before continuing.");
        }
        String normalized = normalizeEmail(email);
        var identities = database.query("SELECT id, deleted_at IS NOT NULL AS deleted FROM users WHERE auth_subject = ?",
                (row, index) -> new Existing(row.getObject("id", UUID.class), row.getBoolean("deleted")), subject);
        if (!identities.isEmpty()) {
            var user = identities.getFirst();
            if (user.deleted()) {
                throw failure(HttpStatus.FORBIDDEN, "account_deleted", "This account has been deleted.");
            }
            return new Login(user.id(), providerSession, null);
        }

        boolean invited = Boolean.TRUE.equals(database.queryForObject("""
                SELECT EXISTS (
                    SELECT 1 FROM org_invitations i JOIN orgs o ON o.id = i.org_id
                    WHERE lower(i.email) = ? AND i.status = 'pending' AND i.expires_at > now() AND o.status = 'active'
                )
                """, Boolean.class, normalized));
        if (!invited && !pilotEmails.contains(normalized)) {
            throw failure(HttpStatus.FORBIDDEN, "invitation_required", "An invitation is required to join the pilot.");
        }

        String name = token.getClaimAsString("name");
        String locale = token.getClaimAsString("locale");
        database.update("""
                INSERT INTO users (id, auth_subject, email, name, locale) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT DO NOTHING
                """, Ids.newId(), subject, normalized, name == null || name.isBlank() ? normalized : name,
                locale == null || locale.isBlank() ? "en" : locale);
        var userIds = database.query("SELECT id FROM users WHERE auth_subject = ? AND deleted_at IS NULL",
                (row, index) -> row.getObject("id", UUID.class), subject);
        if (userIds.isEmpty()) {
            throw failure(HttpStatus.CONFLICT, "identity_conflict", "That email is linked to another account.");
        }
        return new Login(userIds.getFirst(), providerSession, null);
    }

    public User user(UUID userId) {
        return database.queryForObject("""
                SELECT id, email, name, locale, platform_role FROM users WHERE id = ? AND deleted_at IS NULL
                """, IdentityService::mapUser, userId);
    }

    public boolean platformAdmin(UUID actor) {
        return Boolean.TRUE.equals(database.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM users WHERE id = ? AND platform_role = 'admin' AND deleted_at IS NULL)
                """, Boolean.class, actor));
    }

    public static User mapUser(ResultSet row, int index) throws SQLException {
        var user = new User(row.getObject("id", UUID.class), row.getString("email"), row.getString("name"),
                row.getString("locale"));
        String role = row.getString("platform_role");
        if (role != null) {
            user.setPlatformRole(User.PlatformRoleEnum.fromValue(role));
        }
        return user;
    }

    private record Existing(UUID id, boolean deleted) {}

    static String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    static ApiException failure(HttpStatus status, String code, String message) {
        return new ApiException(status, code, message, Map.of());
    }
}
