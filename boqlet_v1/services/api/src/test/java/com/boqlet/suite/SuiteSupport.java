package com.boqlet.suite;

import com.boqlet.api.db.Ids;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The test-only endpoints the shared suites (`tests/`) need from Java, the counterpart of the
 * mock's `/_dev` and `/_test` routes. Test sources only, outside the application's scanned
 * package: a test registers it with {@code @Import(SuiteSupport.class)}; no build contains it.
 */
@TestConfiguration(proxyBeanMethods = false)
public class SuiteSupport {
    public static final String TOKEN_PREFIX = "suite.signup.";

    /**
     * The test clock (testing.md, the mock's `/_test/clock`). Java reads the time from PostgreSQL's
     * `now()`, so the clock lives there: {@link #installClock} adds a schema `suite_clock` whose
     * `now()` is the real time plus an offset, and the test's connections search it before
     * `pg_catalog` ({@link #SEARCH_PATH}, as `connection-init-sql`). Objects are still created in
     * `public`. Only a test installs it; no build or deployment has the schema.
     */
    public static final String SEARCH_PATH = "public, suite_clock, pg_catalog";

    public static void installClock(String jdbcUrl, String user, String password) throws java.sql.SQLException {
        try (var connection = java.sql.DriverManager.getConnection(jdbcUrl, user, password);
             var statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA IF NOT EXISTS suite_clock");
            statement.execute("CREATE TABLE IF NOT EXISTS suite_clock.offset_ms (ms bigint NOT NULL)");
            statement.execute("INSERT INTO suite_clock.offset_ms SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM suite_clock.offset_ms)");
            statement.execute("""
                    CREATE OR REPLACE FUNCTION suite_clock.now() RETURNS timestamptz LANGUAGE sql STABLE AS
                    $$ SELECT pg_catalog.now() + (SELECT ms FROM suite_clock.offset_ms) * interval '1 millisecond' $$
                    """);
        }
    }

