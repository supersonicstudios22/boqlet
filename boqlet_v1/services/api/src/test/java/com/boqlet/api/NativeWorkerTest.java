package com.boqlet.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.boqlet.api.maintenance.Maintenance;
import com.boqlet.api.db.Ids;
import com.boqlet.api.storage.ObjectStorage;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.Duration;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "spring.threads.virtual.enabled=false")
@DirtiesContext
@AutoConfigureMockMvc
@Testcontainers
@Import(ApiFoundationTest.Tokens.class)
@EnabledIfEnvironmentVariable(named = "BOQLET_NATIVE_WORKER_PYTHON", matches = ".+")
class NativeWorkerTest {
    private static final String BUCKET = "boqlet-native-test";
    private static final String ACCESS = "boqlet-test";
    private static final String SECRET = "boqlet-local-test-only";
    private static final Path ROOT = Path.of("../..").toAbsolutePath().normalize();
    private static Process worker;
    private static final java.util.List<Process> queueWorkers = new java.util.ArrayList<>();
    private static final boolean POSTGRES_QUEUE = "1".equals(System.getenv("BOQLET_NATIVE_QUEUE_TEST"));
    private static final HttpClient NETWORK = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Container
    static final GenericContainer<?> S3 = new GenericContainer<>(DockerImageName.parse("minio/minio:latest"))
            .withEnv("MINIO_ROOT_USER", ACCESS).withEnv("MINIO_ROOT_PASSWORD", SECRET)
            .withCommand("server", "/data").withExposedPorts(9000)
            .waitingFor(Wait.forHttp("/minio/health/ready").forPort(9000));

    @Container
    static final GenericContainer<?> MAIL = new GenericContainer<>(DockerImageName.parse("mailhog/mailhog:v1.0.1"))
            .withExposedPorts(1025, 8025).waitingFor(Wait.forHttp("/api/v2/messages").forPort(8025));

