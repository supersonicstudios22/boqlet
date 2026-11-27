package com.boqlet.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Stage 6 B2 (identity, http, org): HEAD on public routes (TF-083), no tokens in the access log
 * (TF-042), request ids in text logs (TF-185), account audit events (TF-044, TF-114), last active
 * (TF-118), org.updated data (TF-119), locale (TF-121), names (TF-176), invitation mail limit (TF-043)
 * and the share limit per token (TF-087).
 */
@SpringBootTest(properties = {"BOQLET_NATIVE_AUTH=true", "BOQLET_APP_URL=https://booqlet.test",
        "boqlet.auth.invitation-secret=local-test-signing-secret-2026-only", "BOQLET_PUBLIC_SHARE_REQUESTS_PER_MINUTE=3"})
@AutoConfigureMockMvc
@Testcontainers
@DirtiesContext
@ExtendWith(OutputCaptureExtension.class)
class AccountSecurityTest {
    private static final String ORIGIN = "https://booqlet.test";
    private static final String PASSWORD = "a long account security password";
    private static final SecureRandom RANDOM = new SecureRandom();

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
    @Autowired com.boqlet.api.org.Invitations invitations;

    @BeforeEach
    void forgetSignInAttempts() {
        db.update("DELETE FROM native_auth_limits");
    }

    @Test
    void tf083HeadIsAGetOnThePublicRoutes() throws Exception {
        http.perform(head("/api/v1/plans")).andExpect(status().isOk());
        http.perform(head("/api/v1/invitations/" + token())).andExpect(status().isNotFound());
        http.perform(head("/api/v1/public/shares/" + token())).andExpect(status().isNotFound());
        http.perform(head("/api/v1/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void tf042AndTf185TheAccessLogHasTheRequestIdAndNoTokens(CapturedOutput output) throws Exception {
        String invitation = token();
        String share = token();
        String encoded = token();
        http.perform(get("/api/v1/invitations/" + invitation).header("X-Request-Id", "tf042-invitation"))
                .andExpect(status().isNotFound()).andExpect(header().string("X-Request-Id", "tf042-invitation"));
        http.perform(get("/api/v1/public/shares/" + share + "/lines")).andExpect(status().isNotFound());
        http.perform(get(URI.create("/api/v1/%70ublic/shares/" + encoded))).andExpect(status().isNotFound());
        assertThat(output.getOut() + output.getErr()).doesNotContain(invitation).doesNotContain(share).doesNotContain(encoded)
                .contains("/api/v1/invitations/*** 404").contains("/api/v1/public/shares/***/lines 404")
                .contains("requestId=tf042-invitation");
    }

    @Test
    void tf044AndTf114AccountEventsAreAuditedAndTakeoversReachTheOrg() throws Exception {
        String email = email("events");
        Cookie laptop = account(email, "Laptop");
        UUID user = userId(email);
        UUID org = org(laptop, "events");
        assertThat(actions(user)).containsSubsequence("user.password_set", "session.opened");

        http.perform(signIn(email, "not the password", "Laptop", false)).andExpect(status().isUnauthorized());
        assertThat(db.queryForObject("""
                SELECT count(*) FROM audit_events WHERE action = 'auth.sign_in_failed' AND entity_id = ? AND actor_id IS NULL
                """, Integer.class, user)).isEqualTo(1);

        Cookie phone = http.perform(signIn(email, PASSWORD, "Phone", true)).andExpect(status().isCreated())
                .andReturn().getResponse().getCookie("boqlet_session");
        var replaced = db.queryForMap("""
                SELECT org_id, data::text AS data FROM audit_events WHERE action = 'session.replaced' AND actor_id = ?
                """, user);
        assertThat(replaced.get("org_id")).isEqualTo(org);
        JsonNode data = json.readTree((String) replaced.get("data"));
        assertThat(data.path("replacedDeviceLabel").asText()).isEqualTo("Laptop");
        assertThat(data.path("replacementDeviceLabel").asText()).isEqualTo("Phone");
        http.perform(get("/api/v1/orgs/" + org + "/audit").param("action", "session.replaced").cookie(phone))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1));

        String reset = token();
        link(email, reset, "reset");
        http.perform(setPassword(reset, "another long account password", null)).andExpect(status().isNoContent());
        assertThat(json.readTree(db.queryForObject("""
                SELECT data::text FROM audit_events WHERE action = 'user.password_reset' AND entity_id = ?
                """, String.class, user)).path("sessionsEnded").asInt()).isEqualTo(1);

        Cookie again = http.perform(signIn(email, "another long account password", "Desk", false))
                .andExpect(status().isCreated()).andReturn().getResponse().getCookie("boqlet_session");
        http.perform(delete("/api/v1/sessions/current").header("Origin", ORIGIN).cookie(again)).andExpect(status().isNoContent());
        assertThat(actions(user)).containsSubsequence("user.password_set", "session.opened", "session.opened",
                "user.password_reset", "session.opened", "session.ended");
    }

