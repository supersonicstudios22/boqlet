package com.boqlet.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest(properties = {"BOQLET_NATIVE_AUTH=true", "BOQLET_APP_URL=https://booqlet.test",
        "boqlet.auth.invitation-secret=native-auth-test-signing-secret-2026"})
@AutoConfigureMockMvc
@Testcontainers
@DirtiesContext
class NativeAuthTest {
    private static final String ORIGIN = "https://booqlet.test";
    private static final String EMAIL = "native-pilot@example.test";
    private static final String PASSWORD = "a long native test password";
    private static final String SETUP = "s".repeat(43);
    private static final String RESET = "r".repeat(43);

    @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired JdbcTemplate db;
    @Autowired MockMvc http;
    @Autowired ObjectMapper json;
    @Autowired com.boqlet.api.identity.LinkTokens links;

    /**
     * P57: public sign-up and self-service reset. Closed, sign-up is refused; open, a person asks for
     * a link, the email carries it (the outbox holds only its nonce), setting the password makes the
     * account, and its first org starts on Free, which allows one owned org. A filled honeypot or a
     * form sent too fast sends nothing; an address with an account is told so; a reset link sets a new
     * password; the answer never says whether an address has an account; requests are throttled.
     */
    @Test
    void publicSignUpBotProtectionOwnedOrgCapAndSelfServiceReset() throws Exception {
        String email = "signup-person@example.test";
        http.perform(get("/api/v1/auth/sign-up")).andExpect(status().isOk()).andExpect(jsonPath("$.open").value(false));
        http.perform(signUp(email, null, 5000)).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("sign_up_closed"));

