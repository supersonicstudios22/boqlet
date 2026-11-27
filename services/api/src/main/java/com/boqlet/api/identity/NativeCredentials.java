package com.boqlet.api.identity;

import com.boqlet.api.db.Ids;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
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
    private final LinkTokens links;
    private final Argon2PasswordEncoder passwords = new Argon2PasswordEncoder(16, 32, 1, 19 * 1024, 2);
    private final String dummy = passwords.encode(token());
    private final Semaphore passwordSlots = new Semaphore(4);

    NativeCredentials(JdbcTemplate db, Sessions sessions, LinkTokens links) {
        this.db = db;
        this.sessions = sessions;
        this.links = links;
    }

    /**
     * Sign-in limits (security.md, Q56/P54, TF-122): failed sign-ins and password setups count, 45 per
     * address and 12 per email in 15 minutes; successes count separately against a generous cap, so an
     * office behind one address isn't locked out by its own sign-ins.
     */
    public static final int FAILURES_PER_SOURCE = 45;
    public static final int FAILURES_PER_EMAIL = 12;
    public static final int SUCCESSES_PER_SOURCE = 600;
    /** Public sign-up and reset requests (P57): every request counts, per address and per email, in 15 minutes. */
    public static final int LINK_REQUESTS_PER_SOURCE = 20;
    public static final int LINK_REQUESTS_PER_EMAIL = 3;

    /**
     * `429 auth_throttled` when this window's count for the bucket has reached the maximum, with `Retry-After`
     * until the 15-minute window ends (review B-21).
     */
    public void requireUnder(String bucket, int maximum) {
        record Window(int attempts, long retry) {}
        var window = db.query("""
                SELECT attempts, ceil(extract(epoch FROM window_start + interval '15 minutes' - now()))::bigint AS retry
                FROM native_auth_limits
                WHERE bucket = ? AND window_start = date_bin(interval '15 minutes', now(), timestamptz '2000-01-01')
                """, (row, index) -> new Window(row.getInt(1), row.getLong(2)), bucket).stream().findFirst().orElse(null);
        if (window != null && window.attempts() >= maximum) {
            throw com.boqlet.api.http.RateLimits.tooMany("auth_throttled", "Try again in a few minutes.", window.retry());
        }
    }

    /** Counts one attempt in this window's bucket. */
    public void count(String bucket) {
        db.update("""
                INSERT INTO native_auth_limits (bucket, window_start, attempts)
                VALUES (?, date_bin(interval '15 minutes', now(), timestamptz '2000-01-01'), 1)
                ON CONFLICT (bucket, window_start) DO UPDATE SET attempts = native_auth_limits.attempts + 1
                """, bucket);
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
                RETURNING email, purpose, nonce IS NOT NULL AS emailed
                """, (row, index) -> new Setup(row.getString("email"), row.getString("purpose").equals("reset"),
                        row.getBoolean("emailed")), digest)
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
            int ended = db.update("UPDATE sessions SET status = 'ended', ended_at = now() WHERE user_id = ? AND status = 'active'", user);
            sessions.record(user, null, "user.password_reset", user, JsonNodeFactory.instance.objectNode().put("sessionsEnded", ended));
            return;
        }
        UUID user = Ids.newId();
        int created = db.update("INSERT INTO users (id, auth_subject, email, name) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
                user, "native:" + user, email, name == null || name.isBlank() ? email : name.strip());
        if (created != 1) throw invalidLink();
        db.update("INSERT INTO native_credentials (user_id, password_hash) VALUES (?, ?)", user, encoded);
        sessions.record(user, null, "user.password_set", user, JsonNodeFactory.instance.objectNode()
                .put("via", operator == null ? "invitation" : operator.emailed() ? "sign_up" : "setup_link"));
    }

    /**
     * Public sign-up (P57): an address without an account gets a one-hour link to set its password
     * (which proves the address; the account is made then); an address with an account gets an
     * email saying so. A deleted account's address gets nothing. The caller answers the same either way.
     */
    @Transactional
    public void requestSignUp(String email, String locale) {
        record Existing(boolean deleted) {}
        var existing = db.query("SELECT deleted_at IS NOT NULL FROM users WHERE lower(email) = ? ORDER BY deleted_at NULLS FIRST LIMIT 1",
                (row, index) -> new Existing(row.getBoolean(1)), email).stream().findFirst();
        if (existing.isPresent()) {
            if (!existing.get().deleted()) enqueue("account_exists", Ids.newId(), email, locale);
            return;
        }
        issueLink(email, "setup", locale);
    }

    /** Self-service reset (P57): an account with a password gets a one-hour reset link; other addresses get nothing. */
    @Transactional
    public void requestReset(String email) {
        record Account(UUID id, String locale) {}
        var account = db.query("""
                SELECT u.id, u.locale FROM native_credentials c JOIN users u ON u.id = c.user_id
                WHERE lower(u.email) = ? AND u.deleted_at IS NULL
                """, (row, index) -> new Account(row.getObject(1, UUID.class), row.getString(2)), email).stream().findFirst();
        if (account.isEmpty()) return;
        issueLink(email, "reset", account.get().locale());
        sessions.record(null, null, "user.password_reset_requested", account.get().id(), JsonNodeFactory.instance.objectNode());
    }

    /** One link per address: a new one replaces the last (whose email then no longer works). */
    private void issueLink(String email, String purpose, String locale) {
        UUID nonce = UUID.randomUUID();
        db.update("""
                INSERT INTO native_setup_links (email, token_hash, expires_at, purpose, nonce)
                VALUES (?, ?, now() + interval '1 hour', ?, ?)
                ON CONFLICT (email) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at,
                    purpose = excluded.purpose, nonce = excluded.nonce
                """, email, hash(links.token(nonce)), purpose, nonce);
        enqueue("account_link", nonce, email, locale);
    }

    private void enqueue(String kind, UUID entity, String email, String locale) {
        db.update("""
                INSERT INTO email_outbox (id, org_id, kind, entity_id, recipient, payload)
                VALUES (?, NULL, ?, ?, ?, CAST(? AS jsonb))
                """, Ids.newId(), kind, entity, email,
                JsonNodeFactory.instance.objectNode().put("locale", locale == null ? "" : locale).toString());
    }

    /**
     * A refused sign-in (TF-044), in its own transaction: the sign-in's rolled back with the refusal.
     * The account, when the address has one, is the entity; nobody is the actor. An unknown address is
     * not written down (it may be anyone's).
     */
    @Transactional
    public void signInFailed(String email) {
        UUID user = db.query("""
                SELECT users.id FROM native_credentials JOIN users ON users.id = user_id
                WHERE lower(email) = ? AND deleted_at IS NULL
                """, (row, index) -> row.getObject(1, UUID.class), email).stream().findFirst().orElse(null);
        sessions.record(null, null, "auth.sign_in_failed", user, JsonNodeFactory.instance.objectNode()
                .put("reason", user == null ? "unknown_account" : "wrong_password"));
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
            // Every password check slot is busy: a second is enough to try again (review B-21).
            throw com.boqlet.api.http.RateLimits.tooMany("auth_throttled", "Try again in a moment.", 1);
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
    private record Setup(String email, boolean reset, boolean emailed) {}
}
