package com.boqlet.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.audit.AuditWriter.ActorKind;
import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.Ids;
import com.boqlet.api.http.Idempotency;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.org.Invitations;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest(properties = "spring.threads.virtual.enabled=false")
@DirtiesContext
@AutoConfigureMockMvc
@Testcontainers
@Import(ApiFoundationTest.Tokens.class)
class ApiFoundationTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
        properties.add("boqlet.auth.pilot-emails", () -> "pilot@example.test,owner@example.test,platform@example.test,limits@example.test");
        properties.add("boqlet.auth.invitation-secret", () -> "local-test-signing-secret-2026-only");
    }

    @Autowired MockMvc http;
    @Autowired ObjectMapper json;
    @Autowired Idempotency idempotency;
    @Autowired AuditWriter audit;
    @Autowired JdbcTemplate database;
    @Autowired Invitations invitations;
    @Autowired EntitlementService entitlements;
    @Autowired jakarta.validation.Validator validator;
    @Autowired com.boqlet.api.worker.Jobs jobs;
    @Autowired org.springframework.transaction.support.TransactionTemplate transactions;

    @Test
    void healthUsesPostgresqlAndPreservesTheRequestId() throws Exception {
        http.perform(get("/actuator/health/readiness").header("X-Request-Id", "readiness-test"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(header().string("X-Request-Id", "readiness-test"));
        http.perform(get("/api/v1/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("unauthenticated"));
    }

    @Test
    void concurrentRequestsRunOnceAndWriteOneAuditEvent() throws Exception {
        UUID user = Ids.newId();
        UUID key = Ids.newId();
        var actions = new AtomicInteger();
        var response = new Idempotency.Result(202, json.createObjectNode().put("value", 42));
        Callable<Idempotency.Result> request = () -> idempotency.execute(user, "test", key, () -> {
            actions.incrementAndGet();
            audit.record(new RequestContext(user, null, null, null), ActorKind.USER, null,
                    "test.started", "test", key, response.body());
            return response;
        });
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(request);
            var second = pool.submit(request);
            assertThat(first.get(10, TimeUnit.SECONDS)).isEqualTo(response);
            assertThat(second.get(10, TimeUnit.SECONDS)).isEqualTo(response);
        }
        assertThat(actions.get()).isEqualTo(1);
        assertThat(database.queryForObject("SELECT count(*) FROM audit_events WHERE entity_id = ?",
                Integer.class, key)).isEqualTo(1);
        assertThat(user.version()).isEqualTo(7);
    }

    @Test
    void anErrorRollsBackTheAuditAndAllowsARetry() {
        UUID user = Ids.newId();
        UUID key = Ids.newId();
        assertThatThrownBy(() -> idempotency.execute(user, "test", key, () -> {
            audit.record(new RequestContext(user, null, null, null), ActorKind.USER, null,
                    "test.started", "test", key, null);
            throw new IllegalStateException("failed");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(database.queryForObject("SELECT count(*) FROM audit_events WHERE entity_id = ?",
                Integer.class, key)).isZero();
        assertThat(idempotency.execute(user, "test", key, () -> new Idempotency.Result(204, null)).status())
                .isEqualTo(204);
    }

    @Test
    void inviteOnlyLoginAndSessionTakeover() throws Exception {
        http.perform(openSession("uninvited", false)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("invitation_required"));
        http.perform(openSession("unverified", false)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("email_unverified"));
        var first = http.perform(openSession("pilot-a", false)).andExpect(status().isCreated())
                .andExpect(header().string(HttpHeaders.SET_COOKIE,
                        org.hamcrest.Matchers.allOf(org.hamcrest.Matchers.containsString("HttpOnly"),
                                org.hamcrest.Matchers.containsString("SameSite=Lax"))))
                .andReturn().getResponse().getCookie("boqlet_session");
        assertThat(first).isNotNull();
        http.perform(get("/api/v1/me").cookie(first)).andExpect(status().isUnauthorized());
        http.perform(get("/api/v1/me").header(HttpHeaders.AUTHORIZATION, "Bearer pilot-a").cookie(first))
                .andExpect(status().isOk()).andExpect(jsonPath("$.user.email").value("pilot@example.test"));
        http.perform(openSession("pilot-b", false)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("session_active"))
                .andExpect(jsonPath("$.activeSession.id").value(first.getValue()));
        var second = http.perform(openSession("pilot-b", true)).andExpect(status().isCreated())
                .andReturn().getResponse().getCookie("boqlet_session");
        assertThat(second).isNotNull();
        http.perform(get("/api/v1/me").header(HttpHeaders.AUTHORIZATION, "Bearer pilot-a").cookie(first))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("session_replaced"));
        http.perform(get("/api/v1/me").header(HttpHeaders.AUTHORIZATION, "Bearer pilot-a").cookie(second))
                .andExpect(status().isUnauthorized());
        http.perform(get("/api/v1/me").header(HttpHeaders.AUTHORIZATION, "Bearer pilot-b").cookie(second))
                .andExpect(status().isOk()).andExpect(jsonPath("$.session.id").value(second.getValue()));
    }

    @Test
    void organisationRolesAndInviteSeatReservation() throws Exception {
        var owner = session("owner");
        var created = http.perform(auth(post("/api/v1/orgs"), "owner", owner).content("""
                {"name":"Pilot Studio","slug":"pilot-studio","settings":{"publicLinksAllowed":false}}
                """)).andExpect(status().isCreated()).andExpect(jsonPath("$.planId").value("free"))
                .andReturn().getResponse().getContentAsString();
        String org = "/api/v1/orgs/" + json.readTree(created).path("id").asText();
        http.perform(auth(patch(org), "owner", owner).content("{\"settings\":{\"defaultCurrency\":\"GBP\"}}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.settings.publicLinksAllowed").value(false))
                .andExpect(jsonPath("$.settings.defaultCurrency").value("GBP"));
        http.perform(auth(get(org + "/setup"), "owner", owner)).andExpect(status().isNoContent());

        var invite = http.perform(auth(post(org + "/invitations"), "owner", owner).content("""
                {"email":"guest@example.test","role":"library_editor"}
                """)).andExpect(status().isCreated()).andExpect(jsonPath("$.token").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        UUID inviteId = UUID.fromString(json.readTree(invite).path("id").asText());
        UUID nonce = database.queryForObject("SELECT delivery_nonce FROM org_invitations WHERE id = ?", UUID.class, inviteId);
        String oldToken = invitations.deliveryToken(inviteId, nonce);
        http.perform(get("/api/v1/invitations/" + oldToken)).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"));
        http.perform(auth(post(org + "/invitations"), "owner", owner).content("""
                {"email":"other@example.test","role":"member"}
                """)).andExpect(status().isPaymentRequired()).andExpect(jsonPath("$.details.limit").value("seats"));
        http.perform(auth(post(org + "/invitations/" + inviteId + "/resend"), "owner", owner))
                .andExpect(status().isOk());
        http.perform(get("/api/v1/invitations/" + oldToken)).andExpect(status().isNotFound());
        nonce = database.queryForObject("SELECT delivery_nonce FROM org_invitations WHERE id = ?", UUID.class, inviteId);
        String accept = "/api/v1/invitations/" + invitations.deliveryToken(inviteId, nonce) + "/accept";
        var guest = session("guest");
        http.perform(auth(get(org), "guest", guest)).andExpect(status().isNotFound());
        http.perform(auth(post(accept), "owner", owner)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("email_mismatch"));
        http.perform(auth(post(accept), "guest", guest)).andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("library_editor"));
        http.perform(auth(patch(org), "guest", guest).content("{\"name\":\"Forbidden rename\"}"))
                .andExpect(status().isForbidden());
        http.perform(auth(put(org + "/setup"), "guest", guest).content("{\"status\":\"done\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.completedAt").exists());
        http.perform(auth(get(org + "/audit?limit=1&action=org.setup_done"), "owner", owner))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].action").value("org.setup_done"));

        UUID ownerId = database.queryForObject("SELECT id FROM users WHERE auth_subject = 'owner'", UUID.class);
        UUID guestId = database.queryForObject("SELECT id FROM users WHERE auth_subject = 'guest'", UUID.class);
        UUID orgId = UUID.fromString(json.readTree(created).path("id").asText());
        var projectResponse = http.perform(auth(post(org + "/projects"), "owner", owner)
                .content("{\"name\":\"Architecture\"}")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.currency").value("GBP")).andExpect(jsonPath("$.projectDictionaryId").exists())
                .andExpect(jsonPath("$.defaults.ruleSetVersionId").exists())
                .andExpect(jsonPath("$.defaults.dictionaryVersionIds[0]").exists())
                .andExpect(jsonPath("$.permissions.editModels").value(true)).andReturn().getResponse().getContentAsString();
        UUID projectId = UUID.fromString(json.readTree(projectResponse).path("id").asText());
        String project = "/api/v1/projects/" + projectId;
        http.perform(auth(get(org + "/projects?q=arch"), "owner", owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(projectId.toString()));
        http.perform(auth(get(project), "guest", guest)).andExpect(status().isNotFound());
        http.perform(auth(post(project + "/members"), "owner", owner)
                .content("{\"userId\":\"" + guestId + "\",\"role\":\"viewer\"}"))
                .andExpect(status().isCreated());
        http.perform(auth(get(project), "guest", guest)).andExpect(status().isOk())
                .andExpect(jsonPath("$.permissions.editModels").value(false));
        http.perform(auth(delete(project + "/members/" + ownerId), "owner", owner))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("last_lead"));
        http.perform(auth(post(org + "/projects"), "owner", owner).content("{\"name\":\"Over limit\"}"))
                .andExpect(status().isPaymentRequired()).andExpect(jsonPath("$.details.limit").value("activeProjects"));
        assertThat(database.queryForObject("SELECT count(*) FROM limit_events WHERE org_id = ?", Integer.class, orgId))
                .isEqualTo(2);

        UUID job = Ids.newId();
        entitlements.recordUsage(orgId, projectId, job, "parse", OffsetDateTime.now(), 90_000, 512L, 5L, "succeeded");
        entitlements.recordUsage(orgId, projectId, job, "parse", OffsetDateTime.now(), 90_000, 512L, 5L, "succeeded");
        http.perform(auth(get(org + "/entitlements"), "guest", guest)).andExpect(status().isOk())
                .andExpect(jsonPath("$.usage.activeProjects").value(1))
                .andExpect(jsonPath("$.usage.processingMinutesThisMonth").value(1.5));
        http.perform(auth(get(org + "/usage"), "guest", guest)).andExpect(status().isForbidden());
        http.perform(auth(get(org + "/usage"), "owner", owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$.byProject[0].projectName").value("Architecture"))
                .andExpect(jsonPath("$.byKind.parse").value(1.5));
        http.perform(auth(post(project + "/archive"), "owner", owner)).andExpect(status().isOk());
        http.perform(auth(patch(project), "owner", owner).content("{\"name\":\"Archived\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("project_archived"));
        http.perform(auth(post(project + "/unarchive"), "owner", owner)).andExpect(status().isOk());
        http.perform(auth(delete(org + "/members/" + guestId), "guest", guest)).andExpect(status().isNoContent());
        http.perform(auth(get(project), "guest", guest)).andExpect(status().isNotFound());
        assertThat(database.queryForObject("SELECT count(*) FROM project_members WHERE user_id = ?", Integer.class, guestId))
                .isZero();

        http.perform(auth(delete(org + "/members/" + ownerId), "owner", owner)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("last_owner"));
        http.perform(auth(delete(org), "owner", owner).content("{\"confirmName\":\"Pilot Studio\"}"))
                .andExpect(status().isAccepted());
        http.perform(auth(get(org), "guest", guest)).andExpect(status().isNotFound());
    }

    @Test
    void platformAdminSeesAccountMetadataAndCannotAccessTenantContent() throws Exception {
        var owner = session("owner");
        var orgResponse = http.perform(auth(post("/api/v1/orgs"), "owner", owner)
                .content("{\"name\":\"Admin Test Firm\",\"slug\":\"admin-test-firm\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse();
        String org = json.readTree(orgResponse.getContentAsString()).path("id").asText();
        String path = "/api/v1/orgs/" + org;
        String project = json.readTree(http.perform(auth(post(path + "/projects"), "owner", owner)
                .content("{\"name\":\"Private project title sentinel\"}")).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).path("id").asText();
        http.perform(auth(post(path + "/projects"), "owner", owner).content("{\"name\":\"Over limit\"}"))
                .andExpect(status().isPaymentRequired());
        http.perform(get("/api/v1/admin/overview")).andExpect(status().isUnauthorized());
        http.perform(auth(get("/api/v1/admin/orgs"), "owner", owner)).andExpect(status().isNotFound());
        http.perform(auth(patch("/api/v1/admin/orgs/" + org), "owner", owner).content("{}"))
                .andExpect(status().isNotFound());
        // TF-011: Spring routes on the decoded path, so the gate must hold for encoded spellings of /admin/ too.
        for (String spelling : java.util.List.of("/api/v1/%61dmin/orgs", "/api/v1/adm%69n/overview", "/api/v1/%61dmin/orgs/" + org)) {
            http.perform(auth(get(java.net.URI.create(spelling)), "owner", owner)).andExpect(status().isNotFound());
        }
        http.perform(auth(patch(java.net.URI.create("/api/v1/%61dmin/orgs/" + org)), "owner", owner)
                .content("{\"status\":\"suspended\",\"reason\":\"probe\"}")).andExpect(status().isNotFound());
        http.perform(get(java.net.URI.create("/api/v1/%61dmin/overview"))).andExpect(status().isUnauthorized());

        var platform = session("platform");
        database.update("UPDATE users SET platform_role = 'admin' WHERE auth_subject = 'platform'");
        String admin = "/api/v1/admin";
        var details = http.perform(auth(get(admin + "/orgs/" + org), "platform", platform)).andExpect(status().isOk())
                .andExpect(jsonPath("$.activeProjects.used").value(1)).andExpect(jsonPath("$.limitEvents[0].limit").value("activeProjects"))
                .andReturn().getResponse().getContentAsString();
        assertThat(details).doesNotContain("Private project title sentinel");
        http.perform(auth(get("/api/v1/projects/" + project), "platform", platform)).andExpect(status().isNotFound());
        http.perform(auth(get(admin + "/orgs").param("signal", "hit_limit").param("q", "Admin Test"), "platform", platform))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].id").value(org));
        http.perform(auth(get(admin + "/overview"), "platform", platform)).andExpect(status().isOk());
        http.perform(auth(get(admin + "/funnel"), "platform", platform)).andExpect(status().isOk());
        http.perform(auth(get(admin + "/health"), "platform", platform)).andExpect(status().isOk());
        http.perform(auth(get(admin + "/users"), "platform", platform)).andExpect(status().isOk());
        http.perform(auth(get(admin + "/orgs.csv"), "platform", platform)).andExpect(status().isOk());
        http.perform(auth(put(admin + "/orgs/" + org + "/subscription"), "platform", platform)
                .content("{\"planId\":\"team\",\"reason\":\"Pilot upgrade\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.planId").value("team"));
        http.perform(auth(get(path + "/entitlements"), "owner", owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$.planId").value("team"));
        http.perform(auth(put(admin + "/orgs/" + org + "/entitlement-overrides"), "platform", platform)
                .content("{\"overrides\":{\"activeProjects\":75},\"reason\":\"Pilot capacity\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.activeProjects.max").value(75));
        http.perform(auth(post(admin + "/orgs/" + org + "/notes"), "platform", platform).content("{\"text\":\"Pilot note\"}"))
                .andExpect(status().isCreated());
        http.perform(auth(get(admin + "/orgs/" + org + "/notes"), "platform", platform)).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].text").value("Pilot note"));
        assertThat(database.queryForObject("""
                SELECT count(*) FROM audit_events WHERE org_id = ? AND actor_kind = 'platform_admin' AND action = 'org.plan_changed'
                """, Long.class, UUID.fromString(org))).isEqualTo(1L);
    }

    /** TF-174: strings, arrays and bodies are bounded, so one member can't make responses (or the heap) huge. */
    @Test
    void requestStringsArraysAndBodiesAreBounded() throws Exception {
        var limits = session("limits");
        http.perform(auth(patch("/api/v1/me"), "limits", limits).content("{\"name\":\"" + "n".repeat(121) + "\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("invalid_body"));
        http.perform(auth(patch("/api/v1/me"), "limits", limits).content("{\"name\":\"" + "n".repeat(120) + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("n".repeat(120)));
        http.perform(auth(post("/api/v1/orgs"), "limits", limits)
                .content("{\"name\":\"" + "o".repeat(201) + "\",\"slug\":\"limits-firm\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("invalid_body"));
        String org = json.readTree(http.perform(auth(post("/api/v1/orgs"), "limits", limits)
                .content("{\"name\":\"Limits firm\",\"slug\":\"limits-firm\"}")).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).path("id").asText();
        String project = json.readTree(http.perform(auth(post("/api/v1/orgs/" + org + "/projects"), "limits", limits)
                .content("{\"name\":\"Limits\"}")).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).path("id").asText();
        String decisions = "/api/v1/projects/" + project + "/decisions?dryRun=true";
        var many = new StringBuilder("{\"decisions\":[");
        for (int i = 0; i <= 10_000; i++) {
            many.append(i == 0 ? "" : ",").append("{\"questionId\":\"unmatched:IfcWall:q").append(i)
                    .append("\",\"kind\":\"unmatched\",\"answer\":\"skip\"}");
        }
        http.perform(auth(post(decisions), "limits", limits).content(many.append("]}").toString()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("invalid_body"));
        String one = "{\"decisions\":[{\"questionId\":\"unmatched:IfcWall:q\",\"kind\":\"unmatched\",\"answer\":%s%s}]}";
        http.perform(auth(post(decisions), "limits", limits).content(one.formatted("\"skip\"", ",\"note\":\"" + "x".repeat(4001) + "\"")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("invalid_body"));
        http.perform(auth(post(decisions), "limits", limits).content(one.formatted("\"" + "x".repeat(4001) + "\"", "")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("invalid_body"));
        http.perform(auth(post(decisions), "limits", limits).content(one.formatted("\"skip\"", ",\"note\":\"fine\"")))
                .andExpect(status().isOk());

        // A JSON body over 1 MiB is refused before it is parsed; the document operations allow 32 MiB.
        http.perform(auth(patch("/api/v1/me"), "limits", limits).content("{\"name\":\"" + "n".repeat(1 << 20) + "\"}"))
                .andExpect(status().isPayloadTooLarge()).andExpect(jsonPath("$.code").value("too_large"));
        assertThat(database.queryForObject("SELECT name FROM users WHERE auth_subject = 'limits'", String.class))
                .isEqualTo("n".repeat(120));
        var padded = new StringBuilder("{\"decisions\":[");
        for (int i = 0; i < 400; i++) {
            padded.append(i == 0 ? "" : ",").append("{\"questionId\":\"unmatched:IfcWall:p").append(i)
                    .append("\",\"kind\":\"unmatched\",\"answer\":\"skip\",\"note\":\"").append("x".repeat(3000)).append("\"}");
        }
        assertThat(padded.length()).isGreaterThan(1 << 20);
        http.perform(auth(post(decisions), "limits", limits).content(padded.append("]}").toString()))
                .andExpect(status().isOk());

        // Optional (JsonNullable) fields are validated through their value too.
        var edit = new com.boqlet.contract.model.LineOverrideInput("line").sortAfter("previous line");
        assertThat(validator.validate(edit)).isEmpty();
        assertThat(validator.validate(edit.sortAfter("k".repeat(4001)))).hasSize(1);
    }

    /** TF-036 (BR-62): every parse, run and preview that ends has a usage event, a cancelled one too, with its earlier attempts' time. */
    @Test
    void aJobCancelledWhileQueuedIsMeteredWithItsEarlierAttempts() throws Exception {
        var owner = session("owner");
        String org = json.readTree(http.perform(auth(post("/api/v1/orgs"), "owner", owner)
                .content("{\"name\":\"Metering firm\",\"slug\":\"metering-firm\"}")).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).path("id").asText();
        String project = json.readTree(http.perform(auth(post("/api/v1/orgs/" + org + "/projects"), "owner", owner)
                .content("{\"name\":\"Metered\"}")).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).path("id").asText();
        UUID actor = database.queryForObject("SELECT id FROM users WHERE auth_subject = 'owner'", UUID.class);
        UUID job = transactions.execute(status -> {
            UUID id = jobs.enqueue("parse", UUID.fromString(org), UUID.fromString(project), actor, "modelVersion", Ids.newId(),
                    "orgs/" + org + "/test/", java.util.Map.of(), 5);
            // An attempt failed after 5 s and the job waits for its retry (no worker in this test claims it).
            database.update("UPDATE jobs SET available_at = now() + interval '1 hour', attempts = 1, processing_ms = 5000 WHERE id = ?", id);
            return id;
        });
        jobs.cancel(job, actor);
        assertThat(database.queryForMap("SELECT outcome, duration_ms FROM usage_events WHERE job_id = ?", job))
                .containsEntry("outcome", "cancelled").containsEntry("duration_ms", 5000L);
    }

    private Cookie session(String token) throws Exception {
        return http.perform(openSession(token, false)).andExpect(status().isCreated())
                .andReturn().getResponse().getCookie("boqlet_session");
    }

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request, String token, Cookie cookie) {
        return request.header(HttpHeaders.AUTHORIZATION, "Bearer " + token).cookie(cookie)
                .contentType(MediaType.APPLICATION_JSON);
    }

    private MockHttpServletRequestBuilder openSession(String token, boolean takeover) {
        return post("/api/v1/sessions").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"deviceLabel\":\"Test browser\",\"takeover\":" + takeover + "}");
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Tokens {
        @Bean
        JwtDecoder testTokenDecoder() {
            return token -> {
                String subject = switch (token) {
                    case "pilot-a", "pilot-b" -> "pilot";
                    case "owner", "owner-b" -> "owner";
                    case "uninvited", "unverified", "guest", "platform", "limits" -> token;
                    case "suite-olivia", "suite-ivana", "suite-marko", "suite-ana", "suite-victor", "suite-pat" -> token;
                    // People the shared scenarios sign up (com.boqlet.suite.SuiteSupport): the person is
                    // the subject; each browser of theirs is its own provider session (sid).
                    default -> {
                        if (com.boqlet.suite.SuiteSupport.emailOf(token) != null) yield com.boqlet.suite.SuiteSupport.personOf(token);
                        throw new JwtException("Invalid test token.");
                    }
                };
                Instant now = Instant.now();
                String signedUp = com.boqlet.suite.SuiteSupport.emailOf(subject);
                String email = signedUp != null ? signedUp
                        : subject.startsWith("suite-") ? subject.substring(6) + "@example.com" : subject + "@example.test";
                return Jwt.withTokenValue(token).header("alg", "RS256").subject(subject)
                        .claim("sid", token).claim("email", email)
                        .claim("email_verified", !token.equals("unverified"))
                        .issuedAt(now).expiresAt(now.plusSeconds(600)).build();
            };
        }
    }
}