        db.update("UPDATE platform_settings SET public_sign_up = true");
        http.perform(get("/api/v1/auth/sign-up")).andExpect(status().isOk()).andExpect(jsonPath("$.open").value(true));
        http.perform(signUp(email, null, 5000, "https://other.test")).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("invalid_origin"));
        http.perform(signUp("not an email", null, 5000)).andExpect(status().isBadRequest());
        // Bots: a filled hidden field, or a form sent within 3 seconds. Accepted, and nothing is sent.
        http.perform(signUp(email, "https://spam.test", 5000)).andExpect(status().isAccepted());
        assertThat(outbox(email)).isEmpty();
        db.update("DELETE FROM native_auth_limits");
        http.perform(signUp(email, null, 800)).andExpect(status().isAccepted());
        assertThat(outbox(email)).isEmpty();

        http.perform(signUp(email.toUpperCase(java.util.Locale.ROOT), null, 5000)).andExpect(status().isAccepted());
        var mails = outbox(email);
        assertThat(mails).singleElement().satisfies(mail -> assertThat(mail.get("kind")).isEqualTo("account_link"));
        assertThat(db.queryForObject("SELECT purpose FROM native_setup_links WHERE email = ?", String.class, email)).isEqualTo("setup");
        String token = links.token((java.util.UUID) mails.getFirst().get("entity_id"));
        http.perform(post("/api/v1/auth/set-password").header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("token", token, "password", PASSWORD, "name", "Signed Up"))))
                .andExpect(status().isNoContent());
        assertThat(db.queryForObject("""
                SELECT a.data->>'via' FROM audit_events a JOIN users u ON u.id = a.entity_id
                WHERE a.action = 'user.password_set' AND u.email = ?
                """, String.class, email)).isEqualTo("sign_up");
        Cookie session = http.perform(post("/api/v1/auth/sign-in").header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", email, "password", PASSWORD, "deviceLabel", "Test"))))
                .andExpect(status().isCreated()).andReturn().getResponse().getCookie("boqlet_session");

        // Free allows one owned org per person (P57): the second is 402 ownedOrgsPerUser.
        http.perform(post("/api/v1/orgs").cookie(session).header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Signed Up Firm\",\"slug\":\"signed-up-firm\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.planId").value("free"));
        http.perform(post("/api/v1/orgs").cookie(session).header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Second Firm\",\"slug\":\"second-firm\"}"))
                .andExpect(status().isPaymentRequired()).andExpect(jsonPath("$.details.limit").value("ownedOrgsPerUser"))
                .andExpect(jsonPath("$.details.current").value(1)).andExpect(jsonPath("$.details.max").value(1));
        // A taken address is still 409, whatever the limit.
        http.perform(post("/api/v1/orgs").cookie(session).header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Copy\",\"slug\":\"signed-up-firm\"}")).andExpect(status().isConflict());

        // Signing up again with the address: told it has an account, no link.
        db.update("DELETE FROM native_auth_limits");
        http.perform(signUp(email, null, 5000)).andExpect(status().isAccepted());
        assertThat(outbox(email)).extracting(mail -> mail.get("kind")).containsExactly("account_link", "account_exists");
        assertThat(db.queryForObject("SELECT count(*) FROM native_setup_links WHERE email = ?", Long.class, email)).isZero();

        // Self-service reset: an unknown address gets nothing, the account a reset link.
        http.perform(reset("nobody-here@example.test")).andExpect(status().isAccepted());
        assertThat(outbox("nobody-here@example.test")).isEmpty();
        http.perform(reset(email)).andExpect(status().isAccepted());
        var resetMail = outbox(email).getLast();
        assertThat(resetMail.get("kind")).isEqualTo("account_link");
        assertThat(db.queryForObject("SELECT purpose FROM native_setup_links WHERE email = ?", String.class, email)).isEqualTo("reset");
        String newPassword = "a new self service password";
        http.perform(post("/api/v1/auth/set-password").header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("token", links.token((java.util.UUID) resetMail.get("entity_id")), "password", newPassword))))
                .andExpect(status().isNoContent());
        http.perform(get("/api/v1/me").cookie(session)).andExpect(status().isUnauthorized());
        http.perform(post("/api/v1/auth/sign-in").header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", email, "password", newPassword, "deviceLabel", "Test"))))
                .andExpect(status().isCreated());

        // Three requests per address in 15 minutes, then 429 (the answer is the same for every address).
        db.update("DELETE FROM native_auth_limits");
        for (int i = 0; i < 3; i++) http.perform(reset("throttled@example.test")).andExpect(status().isAccepted());
        // Review B-21: a throttled request says when to try again, as every 429 does.
        var throttled = http.perform(reset("throttled@example.test")).andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("auth_throttled"))
                .andExpect(jsonPath("$.details.retryAfterSeconds").isNumber()).andReturn().getResponse();
        long retryAfter = Long.parseLong(throttled.getHeader("Retry-After"));
        assertThat(retryAfter).isBetween(1L, 900L);
        db.update("UPDATE platform_settings SET public_sign_up = false");
    }

    private List<Map<String, Object>> outbox(String email) {
        return db.queryForList("SELECT kind, entity_id, org_id FROM email_outbox WHERE recipient = ? ORDER BY created_at, id", email);
    }

    private MockHttpServletRequestBuilder signUp(String email, String website, long elapsedMs) throws Exception {
        return signUp(email, website, elapsedMs, ORIGIN);
    }

    private MockHttpServletRequestBuilder signUp(String email, String website, long elapsedMs, String origin) throws Exception {
        var body = new java.util.LinkedHashMap<String, Object>();
        body.put("email", email);
        body.put("elapsedMs", elapsedMs);
        if (website != null) body.put("website", website);
        return post("/api/v1/auth/sign-up").header("Origin", origin).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
    }

    private MockHttpServletRequestBuilder reset(String email) throws Exception {
        return post("/api/v1/auth/password-reset").header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", email)));
    }

    @Test
    void verifiedSetupCookieOriginTakeoverAndOperatorRecovery() throws Exception {
        http.perform(setup(SETUP, PASSWORD)).andExpect(status().isBadRequest());
        issue(SETUP, "setup");
        http.perform(setup(SETUP, PASSWORD)).andExpect(status().isNoContent());
        http.perform(setup(SETUP, PASSWORD)).andExpect(status().isBadRequest());
        assertThat(db.queryForObject("SELECT password_hash FROM native_credentials c JOIN users u ON u.id = c.user_id WHERE u.email = ?",
                String.class, EMAIL)).startsWith("$argon2id$");

        http.perform(signIn(PASSWORD, false).header("Origin", "https://other.test"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("invalid_origin"));
        http.perform(signIn("incorrect password", false).header("Origin", ORIGIN)).andExpect(status().isUnauthorized());
        var first = http.perform(signIn(PASSWORD, false).header("Origin", ORIGIN)).andExpect(status().isCreated())
                .andReturn().getResponse().getCookie("boqlet_session");
        assertThat(first).isNotNull();
        assertThat(first.getValue()).hasSize(43);
        assertThat(first.isHttpOnly() && first.getSecure()).isTrue();
        http.perform(get("/api/v1/me").cookie(first)).andExpect(status().isOk()).andExpect(jsonPath("$.user.email").value(EMAIL));
        http.perform(post("/api/v1/sessions").cookie(first).header("Origin", ORIGIN)
                .contentType(MediaType.APPLICATION_JSON).content("{\"deviceLabel\":\"Test\"}"))
                .andExpect(status().isCreated()).andExpect(header().doesNotExist("Set-Cookie"));
        http.perform(delete("/api/v1/sessions/current").cookie(first)).andExpect(status().isForbidden());
        http.perform(signIn(PASSWORD, false).header("Origin", ORIGIN))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("session_active"));
        Cookie second = http.perform(signIn(PASSWORD, true).header("Origin", ORIGIN)).andExpect(status().isCreated())
                .andReturn().getResponse().getCookie("boqlet_session");
        http.perform(get("/api/v1/me").cookie(first)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("session_replaced"));

        String newPassword = "a different long native password";
        issue(RESET, "reset");
        http.perform(setup(RESET, newPassword)).andExpect(status().isNoContent());
        http.perform(get("/api/v1/me").cookie(second)).andExpect(status().isUnauthorized());
        http.perform(signIn(PASSWORD, false).header("Origin", ORIGIN)).andExpect(status().isUnauthorized());
        Cookie third = http.perform(signIn(newPassword, false).header("Origin", ORIGIN)).andExpect(status().isCreated())
                .andReturn().getResponse().getCookie("boqlet_session");

        // TF-011: Spring routes on the decoded path, so the platform-admin gate must hold for every spelling of /admin/.
        for (String admin : List.of("/api/v1/admin/orgs", "/api/v1/%61dmin/orgs", "/api/v1/adm%69n/overview", "/api/v1/%61dmin/users")) {
            http.perform(get(URI.create(admin)).cookie(third)).andExpect(status().isNotFound());
        }
        // P54 Q51 (TF-081): not signed in, or with an ended session, /admin/* asks to sign in like every other route.
        http.perform(get("/api/v1/admin/orgs")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("unauthenticated"));
        http.perform(get(URI.create("/api/v1/%61dmin/overview")).cookie(second)).andExpect(status().isUnauthorized());
        String self = db.queryForObject("SELECT id::text FROM users WHERE email = ?", String.class, EMAIL);
        http.perform(delete(URI.create("/api/v1/%61dmin/users/" + self + "/session")).header("Origin", ORIGIN).cookie(third))
                .andExpect(status().isNotFound());
        http.perform(get("/api/v1/me").cookie(third)).andExpect(status().isOk());
        db.update("UPDATE users SET platform_role = 'admin' WHERE email = ?", EMAIL);
        http.perform(get("/api/v1/admin/orgs").cookie(third)).andExpect(status().isOk());
        http.perform(get(URI.create("/api/v1/%61dmin/orgs")).cookie(third)).andExpect(status().isOk());
        db.update("UPDATE users SET platform_role = NULL WHERE email = ?", EMAIL);

        http.perform(delete("/api/v1/sessions/current").header("Origin", ORIGIN).cookie(third)).andExpect(status().isNoContent());
        http.perform(get("/api/v1/me").cookie(third)).andExpect(status().isUnauthorized());
    }

    /**
     * Review C-28: the set-password form learns which address a link is for (without using it up), and
     * setting the password with `signIn` signs the account in at once: 201, the session cookie, `/me`
     * answers. A reset that signs in ends the other session first (P22: one session, no takeover question).
     * Without `signIn` the answer stays 204 for the scripts that sign in themselves.
     */
    @Test
    void settingAPasswordSignsInAndTheLinkNamesItsAddress() throws Exception {
        String email = "signs-in-at-once@example.test";
        String setupToken = "c".repeat(43);
        String resetToken = "d".repeat(43);
        http.perform(link("e".repeat(43))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("invalid_setup"));
        http.perform(link("not a token")).andExpect(status().isBadRequest());
        issue(email, setupToken, "setup");
        http.perform(link(setupToken)).andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email)).andExpect(jsonPath("$.purpose").value("setup"));
        // Looking the link up doesn't use it.
        http.perform(link(setupToken)).andExpect(status().isOk());

        Cookie first = http.perform(setupSigningIn(setupToken, PASSWORD, "Signs In")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.deviceLabel").value("Test browser")).andExpect(jsonPath("$.status").value("active"))
                .andReturn().getResponse().getCookie("boqlet_session");
        assertThat(first).isNotNull();
        assertThat(first.isHttpOnly() && first.getSecure()).isTrue();
        http.perform(get("/api/v1/me").cookie(first)).andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email").value(email)).andExpect(jsonPath("$.user.name").value("Signs In"));
        http.perform(link(setupToken)).andExpect(status().isBadRequest());

        issue(email, resetToken, "reset");
        http.perform(link(resetToken)).andExpect(status().isOk()).andExpect(jsonPath("$.purpose").value("reset"));
        Cookie second = http.perform(setupSigningIn(resetToken, "a new password after the reset", null))
                .andExpect(status().isCreated()).andReturn().getResponse().getCookie("boqlet_session");
        http.perform(get("/api/v1/me").cookie(first)).andExpect(status().isUnauthorized());
        http.perform(get("/api/v1/me").cookie(second)).andExpect(status().isOk()).andExpect(jsonPath("$.user.name").value("Signs In"));
        assertThat(db.queryForObject("""
                SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ? AND s.status = 'active'
                """, Long.class, email)).isEqualTo(1);
        // A too-short password is refused before anything is set, and no cookie is sent.
        issue(email, setupToken, "reset");
        http.perform(setupSigningIn(setupToken, "too short", null)).andExpect(status().isBadRequest())
                .andExpect(header().doesNotExist("Set-Cookie"));
    }

    private void issue(String token, String purpose) throws Exception {
        issue(EMAIL, token, purpose);
    }

    private void issue(String email, String token, String purpose) throws Exception {
        var hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        db.update("""
                INSERT INTO native_setup_links VALUES (?, ?, now() + interval '1 hour', ?)
                ON CONFLICT (email) DO UPDATE SET token_hash = excluded.token_hash, purpose = excluded.purpose
                """, email, hash, purpose);
    }

    private MockHttpServletRequestBuilder link(String token) throws Exception {
        return post("/api/v1/auth/setup-link").header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("token", token)));
    }

    private MockHttpServletRequestBuilder setupSigningIn(String token, String password, String name) throws Exception {
        var body = new java.util.LinkedHashMap<String, Object>(Map.of("token", token, "password", password,
                "signIn", true, "deviceLabel", "Test browser"));
        if (name != null) body.put("name", name);
        return post("/api/v1/auth/set-password").header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(body));
    }

    private MockHttpServletRequestBuilder setup(String token, String password) throws Exception {
        return post("/api/v1/auth/set-password").header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("token", token, "password", password, "name", "Native Pilot")));
    }

    private MockHttpServletRequestBuilder signIn(String password, boolean takeover) throws Exception {
        return post("/api/v1/auth/sign-in").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", EMAIL, "password", password, "deviceLabel", "Test", "takeover", takeover)));
    }
}