    @DynamicPropertySource
    static void services(DynamicPropertyRegistry properties) throws IOException {
        String endpoint = "http://" + S3.getHost() + ":" + S3.getMappedPort(9000);
        try (var admin = S3Client.builder().region(Region.US_EAST_1).forcePathStyle(true).endpointOverride(URI.create(endpoint))
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(ACCESS, SECRET))).build()) {
            admin.createBucket(request -> request.bucket(BUCKET));
        }
        int port;
        try (var listener = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            port = listener.getLocalPort();
        }
        String url = "http://127.0.0.1:" + port;
        var start = new ProcessBuilder(System.getenv("BOQLET_NATIVE_WORKER_PYTHON"), "-m", "uvicorn", "ifc_boq.worker_http:app",
                "--host", "127.0.0.1", "--port", Integer.toString(port))
                .directory(ROOT.resolve("engine").toFile()).redirectErrorStream(true)
                .redirectOutput(Path.of("target/native-worker.log").toFile());
        start.environment().put("ENGINE_STORAGE", "s3://" + BUCKET);
        start.environment().put("ENGINE_S3_ENDPOINT", endpoint);
        start.environment().put("AWS_ACCESS_KEY_ID", ACCESS);
        start.environment().put("AWS_SECRET_ACCESS_KEY", SECRET);
        start.environment().put("AWS_DEFAULT_REGION", "us-east-1");
        worker = start.start();
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
        properties.add("boqlet.auth.pilot-emails", () -> "owner@example.test,platform@example.test");
        properties.add("boqlet.auth.invitation-secret", () -> "local-test-signing-secret-2026-only");
        properties.add("spring.mail.host", MAIL::getHost);
        properties.add("spring.mail.port", () -> MAIL.getMappedPort(1025));
        properties.add("spring.mail.properties[mail.smtp.auth]", () -> false);
        properties.add("spring.mail.properties[mail.smtp.starttls.enable]", () -> false);
        properties.add("spring.mail.properties[mail.smtp.starttls.required]", () -> false);
        properties.add("BOQLET_SMTP_FROM", () -> "boqlet@example.test");
        properties.add("BOQLET_SMTP_POLL_MS", () -> 250);
        properties.add("boqlet.storage.bucket", () -> BUCKET);
        properties.add("boqlet.storage.region", () -> "us-east-1");
        properties.add("boqlet.storage.endpoint", () -> endpoint);
        properties.add("boqlet.worker.url", () -> url);
        if (POSTGRES_QUEUE) {
            properties.add("BOQLET_ENGINE_TRANSPORT", () -> "postgres");
            properties.add("BOQLET_ENGINE_MODEL_POOL", () -> "ifc");
        }
    }

    @AfterAll
    static void stopServices() {
        if (worker != null) worker.destroy();
        queueWorkers.forEach(Process::destroy);
    }

    @Autowired MockMvc http;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate database;
    @Autowired Maintenance maintenance;
    @Autowired ObjectStorage storage;
    @LocalServerPort int apiPort;

    @Test
    void duplexUploadRunsWorkerAndServesModelArtifacts() throws Exception {
        if (POSTGRES_QUEUE) startQueueWorkers();
        Cookie cookie = http.perform(post("/api/v1/sessions").header(HttpHeaders.AUTHORIZATION, "Bearer owner")
                .contentType(MediaType.APPLICATION_JSON).content("{\"deviceLabel\":\"Native worker test\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getCookie("boqlet_session");
        String org = id(perform(post("/api/v1/orgs").content("{\"name\":\"Native\",\"slug\":\"native-worker\"}"), cookie, 201));
        verifyInvitationMail(org, cookie);
        String project = id(perform(post("/api/v1/orgs/" + org + "/projects").content("{\"name\":\"Duplex\"}"), cookie, 201));
        String model = id(perform(post("/api/v1/projects/" + project + "/models")
                .content("{\"name\":\"Architecture\",\"discipline\":\"architecture\"}"), cookie, 201));
        Path fixture = ROOT.resolve("fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc");
        var staged = perform(post("/api/v1/models/" + model + "/versions")
                .content("{\"fileName\":\"Duplex.ifc\",\"sizeBytes\":" + java.nio.file.Files.size(fixture) + "}"), cookie, 201);
        String version = id(staged.path("version"));
        String base = "/api/v1/model-versions/" + version;
        http.perform(auth(post(base + "/complete"), cookie)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("upload_missing"));
        var put = HttpRequest.newBuilder(URI.create(staged.path("upload").path("url").asText()))
                .PUT(HttpRequest.BodyPublishers.ofFile(fixture)).timeout(Duration.ofSeconds(30)).build();
        assertThat(NETWORK.send(put, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(200);
        var queued = perform(post(base + "/complete"), cookie, 200);
        String job = queued.path("parseJobId").asText();
        assertThat(job).isNotBlank();
        assertThat(perform(post(base + "/complete"), cookie, 200).path("parseJobId").asText()).isEqualTo(job);
        awaitJob(job, cookie);
        var ready = perform(get(base), cookie, 200);
        assertThat(ready.path("status").asText()).isEqualTo("ready");
        assertThat(ready.path("summary").path("elementCount").asInt()).isGreaterThan(100);
        assertThat(perform(get(base + "/scene"), cookie, 200).path("elements").size()).isGreaterThan(100);
        var redirect = http.perform(auth(get(base + "/geometry"), cookie)).andExpect(status().isFound())
                .andReturn().getResponse().getHeader("Location");
        byte[] glb = NETWORK.send(HttpRequest.newBuilder(URI.create(redirect)).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray()).body();
        assertThat(glb).startsWith((byte) 'g', (byte) 'l', (byte) 'T', (byte) 'F');
        assertThat(perform(post(base + "/names").content("{}"), cookie, 200).path("names").size()).isGreaterThan(0);
        assertThat(perform(get("/api/v1/orgs/" + org + "/usage"), cookie, 200).path("byKind").has("parse")).isTrue();
        verifyLibrary(org, version, cookie);
        verifyBoq(org, project, version, cookie);
        verifyRevisedIfc(project, model, cookie);
        verifySample(org, cookie);
        verifyOrgPurge(cookie);
        verifyRealtime(org, cookie);
        verifySharedContract();
    }

    private void verifyRevisedIfc(String project, String model, Cookie cookie) throws Exception {
        Path fixture = ROOT.resolve("fixtures/ifc/Ifc2x3_Duplex_Architecture_v2.ifc");
        var staged = perform(post("/api/v1/models/" + model + "/versions")
                .content("{\"fileName\":\"Duplex-v2.ifc\",\"sizeBytes\":" + java.nio.file.Files.size(fixture) + "}"), cookie, 201);
        var put = HttpRequest.newBuilder(URI.create(staged.path("upload").path("url").asText()))
                .PUT(HttpRequest.BodyPublishers.ofFile(fixture)).timeout(Duration.ofSeconds(30)).build();
        assertThat(NETWORK.send(put, HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(200);
        String version = id(staged.path("version"));
        var queued = perform(post("/api/v1/model-versions/" + version + "/complete"), cookie, 200);
        awaitJob(queued.path("parseJobId").asText(), cookie);
        var versions = perform(get("/api/v1/models/" + model), cookie, 200);
        assertThat(versions.path("latestVersion").path("id").asText()).isEqualTo(version);
        var notification = perform(get("/api/v1/notifications"), cookie, 200).path("items");
        assertThat(java.util.stream.StreamSupport.stream(notification.spliterator(), false)
                .anyMatch(item -> item.path("kind").asText().equals("boq.new_version_available"))).isTrue();
        var boq = perform(get("/api/v1/projects/" + project + "/boqs"), cookie, 200).get(0);
        var revision = boq.path("currentRevision");
        String revisionPath = "/api/v1/revisions/" + id(revision);
        String before = id(revision.path("currentRun"));
        var modelInput = (com.fasterxml.jackson.databind.node.ObjectNode) revision.path("inputs").path("models").get(0).deepCopy();
        modelInput.remove("newerVersionAvailable");
        modelInput.put("modelVersionId", version);
        var body = json.createObjectNode();
        body.putObject("inputs").putArray("models").add(modelInput);
        var picked = perform(patch(revisionPath).content(body.toString()), cookie, 200);
        assertThat(picked.path("inputs").path("dictionaryVersionIds")).isEqualTo(revision.path("inputs").path("dictionaryVersionIds"));
        var started = perform(post(revisionPath + "/runs"), cookie, 202);
        awaitJob(id(started.path("job")), cookie);
        var comparison = perform(post("/api/v1/runs/" + id(started.path("run")) + "/compare")
                .content("{\"againstRunId\":\"" + before + "\"}"), cookie, 202);
        var diffId = awaitJob(id(comparison), cookie).path("output").path("diffId").asText();
        var diff = perform(get("/api/v1/diffs/" + diffId + "/elements"), cookie, 200);
        assertThat(diff.path("items").size()).isEqualTo(3);
    }

    private void verifySharedContract() throws Exception {
        String node = System.getenv("BOQLET_NATIVE_NODE");
        if (node == null || node.isBlank()) return;
        var fixtures = new java.util.LinkedHashMap<String, java.util.UUID>();
        var users = json.createArrayNode();
        for (String key : java.util.List.of("olivia", "ivana", "marko", "ana", "victor", "pat")) {
            var id = Ids.newId();
            String token = "suite-" + key;
            String email = key + "@example.com";
            database.update("INSERT INTO users (id, auth_subject, email, name, platform_role) VALUES (?, ?, ?, ?, ?)",
                    id, token, email, key, key.equals("pat") ? "admin" : null);
            Cookie session = http.perform(post("/api/v1/sessions").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON).content("{\"deviceLabel\":\"Shared contract suite\"}"))
                    .andExpect(status().isCreated()).andReturn().getResponse().getCookie("boqlet_session");
            users.addObject().put("id", id.toString()).put("email", email).put("name", key)
                    .put("token", token).put("cookie", session.getName() + "=" + session.getValue());
            fixtures.put(key, id);
        }
        var studio = Ids.newId();
        var small = Ids.newId();
        database.update("INSERT INTO orgs (id, name, slug) VALUES (?, 'Studio Demo', 'studio-demo'), (?, 'Small Firm', 'small-firm')",
                studio, small);
        database.update("INSERT INTO subscriptions(org_id, plan_id) VALUES (?, 'team'), (?, 'free')", studio, small);
        for (var key : java.util.List.of("olivia", "ivana", "marko", "ana", "victor")) {
            String role = switch (key) {
                case "olivia" -> "owner";
                case "ivana" -> "library_editor";
                default -> "member";
            };
            database.update("INSERT INTO memberships(org_id, user_id, role) VALUES (?, ?, ?)", studio, fixtures.get(key), role);
        }
        database.update("INSERT INTO memberships(org_id, user_id, role) VALUES (?, ?, 'owner')", small, fixtures.get("olivia"));
        Path log = Path.of("target/shared-java-contract.log").toAbsolutePath();
        var script = new ProcessBuilder(node, "run.mjs", "contract").directory(ROOT.resolve("tests").toFile())
                .redirectErrorStream(true).redirectOutput(log.toFile());
        script.environment().put("API_URL", "http://localhost:" + apiPort + "/api/v1");
        script.environment().put("SUITE_TARGET", "java");
        script.environment().put("BOQLET_JAVA_SUITE_USERS", users.toString());
        Process test = script.start();
        try {
            assertThat(test.waitFor(90, java.util.concurrent.TimeUnit.SECONDS)).as("shared contract test timed out").isTrue();
            assertThat(test.exitValue()).as("shared contract result %s", java.nio.file.Files.readString(log)).isZero();
        } finally {
            if (test.isAlive()) test.destroyForcibly();
        }
    }

    private void verifyOrgPurge(Cookie cookie) throws Exception {
        String org = id(perform(post("/api/v1/orgs").content("{\"name\":\"Purge sample\",\"slug\":\"purge-sample\"}"), cookie, 201));
        String orgPath = "/api/v1/orgs/" + org;
        perform(post(orgPath + "/projects").content("{\"name\":\"Purge project\"}"), cookie, 201);
        var id = java.util.UUID.fromString(org);
        String artifact = ObjectStorage.orgPrefix(id) + "test/probe";
        storage.put(artifact, "application/octet-stream", new byte[]{1, 2, 3});
        http.perform(auth(delete(orgPath).content("{\"confirmName\":\"Purge sample\"}"), cookie))
                .andExpect(status().isAccepted());
        database.update("UPDATE orgs SET deleting_at = now() - interval '2 days' WHERE id = ?", id);
        maintenance.retain();
        assertThat(database.queryForObject("SELECT count(*) FROM orgs WHERE id = ?", Long.class, id)).isZero();
        assertThat(storage.exists(artifact)).isFalse();
    }

    private void startQueueWorkers() throws Exception {
        database.execute("CREATE ROLE boqlet_queue_test LOGIN PASSWORD 'local-queue-test-only'");
        database.execute("GRANT EXECUTE ON FUNCTION queue_claim(uuid,text,text[]) TO boqlet_queue_test");
        database.execute("GRANT EXECUTE ON FUNCTION queue_renew(uuid,uuid,integer,jsonb) TO boqlet_queue_test");
        database.execute("GRANT EXECUTE ON FUNCTION queue_finish(uuid,uuid,integer,jsonb) TO boqlet_queue_test");
        try (var worker = java.sql.DriverManager.getConnection(POSTGRES.getJdbcUrl(), "boqlet_queue_test", "local-queue-test-only");
             var statement = worker.createStatement()) {
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> statement.execute("SELECT id FROM orgs"))
                    .isInstanceOf(java.sql.SQLException.class).hasMessageContaining("permission denied");
        }
        var dsn = "postgresql://boqlet_queue_test:local-queue-test-only@" + POSTGRES.getHost() + ":"
                + POSTGRES.getMappedPort(5432) + "/" + POSTGRES.getDatabaseName();
        var endpoint = "http://" + S3.getHost() + ":" + S3.getMappedPort(9000);
        for (String pool : java.util.List.of("ifc", "default")) {
            var start = new ProcessBuilder(System.getenv("BOQLET_NATIVE_WORKER_PYTHON"), "-m", "ifc_boq.worker_queue", "--pool", pool,
                    "--concurrency", pool.equals("ifc") ? "2" : "1", "--poll-seconds", "0.2")
                    .directory(ROOT.resolve("engine").toFile()).redirectErrorStream(true)
                    .redirectOutput(Path.of("target/queue-worker-" + pool + ".log").toFile());
            start.environment().put("ENGINE_QUEUE_DSN", dsn);
            start.environment().put("ENGINE_STORAGE", "s3://" + BUCKET);
            start.environment().put("ENGINE_S3_ENDPOINT", endpoint);
            start.environment().put("AWS_ACCESS_KEY_ID", ACCESS);
            start.environment().put("AWS_SECRET_ACCESS_KEY", SECRET);
            start.environment().put("AWS_DEFAULT_REGION", "us-east-1");
            queueWorkers.add(start.start());
        }
    }

    private void verifySample(String org, Cookie cookie) throws Exception {
        String orgPath = "/api/v1/orgs/" + org;
        var before = perform(get(orgPath + "/entitlements"), cookie, 200).path("usage");
        String project = id(perform(post(orgPath + "/projects").content("""
                {"name":"Sample Duplex","sample":"duplex"}
                """), cookie, 201));
        String models = "/api/v1/projects/" + project + "/models";
        var model = perform(get(models), cookie, 200).get(0);
        var version = perform(get("/api/v1/models/" + id(model) + "/versions"), cookie, 200).get(0);
        awaitJob(version.path("parseJobId").asText(), cookie);
        String boqs = "/api/v1/projects/" + project + "/boqs";
        for (int poll = 0; poll < 80; poll++) {
            var items = perform(get(boqs), cookie, 200);
            if (!items.isEmpty()) {
                var run = items.get(0).path("currentRevision").path("currentRun");
                if (java.util.Set.of("complete", "needs_input").contains(run.path("status").asText())) {
                    var after = perform(get(orgPath + "/entitlements"), cookie, 200).path("usage");
                    assertThat(after.path("activeProjects")).isEqualTo(before.path("activeProjects"));
                    assertThat(after.path("processingMinutesThisMonth")).isEqualTo(before.path("processingMinutesThisMonth"));
                    return;
                }
            }
            Thread.sleep(250);
        }
        throw new AssertionError("The bundled Duplex did not generate a sample BoQ.");
    }

    private void verifyInvitationMail(String org, Cookie cookie) throws Exception {
        perform(post("/api/v1/orgs/" + org + "/invitations").content("""
                {"email":"new-pilot@example.test","role":"member"}
                """), cookie, 201);
        var uri = URI.create("http://" + MAIL.getHost() + ":" + MAIL.getMappedPort(8025) + "/api/v2/messages");
        var request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(3)).GET().build();
        var token = java.util.regex.Pattern.compile("/invite/([A-Za-z0-9_-]{43})");
        for (int poll = 0; poll < 40; poll++) {
            var messages = json.readTree(NETWORK.send(request, HttpResponse.BodyHandlers.ofString()).body());
            for (var email : messages.path("items")) {
                var link = token.matcher(email.path("Content").path("Body").asText());
                if (link.find()) {
                    http.perform(get("/api/v1/invitations/" + link.group(1))).andExpect(status().isOk())
                            .andExpect(jsonPath("$.email").value("new-pilot@example.test"));
                    return;
                }
            }
            Thread.sleep(250);
        }
        throw new AssertionError("The pilot invitation was not delivered to the local SMTP catcher.");
    }

    private void verifyRealtime(String org, Cookie cookie) throws Exception {
        assertThat(perform(get("/api/v1/orgs/" + org + "/attention"), cookie, 200).isArray()).isTrue();
        var notifications = perform(get("/api/v1/notifications?unreadOnly=true"), cookie, 200);
        assertThat(notifications.path("unreadCount").asInt()).isPositive();
        String notification = id(notifications.path("items").get(0));
        http.perform(auth(post("/api/v1/notifications/" + notification + "/read"), cookie)).andExpect(status().isNoContent());

        var stream = HttpRequest.newBuilder(URI.create("http://localhost:" + apiPort + "/api/v1/events"))
                .header(HttpHeaders.AUTHORIZATION, "Bearer owner").header(HttpHeaders.COOKIE, cookie.getName() + "=" + cookie.getValue())
                .header(HttpHeaders.ACCEPT, "text/event-stream").header("Last-Event-ID", "0").timeout(Duration.ofSeconds(20)).GET().build();
        var response = NETWORK.send(stream, HttpResponse.BodyHandlers.ofInputStream());
        assertThat(response.statusCode()).isEqualTo(200);
        try (var data = response.body(); var pool = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var observed = pool.submit(() -> {
                var reader = new java.io.BufferedReader(new java.io.InputStreamReader(data, java.nio.charset.StandardCharsets.UTF_8));
                boolean finished = false;
                for (String line; (line = reader.readLine()) != null;) {
                    if (line.equals("event:job.finished")) finished = true;
                    if (line.equals("event:session.revoked")) return finished;
                }
                return false;
            });
            http.perform(post("/api/v1/sessions").header(HttpHeaders.AUTHORIZATION, "Bearer owner-b")
                            .contentType(MediaType.APPLICATION_JSON).content("{\"deviceLabel\":\"Second browser\",\"takeover\":true}"))
                    .andExpect(status().isCreated());
            try {
                assertThat(observed.get(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            } finally {
                observed.cancel(true);
            }
        }
        http.perform(auth(get("/api/v1/me"), cookie)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("session_replaced"));
    }

    private void verifyBoq(String org, String project, String version, Cookie cookie) throws Exception {
        var bill = perform(post("/api/v1/projects/" + project + "/boqs").content("{\"name\":\"Tender\"}"), cookie, 201);
        String billId = id(bill);
        String first = id(bill.path("currentRevision"));
        assertThat(bill.path("currentRevision").path("inputs").path("models").size()).isEqualTo(1);
        String revisionPath = "/api/v1/revisions/" + first;
        String generateKey = java.util.UUID.randomUUID().toString();
        var started = perform(post(revisionPath + "/runs").header("Idempotency-Key", generateKey), cookie, 202);
        String job = id(started.path("job"));
        String run = id(started.path("run"));
        awaitJob(job, cookie);
        assertThat(perform(post(revisionPath + "/runs").header("Idempotency-Key", generateKey), cookie, 202)).isEqualTo(started);
        String runPath = "/api/v1/runs/" + run;
        var lines = perform(get(runPath + "/lines?limit=3"), cookie, 200);
        assertThat(lines.path("total").asInt()).isGreaterThan(30);
        assertThat(lines.path("items").get(0).has("positionNo")).isTrue();
        String key = lines.path("items").get(0).path("key").asText();
        var details = perform(get(runPath + "/lines/by-key").param("key", key), cookie, 200);
        assertThat(details.path("trace").path("formula").asText()).isNotBlank();
        assertThat(perform(get(runPath + "/coverage"), cookie, 200).path("measured").size()).isPositive();
        perform(get(runPath + "/questions"), cookie, 200);
        perform(get(runPath + "/warnings"), cookie, 200);
        assertThat(perform(get(runPath + "/log?limit=2"), cookie, 200).path("items").size()).isEqualTo(2);
        var saved = perform(post(revisionPath + "/issue").content("{\"notModelledConfirmed\":true,\"note\":\"Pilot freeze\"}"), cookie, 200);
        assertThat(saved.path("frozen").path("runId").asText()).isEqualTo(run);
        assertThat(saved.path("frozen").path("exportIds").size()).isEqualTo(1);
        http.perform(auth(patch(revisionPath).content("{\"inputs\":{\"dictionaryVersionIds\":[]}}"), cookie))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("revision_locked"));
        String billPath = "/api/v1/boqs/" + billId;
        var confirmed = perform(post(billPath + "/confirm"), cookie, 200);
        assertThat(confirmed.path("currentRevision").path("label").asText()).isEqualTo("A");
        var reopened = perform(post(billPath + "/reopen").content("{\"reason\":\"Next design revision\"}"), cookie, 200);
        assertThat(reopened.path("currentRevision").path("label").asText()).isEqualTo("B");
        String next = id(reopened.path("currentRevision"));
        var changes = json.createObjectNode().put("lineKey", key).put("description", "Estimator's description")
                .put("reason", "Private estimator note");
        perform(post(billPath + "/overrides").content(changes.toString()), cookie, 200);
        assertThat(perform(get(billPath), cookie, 200).path("currentRevision").path("pendingChanges").toString())
                .contains("adjustments");
        var updated = perform(post("/api/v1/revisions/" + next + "/runs"), cookie, 202);
        awaitJob(id(updated.path("job")), cookie);
        String after = id(updated.path("run"));
        String diff = id(perform(post("/api/v1/runs/" + after + "/compare")
                .content("{\"againstRunId\":\"" + run + "\"}"), cookie, 202));
        String reportId = awaitJob(diff, cookie).path("output").path("diffId").asText();
        var report = perform(get("/api/v1/diffs/" + reportId), cookie, 200);
        assertThat(report.path("summary").path("linesChanged").asInt()).isPositive();
        var excel = perform(post("/api/v1/diffs/" + reportId + "/export"), cookie, 202);
        var exported = awaitJob(id(excel), cookie).path("output").path("exportId").asText();
        http.perform(auth(get("/api/v1/exports/" + exported + "/download"), cookie)).andExpect(status().isFound());
        verifySharing(org, billPath, next, version, key, cookie);
        verifyIndexRestoration(billPath, next, after, key, cookie);
        verifyTenantIsolation(org, project, version, billPath, next, after, reportId, exported, job);
    }

    private void verifyTenantIsolation(String org, String project, String version, String bill, String revision,
                                       String run, String diff, String export, String job) throws Exception {
        Cookie outsider = http.perform(post("/api/v1/sessions").header(HttpHeaders.AUTHORIZATION, "Bearer platform")
                .contentType(MediaType.APPLICATION_JSON).content("{\"deviceLabel\":\"Unrelated account\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getCookie("boqlet_session");
        String organisation = "/api/v1/orgs/" + org;
        for (String path : java.util.List.of(organisation, organisation + "/members", organisation + "/billing",
                organisation + "/audit", organisation + "/attention", organisation + "/share-links", organisation + "/usage",
                organisation + "/projects", "/api/v1/projects/" + project + "/boqs", "/api/v1/projects/" + project + "/decisions",
                bill, bill + "/share-links", bill + "/overrides", "/api/v1/revisions/" + revision + "/runs",
                "/api/v1/runs/" + run + "/lines", "/api/v1/runs/" + run + "/result", "/api/v1/runs/" + run + "/questions",
                "/api/v1/model-versions/" + version,
                "/api/v1/model-versions/" + version + "/scene", "/api/v1/model-versions/" + version + "/geometry",
                "/api/v1/diffs/" + diff + "/elements", "/api/v1/exports/" + export + "/download", "/api/v1/jobs/" + job)) {
            http.perform(get(path).header(HttpHeaders.AUTHORIZATION, "Bearer platform").cookie(outsider)).andExpect(status().isNotFound());
        }
        http.perform(post("/api/v1/revisions/" + revision + "/runs").header(HttpHeaders.AUTHORIZATION, "Bearer platform")
                .cookie(outsider).contentType(MediaType.APPLICATION_JSON)).andExpect(status().isNotFound());
        http.perform(post(bill + "/share-links").header(HttpHeaders.AUTHORIZATION, "Bearer platform").cookie(outsider)
                .contentType(MediaType.APPLICATION_JSON).content("{\"mode\":\"latest_issued\"}")).andExpect(status().isNotFound());
    }

    private void verifyIndexRestoration(String billPath, String revision, String superseded, String lineKey, Cookie cookie) throws Exception {
        var edit = json.createObjectNode().put("lineKey", lineKey).put("description", "Latest description");
        perform(post(billPath + "/overrides").content(edit.toString()), cookie, 200);
        var regenerated = perform(post("/api/v1/revisions/" + revision + "/runs"), cookie, 202);
        awaitJob(id(regenerated.path("job")), cookie);
        var old = java.util.UUID.fromString(superseded);
        database.update("UPDATE runs SET indexed_at = now() - interval '40 days' WHERE id = ?", old);
        maintenance.retain();
        assertThat(database.queryForObject("SELECT count(*) FROM run_lines WHERE run_id = ?", Long.class, old)).isZero();
        var result = perform(get("/api/v1/runs/" + superseded + "/lines/by-key").param("key", lineKey), cookie, 200);
        assertThat(result.path("description").asText()).isEqualTo("Estimator's description");
        assertThat(database.queryForObject("SELECT count(*) FROM run_lines WHERE run_id = ?", Long.class, old)).isPositive();
    }

    private void verifySharing(String org, String bill, String revision, String version, String line, Cookie cookie) throws Exception {
        String key = java.util.UUID.randomUUID().toString();
        String body = """
                {"mode":"pinned","revisionId":"%s","include":{"excel":true,"log":true}}
                """.formatted(revision);
        var created = perform(post(bill + "/share-links").header("Idempotency-Key", key).content(body), cookie, 201);
        assertThat(perform(post(bill + "/share-links").header("Idempotency-Key", key).content(body), cookie, 201)).isEqualTo(created);
        assertThat(created.path("include").path("viewer").asBoolean()).isTrue();
        String url = created.path("url").asText();
        String token = url.substring(url.lastIndexOf('/') + 1);
        assertThat(database.queryForObject("SELECT response::text FROM idempotency_keys WHERE key = ?", String.class, key))
                .doesNotContain(token);
        String publicPath = "/api/v1/public/shares/" + token;
        http.perform(get(publicPath)).andExpect(status().isOk()).andExpect(jsonPath("$.revisionLabel").value("B"))
                .andExpect(jsonPath("$.modelVersionIds[0]").value(version)).andExpect(jsonPath("$.createdBy").doesNotExist());
        http.perform(get(publicPath + "/lines")).andExpect(status().isOk());
        var detail = http.perform(get(publicPath + "/lines/by-key").param("key", line)).andExpect(status().isOk())
                .andExpect(jsonPath("$.overridden").doesNotExist()).andExpect(jsonPath("$.reviewComments").doesNotExist());
        assertThat(detail.andReturn().getResponse().getContentAsString()).doesNotContain("Private estimator note");
        http.perform(get(publicPath + "/scene")).andExpect(status().isOk());
        http.perform(get(publicPath + "/geometry/" + version)).andExpect(status().isFound());
        http.perform(get(publicPath + "/geometry/018f4ed4-1575-7000-8000-000000000001")).andExpect(status().isNotFound());
        var download = http.perform(get(publicPath + "/export")).andExpect(status().isFound());
        byte[] bytes = NETWORK.send(HttpRequest.newBuilder(URI.create(download.andReturn().getResponse().getHeader("Location"))).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray()).body();
        try (var workbook = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(bytes))) {
            assertThat(workbook.getNextEntry()).isNotNull();
            do {
                assertThat(new String(workbook.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8))
                        .doesNotContain("Private estimator note", "Pilot freeze", "owner@example.test");
            } while (workbook.getNextEntry() != null);
        }
        String link = "/api/v1/share-links/" + id(created);
        perform(patch(link).content("{\"include\":{\"viewer\":false}}"), cookie, 200);
        http.perform(get(publicPath + "/scene")).andExpect(status().isNotFound());
        http.perform(get(publicPath + "/export")).andExpect(status().isFound());
        var listed = perform(get("/api/v1/orgs/" + org + "/share-links"), cookie, 200);
        assertThat(listed.get(0).path("views").asInt()).isEqualTo(1);
        assertThat(listed.toString()).doesNotContain(token);
        http.perform(auth(delete(link), cookie)).andExpect(status().isNoContent());
        http.perform(get(publicPath)).andExpect(status().isNotFound());
    }

    private void verifyLibrary(String org, String modelVersion, Cookie cookie) throws Exception {
        String library = "/api/v1/orgs/" + org + "/presets";
        JsonNode system = perform(get(library + "?kind=rule_set&layer=system"), cookie, 200);
        var asModelled = java.util.stream.StreamSupport.stream(system.spliterator(), false)
                .filter(item -> item.path("slug").asText().equals("as-modelled")).findFirst().orElseThrow();
        String parent = id(asModelled.path("latestPublishedVersion"));
        var preset = perform(post(library).content("""
                {"kind":"rule_set","name":"Studio rules","start":{"mode":"patch","fromVersionId":"%s"}}
                """.formatted(parent)), cookie, 201);
        String presetPath = "/api/v1/presets/" + id(preset);
        String draftId = id(preset.path("draft"));
        var draftResponse = http.perform(auth(get("/api/v1/preset-versions/" + draftId), cookie))
                .andExpect(status().isOk()).andExpect(jsonPath("$.flattened.items").isArray()).andReturn().getResponse();
        String tag = draftResponse.getHeader("ETag");
        var doc = (com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(draftResponse.getContentAsString()).path("doc");
        doc.withObject("params").putObject("wall_opening_threshold").put("value", 0.5);
        doc.withObject("params").putObject("wall_opening_mode").put("value", "over_threshold");
        String save = json.createObjectNode().set("doc", doc).toString();
        http.perform(auth(put(presetPath + "/draft").header("If-Match", tag).content(save), cookie))
                .andExpect(status().isOk()).andExpect(jsonPath("$.problems").isEmpty());
        http.perform(auth(put(presetPath + "/draft").header("If-Match", tag).content(save), cookie))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("draft_conflict"));

        String previewId = id(perform(post(presetPath + "/preview").content("""
                {"modelVersionIds":["%s"],"compareWithPublished":true}
                """.formatted(modelVersion)), cookie, 202));
        var preview = awaitJob(previewId, cookie).path("output");
        assertThat(preview.path("compare").path("versionId").asText()).isEqualTo(parent);
        String url = preview.path("previewResultUrl").asText();
        var report = NETWORK.send(HttpRequest.newBuilder(URI.create(url)).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertThat(report.statusCode()).isEqualTo(200);
        assertThat(json.readTree(report.body()).path("lines").size()).isGreaterThan(0);
        var redirect = http.perform(auth(get(presetPath + "/template.xlsx"), cookie)).andExpect(status().isFound())
                .andReturn().getResponse().getHeader("Location");
        byte[] template = NETWORK.send(HttpRequest.newBuilder(URI.create(redirect)).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray()).body();
        var upload = new MockMultipartFile("file", "rules.xlsx", "application/octet-stream", template);
        http.perform(auth(multipart(presetPath + "/template-import").file(upload), cookie)
                        .contentType(MediaType.MULTIPART_FORM_DATA))
                .andExpect(status().isOk()).andExpect(jsonPath("$.changes").isEmpty());
        var published = perform(post(presetPath + "/publish").content("{\"changeNote\":\"Pilot settings\"}"), cookie, 200);
        assertThat(published.path("status").asText()).isEqualTo("published");
        assertThat(published.path("number").asInt()).isEqualTo(1);
    }

    private JsonNode awaitJob(String job, Cookie cookie) throws Exception {
        long until = System.nanoTime() + Duration.ofSeconds(120).toNanos();
        while (System.nanoTime() < until) {
            var state = perform(get("/api/v1/jobs/" + job), cookie, 200);
            String status = state.path("status").asText();
            if ("succeeded".equals(status)) return state;
            if ("failed".equals(status) || "cancelled".equals(status)) throw new AssertionError(state.toPrettyString());
            Thread.sleep(250);
        }
        throw new AssertionError("Job did not finish.");
    }

    private JsonNode perform(MockHttpServletRequestBuilder request, Cookie cookie, int code) throws Exception {
        return json.readTree(http.perform(auth(request, cookie)).andExpect(status().is(code))
                .andReturn().getResponse().getContentAsString());
    }

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request, Cookie cookie) {
        return request.header(HttpHeaders.AUTHORIZATION, "Bearer owner").cookie(cookie).contentType(MediaType.APPLICATION_JSON);
    }

    private static String id(JsonNode node) {
        return node.path("id").asText();
    }
}
