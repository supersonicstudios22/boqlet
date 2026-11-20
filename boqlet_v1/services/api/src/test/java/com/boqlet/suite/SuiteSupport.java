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

    /** The email a sign-up token carries, or null for any other token. */
    public static String emailOf(String token) {
        if (!token.startsWith(TOKEN_PREFIX) || token.length() == TOKEN_PREFIX.length()) return null;
        try {
            return new String(java.util.Base64.getUrlDecoder().decode(token.substring(TOKEN_PREFIX.length())),
                    java.nio.charset.StandardCharsets.UTF_8);
        } catch (IllegalArgumentException invalid) {
            return null;
        }
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