    /**
     * The email a sign-up token carries, or null for any other token. A sign-up token is
     * `suite.signup.<base64url email>`; `suite.signup.<base64url email>.<browser>` is the same
     * person in another browser (tests/support/java-sessions.ts).
     */
    public static String emailOf(String token) {
        String person = personOf(token);
        if (person == null) return null;
        try {
            return new String(java.util.Base64.getUrlDecoder().decode(person.substring(TOKEN_PREFIX.length())),
                    java.nio.charset.StandardCharsets.UTF_8);
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    /** The person's own token (the account's subject) without the browser, or null. */
    public static String personOf(String token) {
        if (!token.startsWith(TOKEN_PREFIX) || token.length() == TOKEN_PREFIX.length()) return null;
        int browser = token.indexOf('.', TOKEN_PREFIX.length());
        return browser < 0 ? token : token.substring(0, browser);
    }

    /** `/_test/**` is open to the suite; the product's chain denies every path it doesn't know. */
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    SecurityFilterChain suiteEndpoints(HttpSecurity http) throws Exception {
        return http.securityMatcher("/_test/**").csrf(AbstractHttpConfigurer::disable)
                .authorizeHttpRequests(requests -> requests.anyRequest().permitAll()).build();
    }

    // Registered as a member class of this configuration when a test imports it.
    @RestController
    @RequestMapping("/_test")
    static class SuiteController {
        private final JdbcTemplate database;

        SuiteController(JdbcTemplate database) {
            this.database = database;
        }

        /**
         * Waits until the email outbox has sent everything due (up to 15 s), so MailHog holds every
         * mail the backend has written: the mock writes mail at once, Java's sender polls its outbox.
         */
        @PostMapping("/mail/settle")
        Map<String, Object> settleMail() throws InterruptedException {
            long until = System.nanoTime() + java.time.Duration.ofSeconds(15).toNanos();
            long pending;
            do {
                pending = database.queryForObject("""
                        SELECT count(*) FROM email_outbox
                        WHERE sent_at IS NULL AND canceled_at IS NULL AND next_attempt_at <= now()
                        """, Long.class);
                if (pending == 0) break;
                Thread.sleep(100);
            } while (System.nanoTime() < until);
            return Map.of("pending", pending);
        }

        /**
         * A native setup or reset link (P50), exactly as `ops/pilot/issue-setup-link.sh` issues one:
         * `{email, purpose}` (`setup` for an address without an account, `reset` for one with a
         * password), valid for an hour. Answers the raw token for `/sign-up?token=`; 409 when the
         * address is ineligible for that purpose.
         */
        @PostMapping("/setup-link")
        org.springframework.http.ResponseEntity<Map<String, String>> setupLink(@RequestBody Map<String, String> body) {
            String email = body.getOrDefault("email", "").trim().toLowerCase(java.util.Locale.ROOT);
            String purpose = body.getOrDefault("purpose", "setup");
            if (!email.matches("[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}") || email.length() > 254
                    || !(purpose.equals("setup") || purpose.equals("reset"))) {
                // Answered here: an exception would go to `/error`, which the product's chain denies.
                return org.springframework.http.ResponseEntity.badRequest().body(Map.of("code", "invalid_body", "message", "An email and setup or reset."));
            }
            byte[] random = new byte[32];
            new java.security.SecureRandom().nextBytes(random);
            String token = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(random);
            String digest;
            try {
                digest = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                        .digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            } catch (java.security.NoSuchAlgorithmException impossible) {
                throw new IllegalStateException(impossible);
            }
            var issued = database.queryForList("""
                    INSERT INTO native_setup_links (email, token_hash, expires_at, purpose)
                    SELECT ?, ?, now() + interval '1 hour', ?
                    WHERE (? = 'setup' AND NOT EXISTS (SELECT FROM users WHERE lower(email) = ?))
                       OR (? = 'reset' AND EXISTS (
                             SELECT FROM native_credentials c JOIN users u ON u.id = c.user_id
                             WHERE lower(u.email) = ? AND u.deleted_at IS NULL))
                    ON CONFLICT (email) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at, purpose = excluded.purpose
                    RETURNING 1
                    """, Integer.class, email, digest, purpose, purpose, email, purpose, email);
            if (issued.isEmpty()) {
                return org.springframework.http.ResponseEntity.status(HttpStatus.CONFLICT)
                        .body(Map.of("code", "ineligible", "message", "This address is ineligible for the requested link."));
            }
            return org.springframework.http.ResponseEntity.status(HttpStatus.CREATED).body(Map.of("token", token, "email", email, "purpose", purpose));
        }

        /**
         * Forgets native sign-in attempts (`native_auth_limits`): a browser suite signs in many
         * people from one address, far more than a person would in 15 minutes.
         */
        @PostMapping("/auth-limits/reset")
        Map<String, Object> resetAuthLimits() {
            return Map.of("cleared", database.update("DELETE FROM native_auth_limits"));
        }

        @GetMapping("/clock")
        Map<String, Object> clock() {
            return database.queryForObject("SELECT now(), (SELECT ms FROM suite_clock.offset_ms)", (row, index) ->
                    Map.of("now", row.getObject(1, java.time.OffsetDateTime.class).toInstant().toString(), "offsetMs", row.getLong(2)));
        }

        /** `{advanceMs}`, `{advanceDays}`, `{set: iso}` or `{reset: true}`, as on the mock. */
        @PostMapping("/clock")
        Map<String, Object> moveClock(@RequestBody(required = false) Map<String, Object> body) {
            Map<String, Object> move = body == null ? Map.of() : body;
            if (Boolean.TRUE.equals(move.get("reset"))) {
                database.update("UPDATE suite_clock.offset_ms SET ms = 0");
            } else if (move.get("set") instanceof String at) {
                database.update("UPDATE suite_clock.offset_ms SET ms = (extract(epoch FROM (?::timestamptz - pg_catalog.now())) * 1000)::bigint", at);
            } else {
                long ms = move.get("advanceMs") instanceof Number n ? n.longValue() : 0;
                ms += move.get("advanceDays") instanceof Number d ? Math.round(d.doubleValue() * 86_400_000) : 0;
                database.update("UPDATE suite_clock.offset_ms SET ms = ms + ?", ms);
            }
            return clock();
        }

        /**
         * A new person, as if they signed up (F01; the mock's `POST /_dev/users`). The account is
         * created directly, so the pilot's invite-only admission doesn't apply. Its test token is
         * {@link #TOKEN_PREFIX} plus the base64url email (bearer tokens allow no `:` or `@`), and
         * {@link #emailOf} reads it back for the test token decoder.
         */
        @PostMapping("/users")
        @ResponseStatus(HttpStatus.CREATED)
        Map<String, String> signUp(@RequestBody Map<String, String> body) {
            String email = body.getOrDefault("email", "").trim().toLowerCase(java.util.Locale.ROOT);
            String name = body.getOrDefault("name", "").trim();
            if (email.isEmpty() || name.isEmpty()) {
                throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST, "name and email are required");
            }
            UUID id = Ids.newId();
            String token = TOKEN_PREFIX + java.util.Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(email.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            database.update("INSERT INTO users (id, auth_subject, email, name) VALUES (?, ?, ?, ?)", id, token, email, name);
            return Map.of("id", id.toString(), "name", name, "email", email, "token", token);
        }
    }
}