    @Test
    void tf118MembersHaveALastActiveTime() throws Exception {
        String email = email("active");
        Cookie session = account(email, "Laptop");
        UUID org = org(session, "active");
        http.perform(get("/api/v1/me").cookie(session)).andExpect(status().isOk());
        assertThat(db.queryForObject("SELECT last_active_at IS NOT NULL FROM memberships WHERE org_id = ?", Boolean.class, org))
                .isTrue();
        http.perform(get("/api/v1/orgs/" + org + "/members").cookie(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].lastActiveAt").isNotEmpty());
    }

    @Test
    void tf119OrgUpdatedSaysWhichSettingsChanged() throws Exception {
        Cookie session = account(email("settings"), "Laptop");
        UUID org = org(session, "settings");
        http.perform(patch("/api/v1/orgs/" + org).header("Origin", ORIGIN).cookie(session).contentType(MediaType.APPLICATION_JSON)
                .content("{\"settings\":{\"publicLinksAllowed\":false,\"defaultCurrency\":\"USD\"}}")).andExpect(status().isOk());
        JsonNode data = json.readTree(db.queryForObject("""
                SELECT data::text FROM audit_events WHERE action = 'org.updated' AND org_id = ?
                """, String.class, org));
        assertThat(data.at("/before/settings/publicLinksAllowed").asBoolean()).isTrue();
        assertThat(data.at("/after/settings/publicLinksAllowed").asBoolean()).isFalse();
        assertThat(data.at("/before/settings/defaultCurrency").asText()).isEqualTo("EUR");
        assertThat(data.at("/after/settings/defaultCurrency").asText()).isEqualTo("USD");
        assertThat(data.at("/after/settings").has("defaultUnitSystem")).isFalse();
        assertThat(data.at("/before/name").asText()).isEqualTo("Firm settings");
    }

    @Test
    void tf121TheLocaleIsALanguageTag() throws Exception {
        Cookie session = account(email("locale"), "Laptop");
        http.perform(patchMe(session, "{\"locale\":\"not a locale!!\"}")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_body"));
        http.perform(patchMe(session, "{\"locale\":\"sr-Latn\"}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.locale").value("sr-Latn"));
    }

    @Test
    void tf176NamesRefuseControlAndDirectionCharacters() throws Exception {
        Cookie session = account(email("names"), "Laptop");
        // JSON escapes, so the source holds no such character: BEL, ESC, CR LF, RLO, a lone surrogate, NUL.
        for (String name : List.of("a\\u0007b", "\\u001b[31mred", "a\\r\\nb", "abc\\u202Etxt.exe", "x\\ud800", "nul\\u0000")) {
            http.perform(patchMe(session, "{\"name\":\"" + name + "\"}")).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("invalid_body"));
        }
        http.perform(patchMe(session, "{\"name\":\"Ana \\u0110uri\\u0107 \\ud83d\\ude00\"}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Ana Đurić 😀"));
        UUID org = org(session, "names");
        http.perform(patch("/api/v1/orgs/" + org).header("Origin", ORIGIN).cookie(session).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Firm\\u202E\"}")).andExpect(status().isBadRequest());
        http.perform(post("/api/v1/orgs/" + org + "/projects").header("Origin", ORIGIN).cookie(session)
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"P\\u0000\",\"code\":\"P-1\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("invalid_body"));
    }

    @Test
    void tf043InvitationMailIsLimitedPerOrg() throws Exception {
        Cookie session = account(email("invites"), "Laptop");
        UUID org = org(session, "invites");
        seats(org, 2);
        String invitation = json.readTree(http.perform(post("/api/v1/orgs/" + org + "/invitations").header("Origin", ORIGIN)
                .cookie(session).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email("invitee") + "\",\"role\":\"member\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).path("id").asText();
        for (int resend = 2; resend <= 20; resend++) {
            http.perform(post("/api/v1/orgs/" + org + "/invitations/" + invitation + "/resend").header("Origin", ORIGIN).cookie(session))
                    .andExpect(status().isOk());
        }
        http.perform(post("/api/v1/orgs/" + org + "/invitations/" + invitation + "/resend").header("Origin", ORIGIN).cookie(session))
                .andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.code").value("rate_limited"))
                .andExpect(header().exists("Retry-After"));
        assertThat(db.queryForObject("SELECT count(*) FROM email_outbox WHERE entity_id = ?::uuid", Integer.class, invitation))
                .isEqualTo(20);
    }

    @Test
    void tf043EngineRpcCallsAreLimitedPerUser() throws Exception {
        Cookie session = account(email("rpc"), "Laptop");
        // No code and title columns: refused (400) right after the call is counted, without the engine.
        var build = post("/api/v1/codelists/build").header("Origin", ORIGIN).cookie(session).contentType(MediaType.APPLICATION_JSON)
                .content("{\"rows\":[],\"headerRow\":0,\"hierarchy\":\"flat\"}");
        for (int attempt = 0; ; attempt++) {
            long minute = Instant.now().getEpochSecond() / 60;
            db.update("DELETE FROM native_auth_limits WHERE bucket LIKE 'rate:rpc:%'");
            for (int call = 1; call <= 60; call++) http.perform(build).andExpect(status().isBadRequest());
            var limited = http.perform(build).andReturn().getResponse();
            if (Instant.now().getEpochSecond() / 60 != minute && attempt == 0) continue;
            assertThat(limited.getStatus()).isEqualTo(429);
            assertThat(json.readTree(limited.getContentAsString()).path("code").asText()).isEqualTo("rate_limited");
            assertThat(Integer.parseInt(limited.getHeader("Retry-After"))).isBetween(1, 60);
            return;
        }
    }

    @Test
    void tf087TheShareLimitIsPerTokenAndSaysWhenToRetry() throws Exception {
        for (int attempt = 0; ; attempt++) {
            long minute = Instant.now().getEpochSecond() / 60;
            String busy = token();
            for (int request = 0; request < 3; request++) {
                http.perform(get("/api/v1/public/shares/" + busy)).andExpect(status().isNotFound());
            }
            var limited = http.perform(get("/api/v1/public/shares/" + busy)).andReturn().getResponse();
            var other = http.perform(get("/api/v1/public/shares/" + token())).andReturn().getResponse();
            if (Instant.now().getEpochSecond() / 60 != minute && attempt == 0) continue;
            assertThat(limited.getStatus()).isEqualTo(429);
            assertThat(Integer.parseInt(limited.getHeader("Retry-After"))).isBetween(1, 60);
            assertThat(other.getStatus()).isEqualTo(404);
            return;
        }
    }

    @Test
    void tf109PreferencesFollowTheUser() throws Exception {
        Cookie session = account(email("preferences"), "Laptop");
        http.perform(get("/api/v1/me").cookie(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences").isMap()).andExpect(jsonPath("$.preferences.notInModelsCollapsed").doesNotExist());
        http.perform(patchMe(session, "{\"preferences\":{\"notInModelsCollapsed\":true}}")).andExpect(status().isOk());
        http.perform(patchMe(session, "{\"name\":\"Renamed Person\"}")).andExpect(status().isOk());
        http.perform(get("/api/v1/me").cookie(session)).andExpect(jsonPath("$.preferences.notInModelsCollapsed").value(true));
        http.perform(patchMe(session, "{\"preferences\":{\"somethingElse\":1}}")).andExpect(status().isBadRequest());
        // Review C-03: the sheet's model pane and its width follow the user too; a share outside 30–75 % is refused.
        http.perform(patchMe(session, "{\"preferences\":{\"sheetModelOpen\":false,\"sheetSplit\":70}}")).andExpect(status().isOk());
        http.perform(get("/api/v1/me").cookie(session)).andExpect(jsonPath("$.preferences.sheetModelOpen").value(false))
                .andExpect(jsonPath("$.preferences.sheetSplit").value(70)).andExpect(jsonPath("$.preferences.notInModelsCollapsed").value(true));
        http.perform(patchMe(session, "{\"preferences\":{\"sheetSplit\":90}}")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_body"));
        http.perform(get("/api/v1/me").cookie(session)).andExpect(jsonPath("$.preferences.sheetSplit").value(70));
    }

    @Test
    void tf122SuccessfulSignInsDontLockAnOfficeOut() throws Exception {
        String email = email("office");
        account(email, "Desk");
        for (int signIn = 0; signIn < 50; signIn++) {
            http.perform(signIn(email, PASSWORD, "Desk", true)).andExpect(status().isCreated());
        }
        for (int failure = 0; failure < 45; failure++) {
            http.perform(signIn(email("nobody"), "not anyone's password", "Desk", false)).andExpect(status().isUnauthorized());
        }
        http.perform(signIn(email, PASSWORD, "Desk", true)).andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("auth_throttled"));
    }

    @Test
    void tf046ApiAnswersSendHstsAndNosniff() throws Exception {
        http.perform(get("/api/v1/plans")).andExpect(status().isOk())
                .andExpect(header().string("Strict-Transport-Security", org.hamcrest.Matchers.containsString("max-age=31536000")))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        http.perform(get("/api/v1/me")).andExpect(status().isUnauthorized())
                .andExpect(header().exists("Strict-Transport-Security"));
    }

    @Test
    void tf076AnInvitationNeedsASeatUnderThePlan() throws Exception {
        Cookie owner = account(email("seats"), "Laptop");
        UUID org = org(owner, "seats");
        seats(org, 2);
        String invitee = email("seat-invitee");
        String invitation = json.readTree(http.perform(post("/api/v1/orgs/" + org + "/invitations").header("Origin", ORIGIN)
                .cookie(owner).contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + invitee + "\",\"role\":\"member\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).path("id").asText();
        // Two seats (an override: Free has one, P57): the owner and the pending invitation. A member added past it (as a downgrade leaves).
        UUID extra = UUID.randomUUID();
        db.update("INSERT INTO users (id, auth_subject, email, name) VALUES (?, ?, ?, 'Extra')", extra, "test:" + extra, email("extra"));
        db.update("INSERT INTO memberships (org_id, user_id, role) VALUES (?, ?, 'member')", org, extra);
        http.perform(post("/api/v1/orgs/" + org + "/invitations/" + invitation + "/resend").header("Origin", ORIGIN).cookie(owner))
                .andExpect(status().isPaymentRequired()).andExpect(jsonPath("$.code").value("limit_reached"));
        UUID nonce = db.queryForObject("SELECT delivery_nonce FROM org_invitations WHERE id = ?::uuid", UUID.class, invitation);
        String token = invitations.deliveryToken(UUID.fromString(invitation), nonce);
        Cookie person = account(invitee, "Phone");
        http.perform(post("/api/v1/invitations/" + token + "/accept").header("Origin", ORIGIN).cookie(person))
                .andExpect(status().isPaymentRequired());
        db.update("DELETE FROM memberships WHERE user_id = ?", extra);
        http.perform(post("/api/v1/invitations/" + token + "/accept").header("Origin", ORIGIN).cookie(person))
                .andExpect(status().isOk());
    }

    private Cookie account(String email, String device) throws Exception {
        String setup = token();
        link(email, setup, "setup");
        http.perform(setPassword(setup, PASSWORD, "Account Person")).andExpect(status().isNoContent());
        return http.perform(signIn(email, PASSWORD, device, false)).andExpect(status().isCreated())
                .andReturn().getResponse().getCookie("boqlet_session");
    }

    /** Free has one seat (P57): a test that invites gives its org more, as a platform admin's override does. */
    private void seats(UUID org, int seats) {
        db.update("UPDATE subscriptions SET overrides = overrides || jsonb_build_object('seats', ?) WHERE org_id = ?", seats, org);
    }

    private UUID org(Cookie session, String name) throws Exception {
        String slug = "firm-" + name + "-" + Long.toString(RANDOM.nextLong() & Long.MAX_VALUE, 36).substring(0, 6);
        var body = http.perform(post("/api/v1/orgs").header("Origin", ORIGIN).cookie(session).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("name", "Firm " + name, "slug", slug))))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return UUID.fromString(json.readTree(body).path("id").asText());
    }

    private List<String> actions(UUID user) {
        return db.queryForList("""
                SELECT action FROM audit_events WHERE entity_id = ? OR actor_id = ? ORDER BY created_at, action
                """, String.class, user, user).stream().filter(a -> a.startsWith("user.") || a.startsWith("session.")).toList();
    }

    private UUID userId(String email) {
        return db.queryForObject("SELECT id FROM users WHERE email = ?", UUID.class, email);
    }

    private void link(String email, String token, String purpose) throws Exception {
        var hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        db.update("INSERT INTO native_setup_links VALUES (?, ?, now() + interval '1 hour', ?)", email, hash, purpose);
    }

    private MockHttpServletRequestBuilder setPassword(String token, String password, String name) throws Exception {
        var body = name == null ? Map.of("token", token, "password", password) : Map.of("token", token, "password", password, "name", name);
        return post("/api/v1/auth/set-password").header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(body));
    }

    private MockHttpServletRequestBuilder signIn(String email, String password, String device, boolean takeover) throws Exception {
        return post("/api/v1/auth/sign-in").header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", email, "password", password, "deviceLabel", device, "takeover", takeover)));
    }

    private MockHttpServletRequestBuilder patchMe(Cookie session, String body) {
        return patch("/api/v1/me").header("Origin", ORIGIN).cookie(session).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static String email(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.test";
    }

    private static String token() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
