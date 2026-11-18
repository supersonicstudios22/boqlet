package com.boqlet.api.identity;

import com.boqlet.api.db.Ids;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@ConditionalOnProperty(name = "BOQLET_NATIVE_AUTH", havingValue = "true")
public class NativeCredentials {
    private static final SecureRandom RANDOM = new SecureRandom();
    private final JdbcTemplate db;
    private final Sessions sessions;
    private final Argon2PasswordEncoder passwords = new Argon2PasswordEncoder(16, 32, 1, 19 * 1024, 2);
    private final String dummy = passwords.encode(token());
    private final Semaphore passwordSlots = new Semaphore(4);

    NativeCredentials(JdbcTemplate db, Sessions sessions) {
        this.db = db;
        this.sessions = sessions;
    }

    public void limit(String bucket, int maximum) {
        int attempts = db.queryForObject("""
                INSERT INTO native_auth_limits (bucket, window_start, attempts)
                VALUES (?, date_bin(interval '15 minutes', now(), timestamptz '2000-01-01'), 1)
                ON CONFLICT (bucket, window_start) DO UPDATE SET attempts = native_auth_limits.attempts + 1
                RETURNING attempts
                """, Integer.class, bucket);
        if (attempts > maximum) {
            throw IdentityService.failure(HttpStatus.TOO_MANY_REQUESTS, "auth_throttled", "Try again in a few minutes.");
        }
    }

    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 3600000)
    void clearExpiredLimits() {
        db.update("DELETE FROM native_auth_limits WHERE window_start < now() - interval '1 hour'");
        db.update("DELETE FROM native_setup_links WHERE expires_at <= now()");
    }

    @Transactional
    public com.boqlet.contract.model.Session signIn(String email, String password, String cookie, String device, boolean takeover) {
        var credentials = db.query("""
                SELECT users.id, password_hash FROM native_credentials JOIN users ON users.id = user_id
                WHERE lower(email) = ? AND deleted_at IS NULL FOR NO KEY UPDATE OF users
                """, (row, index) -> new Credential(row.getObject("id", UUID.class), row.getString("password_hash")), email)
                .stream().findFirst().orElse(null);
        if (password == null || password.length() > 256) throw invalidLogin();
        acquirePasswordSlot();
        try {
            boolean valid = passwords.matches(password, credentials == null ? dummy : credentials.hash());
            if (!valid || credentials == null) throw invalidLogin();
            return sessions.open(new Login(credentials.user(), secret(cookie), null), device, takeover);
        } finally {
            passwordSlots.release();
        }
    }

    @Transactional
    public void setPassword(String rawToken, String password, String name) {
        if (rawToken == null || !rawToken.matches("[A-Za-z0-9_-]{43}") || password == null
                || password.length() > 256 || password.codePointCount(0, password.length()) < 15
                || password.codePointCount(0, password.length()) > 128 || password.isBlank()
                || (name != null && name.length() > 120)) {
            throw IdentityService.failure(HttpStatus.BAD_REQUEST, "invalid_setup", "Use a valid link and a password of 15 to 128 characters.");
        }
        var digest = hash(rawToken);
        var operator = db.query("""
                DELETE FROM native_setup_links WHERE token_hash = ? AND expires_at > now()
                RETURNING email, purpose
                """, (row, index) -> new Setup(row.getString("email"), row.getString("purpose").equals("reset")), digest)
                .stream().findFirst().orElse(null);
        String email = operator == null ? db.query("""
                SELECT lower(i.email) FROM org_invitations i JOIN orgs o ON o.id = i.org_id
                WHERE i.token_hash = ? AND i.status = 'pending' AND i.expires_at > now() AND o.status = 'active'
                FOR SHARE OF i, o
                """, (row, index) -> row.getString(1), digest).stream().findFirst().orElseThrow(NativeCredentials::invalidLink)
                : operator.email();
        acquirePasswordSlot();
        String encoded;
        try {
            encoded = passwords.encode(password);
        } finally {
            passwordSlots.release();
        }
        if (operator != null && operator.reset()) {
            UUID user = db.query("""
                    SELECT u.id FROM users u JOIN native_credentials c ON c.user_id = u.id
                    WHERE lower(u.email) = ? AND u.deleted_at IS NULL FOR NO KEY UPDATE OF u
                    """, (row, index) -> row.getObject(1, UUID.class), email)
                    .stream().findFirst().orElseThrow(NativeCredentials::invalidLink);
            db.update("UPDATE native_credentials SET password_hash = ? WHERE user_id = ?", encoded, user);
            db.update("UPDATE sessions SET status = 'ended', ended_at = now() WHERE user_id = ? AND status = 'active'", user);
            return;
        }
        UUID user = Ids.newId();
        int created = db.update("INSERT INTO users (id, auth_subject, email, name) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
                user, "native:" + user, email, name == null || name.isBlank() ? email : name.strip());
        if (created != 1) throw invalidLink();
        db.update("INSERT INTO native_credentials (user_id, password_hash) VALUES (?, ?)", user, encoded);
    }

    Login session(String cookie) {
        if (cookie == null || !cookie.matches("[A-Za-z0-9_-]{43}")) throw invalidLogin();
        String secret = secret(cookie);
        record Owner(UUID id, UUID user) {}
        var owner = db.query("""
                SELECT s.id, s.user_id FROM sessions s JOIN users u ON s.user_id = u.id
                WHERE s.provider_session = ? AND s.provider_session LIKE 'native:%' AND u.deleted_at IS NULL
                """, (row, index) -> new Owner(row.getObject(1, UUID.class), row.getObject(2, UUID.class)), secret)
                .stream().findFirst().orElseThrow(NativeCredentials::invalidLogin);
        var login = new Login(owner.user(), secret, null);
        return new Login(owner.user(), secret, sessions.require(login, owner.id()));
    }

    private void acquirePasswordSlot() {
        if (!passwordSlots.tryAcquire()) {
            throw IdentityService.failure(HttpStatus.TOO_MANY_REQUESTS, "auth_throttled", "Try again in a moment.");
        }
    }

    static String token() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String secret(String token) { return "native:" + hash(token); }

    static String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private static RuntimeException invalidLink() {
        return IdentityService.failure(HttpStatus.BAD_REQUEST, "invalid_setup", "The link is unavailable. Sign in or ask for a new link.");
    }

    private static RuntimeException invalidLogin() {
        return IdentityService.failure(HttpStatus.UNAUTHORIZED, "unauthenticated", "Sign in with your Boqlet account.");
    }

    private record Credential(UUID user, String hash) {}
    private record Setup(String email, boolean reset) {}
}
