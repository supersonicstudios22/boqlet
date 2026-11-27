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

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "spring.threads.virtual.enabled=false")
@DirtiesContext
@AutoConfigureMockMvc
@Testcontainers
@Import({ApiFoundationTest.Tokens.class, com.boqlet.suite.SuiteSupport.class, QueryCounter.class})
@EnabledIfEnvironmentVariable(named = "BOQLET_NATIVE_WORKER_PYTHON", matches = ".+")
class NativeWorkerTest {
    private static final String BUCKET = "boqlet-native-test";
    private static final String ACCESS = "boqlet-test";
    private static final String SECRET = "boqlet-local-test-only";
    private static final int S3_PORT = 8333;
    private static final Path ROOT = Path.of("../..").toAbsolutePath().normalize();
    private static Process worker;
    /** How the HTTP worker was started, to start it again after a test stops it (TF-186). */
    private static ProcessBuilder workerStart;
    private static final java.util.List<Process> queueWorkers = new java.util.ArrayList<>();
    private static final boolean POSTGRES_QUEUE = "1".equals(System.getenv("BOQLET_NATIVE_QUEUE_TEST"));
    private static final HttpClient NETWORK = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    /**
     * Review B-08 (DEC-07): how much slower than a quiet machine this run may be. Every wait of this class
     * and of the suites it starts (which read the same variable: tests/support/time-factor.mjs) is
     * multiplied by `BOQLET_TEST_TIME_FACTOR`, a number from 1 to 10 (1 when unset).
     */
    static final double TIME_FACTOR = timeFactor();

    static double timeFactor() {
        String raw = System.getenv("BOQLET_TEST_TIME_FACTOR");
        if (raw == null || raw.isBlank()) return 1;
        double factor = Double.parseDouble(raw.trim());
        if (!(factor >= 1 && factor <= 10)) throw new IllegalArgumentException("BOQLET_TEST_TIME_FACTOR must be from 1 to 10, not " + raw);
        return factor;
    }

    static Duration scaled(Duration wait) {
        return Duration.ofMillis(Math.round(wait.toMillis() * TIME_FACTOR));
    }

    /**
     * The browser suite's overall limit: the server's start and first compiles, then a budget per spec
     * file, so a new spec raises it (review B-08), scaled like every wait.
     */
    static Duration browserSmokeLimit(Path specs) throws IOException {
        long files;
        try (var list = java.nio.file.Files.list(specs)) {
            files = list.filter(file -> file.getFileName().toString().endsWith(".spec.ts")).count();
        }
        return scaled(Duration.ofMinutes(5).plus(Duration.ofMinutes(2).multipliedBy(files)));
    }

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Container
    static final GenericContainer<?> S3 = new GenericContainer<>(DockerImageName.parse("chrislusf/seaweedfs:4.53"))
            .withEnv("AWS_ACCESS_KEY_ID", ACCESS).withEnv("AWS_SECRET_ACCESS_KEY", SECRET)
            .withEnv("S3_BUCKET", BUCKET).withExposedPorts(S3_PORT)
            .waitingFor(Wait.forHttp("/").forPort(S3_PORT).forStatusCode(403));

    @Container
    static final GenericContainer<?> MAIL = new GenericContainer<>(DockerImageName.parse("mailhog/mailhog:v1.0.1"))
            .withExposedPorts(1025, 8025).waitingFor(Wait.forHttp("/api/v2/messages").forPort(8025));

    @DynamicPropertySource
    static void services(DynamicPropertyRegistry properties) throws IOException {
        String endpoint = "http://" + S3.getHost() + ":" + S3.getMappedPort(S3_PORT);
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
        start.environment().put("BOQLET_WORKER_TOKEN", WORKER_TOKEN);   // the worker refuses calls without it (review A-36)
        workerStart = start;
        worker = start.start();
        try {
            com.boqlet.suite.SuiteSupport.installClock(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        } catch (java.sql.SQLException failed) {
            throw new IOException(failed);
        }
        SETTINGS.put("spring.datasource.url", POSTGRES.getJdbcUrl());
        SETTINGS.put("spring.datasource.username", POSTGRES.getUsername());
        SETTINGS.put("spring.datasource.password", POSTGRES.getPassword());
        SETTINGS.put("spring.datasource.hikari.connection-init-sql", "SET search_path = " + com.boqlet.suite.SuiteSupport.SEARCH_PATH);
        SETTINGS.put("boqlet.auth.pilot-emails", "owner@example.test,platform@example.test");
        SETTINGS.put("boqlet.auth.invitation-secret", "local-test-signing-secret-2026-only");
        SETTINGS.put("spring.mail.host", MAIL.getHost());
        SETTINGS.put("spring.mail.port", MAIL.getMappedPort(1025));
        SETTINGS.put("spring.mail.properties[mail.smtp.auth]", false);
        SETTINGS.put("spring.mail.properties[mail.smtp.starttls.enable]", false);
        SETTINGS.put("spring.mail.properties[mail.smtp.starttls.required]", false);
        SETTINGS.put("BOQLET_SMTP_FROM", "boqlet@example.test");
        SETTINGS.put("BOQLET_SMTP_POLL_MS", 250);
        SETTINGS.put("boqlet.storage.bucket", BUCKET);
        SETTINGS.put("boqlet.storage.region", "us-east-1");
        SETTINGS.put("boqlet.storage.endpoint", endpoint);
        SETTINGS.put("boqlet.worker.url", url);
        SETTINGS.put("boqlet.worker.token", WORKER_TOKEN);
        workerUrl = url;
        if (POSTGRES_QUEUE) {
            SETTINGS.put("BOQLET_ENGINE_TRANSPORT", "postgres");
            SETTINGS.put("BOQLET_ENGINE_MODEL_POOL", "ifc");
        }
        SETTINGS.forEach((name, value) -> properties.add(name, () -> value));
    }

    private static final String WORKER_TOKEN = "native-worker-test-token-" + java.util.UUID.randomUUID();
    private static String workerUrl;

    /** The API's configuration in this test, for a second instance on the same database. */
    private static final java.util.Map<String, Object> SETTINGS = new java.util.LinkedHashMap<>();

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
    @Autowired com.boqlet.api.boq.RunIndex runIndex;
    @Autowired com.boqlet.api.boq.BoqReadService readService;
    @LocalServerPort int apiPort;

    /** Review A-36: the worker answers a job or rpc call without the API's token with 401; with it, the call goes through. */
    @Test
    void workerRefusesCallsWithoutTheToken() throws Exception {
        // The resilience test stops and restarts the worker; wait until it answers again (its /health needs no token).
        var health = java.net.http.HttpRequest.newBuilder(java.net.URI.create(workerUrl + "/health")).GET().build();
        for (long deadline = System.nanoTime() + scaled(Duration.ofSeconds(90)).toNanos(); ; Thread.sleep(500)) {
            try {
                if (NETWORK.send(health, java.net.http.HttpResponse.BodyHandlers.discarding()).statusCode() == 200) break;
            } catch (java.io.IOException notYet) {
                // not listening yet
            }
            if (System.nanoTime() > deadline) throw new AssertionError("The worker did not answer /health within 90 s.");
        }
        for (String path : java.util.List.of("/rpc/check", "/jobs/parse")) {
            var bare = java.net.http.HttpRequest.newBuilder(java.net.URI.create(workerUrl + path)).header("Content-Type", "application/json")
                    .POST(java.net.http.HttpRequest.BodyPublishers.ofString("{}"));
            assertThat(NETWORK.send(bare.build(), java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(401);
            assertThat(NETWORK.send(bare.header("Authorization", "Bearer wrong").build(),
                    java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(401);
        }
        var signed = java.net.http.HttpRequest.newBuilder(java.net.URI.create(workerUrl + "/rpc/check"))
                .header("Content-Type", "application/json").header("Authorization", "Bearer " + WORKER_TOKEN)
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString("{\"kind\":\"dictionaries\",\"doc\":{}}")).build();
        assertThat(NETWORK.send(signed, java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(200);
    }

    @Test
    void duplexUploadRunsWorkerAndServesModelArtifacts() throws Exception {
        if (POSTGRES_QUEUE) startQueueWorkers();
        Cookie cookie = http.perform(post("/api/v1/sessions").header(HttpHeaders.AUTHORIZATION, "Bearer owner")
                .contentType(MediaType.APPLICATION_JSON).content("{\"deviceLabel\":\"Native worker test\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getCookie("boqlet_session");
        roomForAnotherOrg();
        String org = id(perform(post("/api/v1/orgs").content("{\"name\":\"Native\",\"slug\":\"native-worker\"}"), cookie, 201));
        // Free has one seat (P57): room for the invitation, as a platform admin's override.
        database.update("UPDATE subscriptions SET overrides = overrides || '{\"seats\":5}' WHERE org_id = ?::uuid", org);
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
        verifyLargeRunPages(project, cookie);
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

    /**
     * TF-179 (nfr.md "Lines page (500 lines) p95 ≤ 500 ms", F06 §1 runs up to 20,000 lines): a page of a
     * 20,500-line run costs about what a page of a small run costs; it used to read and number every line
     * of the run and every line skipped by the offset. A copy of the project's run, its lines copied 500 times.
     */
    private void verifyLargeRunPages(String project, Cookie cookie) throws Exception {
        String source = id(perform(get("/api/v1/projects/" + project + "/boqs"), cookie, 200).get(0).path("currentRevision").path("currentRun"));
        var big = java.util.UUID.randomUUID();
        database.update("""
                INSERT INTO runs SELECT (jsonb_populate_record(NULL::runs, to_jsonb(r) || jsonb_build_object('id', ?::text))).*
                FROM runs r WHERE r.id = ?::uuid
                """, big.toString(), source);
        int lines = database.queryForObject("SELECT count(*) FROM run_lines WHERE run_id = ?::uuid", Integer.class, source);
        database.update("""
                INSERT INTO run_lines (run_id, sort_index, line_key, line, view)
                SELECT ?, k * ? + l.sort_index, l.line_key || '~c' || k, jsonb_set(l.line, '{key}', to_jsonb(l.line_key || '~c' || k)),
                    '{"key":' || to_jsonb(l.line_key || '~c' || k)::text || substr(l.view, length('{"key":' || to_jsonb(l.line_key)::text) + 1)
                FROM run_lines l CROSS JOIN generate_series(0, 499) k WHERE l.run_id = ?::uuid
                """, big, lines, source);
        // The views were written when the run was indexed (TF-179), each starting with its key.
        assertThat(database.queryForObject("SELECT count(*) FROM run_lines WHERE run_id = ? AND view IS NULL", Integer.class, big)).isZero();
        String path = "/api/v1/runs/" + big + "/lines";
        var all = perform(get(path + "?limit=20000"), cookie, 200);
        assertThat(all.path("total").asInt()).isEqualTo(lines * 500);
        var tail = perform(get(path + "?limit=500&cursor=" + (lines * 500 - 500)), cookie, 200).path("items");
        var end = perform(get(path + "?limit=20000&cursor=20000"), cookie, 200).path("items");
        assertThat(tail.size()).isEqualTo(500);
        // The same lines, numbers and order as reading the whole run.
        for (int i = 0; i < 500; i++) {
            var expected = end.get(end.size() - 500 + i);
            assertThat(tail.get(i).path("key").asText()).isEqualTo(expected.path("key").asText());
            assertThat(tail.get(i).path("positionNo").asText()).isEqualTo(expected.path("positionNo").asText()).isNotBlank();
        }
        assertThat(all.path("items").get(0).path("positionNo").asText()).isNotBlank();
        // What a page costs beyond its own lines must not grow with the run: numbering every line and reading
        // the lines skipped by the offset made a one-line page at line 20,000 take about 0.7 s.
        var small = new java.util.ArrayList<Long>();
        var page = new java.util.ArrayList<Long>();
        for (int i = 0; i < 7; i++) {
            long started = System.nanoTime();
            perform(get(path + "?limit=1&cursor=20000"), cookie, 200);
            small.add((System.nanoTime() - started) / 1_000_000);
            started = System.nanoTime();
            // The response as the client gets it, not parsed here: the server's own work.
            http.perform(auth(get(path + "?limit=500&cursor=" + (i % 2 == 0 ? 20_000 : 0)), cookie)).andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsByteArray();
            page.add((System.nanoTime() - started) / 1_000_000);
        }
        java.util.Collections.sort(small);
        java.util.Collections.sort(page);
        System.out.println("[perf] 20,500-line run, ms sorted: 1-line page at 20,000 " + small + "; 500-line pages " + page);
        assertThat(small.get(3)).as("median ms of a 1-line page at line 20,000 of a 20,500-line run").isLessThanOrEqualTo(150);
        // A 500-line page is sent from the stored views (above: none is missing, and a page is byte for byte the
        // page written from the lines). Its time is printed, not asserted: in this harness it is mostly MockMvc's.
    }

    /** The shared contract suite (`tests/contract`) against this API. */
    private void verifySharedContract() throws Exception {
        if (node() == null) return;
        runSharedSuite("contract", null, scaled(Duration.ofSeconds(90)));
    }

    /**
     * The shared scenario suite (`tests/scenarios`) against this API (FE-041). Runs with `BOQLET_NATIVE_SCENARIOS=1` and Node (CI sets both; it
     * takes minutes, so local runs opt in). `BOQLET_SCENARIO_FILTER` runs some files
     * (`orgs,isolation`) while working on them.
     */
    @Test
    @EnabledIfEnvironmentVariable(named = "BOQLET_NATIVE_SCENARIOS", matches = "1")
    void sharedScenariosPassAgainstJava() throws Exception {
        assertThat(node()).as("BOQLET_NATIVE_NODE").isNotNull();
        if (POSTGRES_QUEUE) startQueueWorkers();
        runSharedSuite("scenarios", System.getenv("BOQLET_SCENARIO_FILTER"), scaled(Duration.ofMinutes(25)));
    }

    /**
     * TS-002 (nfr.md "API and UI") against this API: the shared perf suite (`tests/perf/api.test.ts`:
     * CRUD p95 ≤ 300 ms, a 500-line page p95 ≤ 500 ms), then run ingestion of 50,000 lines ≤ 10 s:
     * the perf suite's run is indexed again from a result made of its own lines repeated to 50,000.
     * Opt-in with `BOQLET_API_PERF=1` and Node; measured on the local native stack (P51), not in CI.
     * `PERF_OUT=<file>` collects the numbers as JSON lines.
     */
    @Test
    @EnabledIfEnvironmentVariable(named = "BOQLET_API_PERF", matches = "1")
    void apiPerformanceAgainstJava() throws Exception {
        assertThat(node()).as("BOQLET_NATIVE_NODE").isNotNull();
        if (POSTGRES_QUEUE) startQueueWorkers();
        runSharedSuite("perf", null, scaled(Duration.ofMinutes(20)));

        var latest = database.queryForMap("SELECT id, result_key FROM runs WHERE result_key IS NOT NULL ORDER BY created_at DESC LIMIT 1");
        var run = (java.util.UUID) latest.get("id");
        JsonNode result;
        try (var raw = storage.open((String) latest.get("result_key")); var decoded = new java.util.zip.GZIPInputStream(raw)) {
            result = json.readTree(decoded);
        }
        var source = result.path("lines");
        var lines = json.createArrayNode();
        for (int i = 0; lines.size() < 50_000; i++) {
            var line = ((com.fasterxml.jackson.databind.node.ObjectNode) source.get(i % source.size()).deepCopy());
            line.put("key", line.path("key").asText() + "#" + i);
            lines.add(line);
        }
        ((com.fasterxml.jackson.databind.node.ObjectNode) result).set("lines", lines);
        var bytes = new java.io.ByteArrayOutputStream();
        try (var gzip = new java.util.zip.GZIPOutputStream(bytes)) {
            json.writeValue(gzip, result);
        }
        String key = latest.get("result_key") + ".perf-50k";
        storage.put(key, "application/gzip", bytes.toByteArray());
        for (String table : java.util.List.of("run_lines", "run_line_elements", "run_questions", "run_warnings", "run_log_entries"))
            database.update("DELETE FROM " + table + " WHERE run_id = ?", run);
        database.update("UPDATE runs SET result_key = ?, indexed_at = NULL WHERE id = ?", key, run);

        long start = System.nanoTime();
        runIndex.ensure(run);
        long ms = (System.nanoTime() - start) / 1_000_000;
        System.out.println("[perf] run ingestion, 50,000 lines: " + ms + " ms (target 10000 ms)");
        String out = System.getenv("PERF_OUT");
        if (out != null && !out.isBlank())
            java.nio.file.Files.writeString(Path.of(out), "{\"name\":\"run ingestion (50,000 lines)\",\"ms\":" + ms + ",\"target\":10000,\"against\":\"java\"}\n",
                    java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
        assertThat(database.queryForObject("SELECT count(*) FROM run_lines WHERE run_id = ?", Integer.class, run)).isEqualTo(50_000);
        assertThat(ms).as("run ingestion of 50,000 lines (ms)").isLessThanOrEqualTo(10_000);
    }

    /**
     * M6: live updates reach a client of another API instance. A second instance runs on the same
     * database; a person's browser listens there, and another browser's takeover through this instance
     * revokes its session: the stream on the second instance gets `session.revoked`.
     */
    @Test
    void realtimeReachesClientsOfAnotherApiInstance() throws Exception {
        String email = "two-instances@example.test";
        String person = com.boqlet.suite.SuiteSupport.TOKEN_PREFIX + java.util.Base64.getUrlEncoder().withoutPadding()
                .encodeToString(email.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        database.update("INSERT INTO users (id, auth_subject, email, name) VALUES (?, ?, ?, ?)", Ids.newId(), person, email, "Two Instances");
        Cookie first = http.perform(post("/api/v1/sessions").header(HttpHeaders.AUTHORIZATION, "Bearer " + person + ".first")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"deviceLabel\":\"First browser\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getCookie("boqlet_session");
        // As arguments: they take precedence over application.yml, as the test's dynamic properties do.
        var arguments = new java.util.ArrayList<String>(java.util.List.of("--server.port=0", "--spring.threads.virtual.enabled=false"));
        SETTINGS.forEach((name, value) -> arguments.add("--" + name + "=" + value));
        try (var second = new org.springframework.boot.builder.SpringApplicationBuilder(BoqletApplication.class, ApiFoundationTest.Tokens.class)
                .run(arguments.toArray(String[]::new))) {
            String port = second.getEnvironment().getProperty("local.server.port");
            var stream = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/events"))
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + person + ".first")
                    .header(HttpHeaders.COOKIE, first.getName() + "=" + first.getValue())
                    .header(HttpHeaders.ACCEPT, "text/event-stream").timeout(Duration.ofSeconds(30)).GET().build();
            var response = NETWORK.send(stream, HttpResponse.BodyHandlers.ofInputStream());
            assertThat(response.statusCode()).isEqualTo(200);
            try (var data = response.body(); var pool = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
                var revoked = pool.submit(() -> {
                    var reader = new java.io.BufferedReader(new java.io.InputStreamReader(data, java.nio.charset.StandardCharsets.UTF_8));
                    for (String line; (line = reader.readLine()) != null;) {
                        if (line.replace(" ", "").equals("event:session.revoked")) return true;
                    }
                    return false;
                });
                Thread.sleep(500);
                http.perform(post("/api/v1/sessions").header(HttpHeaders.AUTHORIZATION, "Bearer " + person + ".second")
                                .contentType(MediaType.APPLICATION_JSON).content("{\"deviceLabel\":\"Second browser\",\"takeover\":true}"))
                        .andExpect(status().isCreated());
                try {
                    assertThat(revoked.get(15, java.util.concurrent.TimeUnit.SECONDS)).as("session.revoked on the other instance").isTrue();
                } finally {
                    revoked.cancel(true);
                }
            }
        }
    }

    /**
     * The browser smoke suite against Java (FE-041/FE-043, `apps/app/e2e-java`): the app, built with
     * the native adapter, on a second API instance with native sign-in (P50), as the pilot runs. It
     * covers sign-in with a password and its cookie, takeover, live updates,
     * direct uploads to object storage (with the pilot's bucket CORS) and the main flow. Opt-in with
     * `BOQLET_BROWSER_SMOKE=1` and Node; Playwright's Chromium must be installed for `apps/app`.
     */
    @Test
    @EnabledIfEnvironmentVariable(named = "BOQLET_BROWSER_SMOKE", matches = "1")
    void browserSmokeAgainstJava() throws Exception {
        assertThat(node()).as("BOQLET_NATIVE_NODE").isNotNull();
        if (POSTGRES_QUEUE) startQueueWorkers();
        String app = "http://localhost:3100";
        allowBrowserUploads(app);
        var arguments = new java.util.ArrayList<String>(java.util.List.of("--server.port=0", "--spring.threads.virtual.enabled=false"));
        SETTINGS.forEach((name, value) -> arguments.add("--" + name + "=" + value));
        arguments.addAll(java.util.List.of("--BOQLET_NATIVE_AUTH=true", "--BOQLET_APP_URL=" + app, "--boqlet.auth.secure-cookie=false"));
        try (var nativeApi = new org.springframework.boot.builder.SpringApplicationBuilder(BoqletApplication.class,
                com.boqlet.suite.SuiteSupport.class).run(arguments.toArray(String[]::new))) {
            String api = "http://localhost:" + nativeApi.getEnvironment().getProperty("local.server.port");
            Path appDir = ROOT.resolve("apps/app");
            Path cli = java.util.stream.Stream.of(appDir, ROOT).map(dir -> dir.resolve("node_modules/@playwright/test/cli.js"))
                    .filter(java.nio.file.Files::exists).findFirst().orElseThrow();
            Path log = Path.of("target/browser-smoke.log").toAbsolutePath();
            var command = new java.util.ArrayList<>(java.util.List.of(node(), cli.toString(), "test", "-c", "playwright.java.config.ts"));
            String filter = System.getenv("BOQLET_BROWSER_SMOKE_FILTER");
            if (filter != null && !filter.isBlank()) command.addAll(java.util.List.of("-g", filter));
            var script = new ProcessBuilder(command).directory(appDir.toFile()).redirectErrorStream(true).redirectOutput(log.toFile());
            script.environment().put("BOQLET_JAVA_API", api);
            script.environment().put("BOQLET_JAVA_APP", app);
            script.environment().put("BOQLET_SUITE_MAILHOG", "http://" + MAIL.getHost() + ":" + MAIL.getMappedPort(8025));
            script.environment().put("BOQLET_NODE", node());
            Duration limit = browserSmokeLimit(appDir.resolve("e2e-java"));
            Process test = script.start();
            try {
                assertThat(test.waitFor(limit.toSeconds(), java.util.concurrent.TimeUnit.SECONDS)).as("browser smoke timed out after %s", limit).isTrue();
                assertThat(test.exitValue()).as("browser smoke result %s", java.nio.file.Files.readString(log)).isZero();
            } finally {
                if (test.isAlive()) test.descendants().forEach(ProcessHandle::destroyForcibly);
                if (test.isAlive()) test.destroyForcibly();
            }
        }
    }

    /** The bucket's CORS for the app's origin, as the pilot sets it (`ops/pilot/configure-storage.py`). */
    private static void allowBrowserUploads(String origin) {
        var credentials = software.amazon.awssdk.auth.credentials.StaticCredentialsProvider.create(
                software.amazon.awssdk.auth.credentials.AwsBasicCredentials.create(ACCESS, SECRET));
        try (var s3 = software.amazon.awssdk.services.s3.S3Client.builder().region(software.amazon.awssdk.regions.Region.US_EAST_1)
                .credentialsProvider(credentials).forcePathStyle(true)
                .endpointOverride(URI.create("http://" + S3.getHost() + ":" + S3.getMappedPort(S3_PORT))).build()) {
            var rule = software.amazon.awssdk.services.s3.model.CORSRule.builder().allowedMethods("GET", "PUT")
                    .allowedOrigins(origin).allowedHeaders("Content-Type", "x-amz-*").exposeHeaders("ETag", "Content-Length")
                    .maxAgeSeconds(600).build();
            s3.putBucketCors(cors -> cors.bucket(BUCKET).corsConfiguration(c -> c.corsRules(rule)));
        }
    }

    private static String node() {
        String node = System.getenv("BOQLET_NATIVE_NODE");
        return node == null || node.isBlank() ? null : node;
    }

    private void runSharedSuite(String suite, String filter, Duration timeout) throws Exception {
        String users = suiteUsers();
        Path log = Path.of("target/shared-java-" + suite + ".log").toAbsolutePath();
        var command = new java.util.ArrayList<>(java.util.List.of(node(), "run.mjs", suite));
        if (filter != null && !filter.isBlank()) command.add(filter);
        var script = new ProcessBuilder(command).directory(ROOT.resolve("tests").toFile())
                .redirectErrorStream(true).redirectOutput(log.toFile());
        script.environment().put("API_URL", "http://localhost:" + apiPort + "/api/v1");
        script.environment().put("SUITE_TARGET", "java");
        script.environment().put("BOQLET_JAVA_SUITE_USERS", users);
        script.environment().put("BOQLET_SUITE_MAILHOG", "http://" + MAIL.getHost() + ":" + MAIL.getMappedPort(8025));
        Process test = script.start();
        try {
            assertThat(test.waitFor(timeout.toSeconds(), java.util.concurrent.TimeUnit.SECONDS))
                    .as("shared %s suite timed out", suite).isTrue();
            assertThat(test.exitValue()).as("shared %s result %s", suite, java.nio.file.Files.readString(log)).isZero();
        } finally {
            if (test.isAlive()) test.destroyForcibly();
        }
    }

    private static String suiteUsersJson;

    /**
     * The seeded people of the shared suites (`tests/support/users.ts`): six users with an open
     * session each, Studio Demo (team plan) and Small Firm (free). Made once per test context.
     */
    private synchronized String suiteUsers() throws Exception {
        if (suiteUsersJson != null) return suiteUsersJson;
        var fixtures = new java.util.LinkedHashMap<String, java.util.UUID>();
        var users = json.createArrayNode();
        for (String key : java.util.List.of("olivia", "ivana", "marko", "ana", "victor", "pat")) {
            var id = Ids.newId();
            String token = "suite-" + key;
            String email = key + "@example.com";
            database.update("INSERT INTO users (id, auth_subject, email, name, platform_role) VALUES (?, ?, ?, ?, ?)",
                    id, token, email, key, key.equals("pat") ? "admin" : null);
            Cookie session = http.perform(post("/api/v1/sessions").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON).content("{\"deviceLabel\":\"Shared suites\"}"))
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
        suiteUsersJson = users.toString();
        return suiteUsersJson;
    }

    /**
     * The harness's "owner" makes several orgs over the class's tests; Free allows one owned org per
     * person (P57), so its earlier Free orgs move to Team first, as a platform admin would.
     */
    private void roomForAnotherOrg() {
        database.update("""
                UPDATE subscriptions SET plan_id = 'team' WHERE plan_id = 'free' AND org_id IN (
                    SELECT m.org_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.auth_subject = 'owner' AND m.role = 'owner')
                """);
    }

    private void verifyOrgPurge(Cookie cookie) throws Exception {
        roomForAnotherOrg();
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

    private static boolean queueRole;

    private synchronized void startQueueWorkers() throws Exception {
        if (!queueWorkers.isEmpty()) return;
        if (queueRole) {
            launchQueueWorkers();
            return;
        }
        queueRole = true;
        database.execute("CREATE ROLE boqlet_queue_test LOGIN PASSWORD 'local-queue-test-only'");
        database.execute("GRANT EXECUTE ON FUNCTION queue_claim(uuid,text,text[]) TO boqlet_queue_test");
        database.execute("GRANT EXECUTE ON FUNCTION queue_renew(uuid,uuid,integer,jsonb) TO boqlet_queue_test");
        database.execute("GRANT EXECUTE ON FUNCTION queue_finish(uuid,uuid,integer,jsonb) TO boqlet_queue_test");
        try (var worker = java.sql.DriverManager.getConnection(POSTGRES.getJdbcUrl(), "boqlet_queue_test", "local-queue-test-only");
             var statement = worker.createStatement()) {
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> statement.execute("SELECT id FROM orgs"))
                    .isInstanceOf(java.sql.SQLException.class).hasMessageContaining("permission denied");
        }
        launchQueueWorkers();
    }

    private void launchQueueWorkers() throws Exception {
        var dsn = "postgresql://boqlet_queue_test:local-queue-test-only@" + POSTGRES.getHost() + ":"
                + POSTGRES.getMappedPort(5432) + "/" + POSTGRES.getDatabaseName();
        var endpoint = "http://" + S3.getHost() + ":" + S3.getMappedPort(S3_PORT);
        for (String pool : java.util.List.of("ifc", "default")) {
            var start = new ProcessBuilder(System.getenv("BOQLET_NATIVE_WORKER_PYTHON"), "-m", "ifc_boq.worker_queue", "--pool", pool,
                    "--concurrency", pool.equals("ifc") ? "2" : "1", "--poll-seconds", "0.2")
                    .directory(ROOT.resolve("engine").toFile()).redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.appendTo(Path.of("target/queue-worker-" + pool + ".log").toFile()));
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
                    // P54 (Q62, TF-036): the sample's parse and run still write usage events, with zero minutes.
                    var events = database.queryForList("SELECT kind, duration_ms FROM usage_events WHERE project_id = ? ORDER BY kind",
                            java.util.UUID.fromString(project));
                    assertThat(events).extracting(e -> e.get("kind")).containsExactly("parse", "run");
                    assertThat(events).extracting(e -> ((Number) e.get("duration_ms")).longValue()).containsOnly(0L);
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
        // TF-179: a page sent from the stored views is byte for byte the page written from the lines.
        var owner = database.queryForObject("SELECT id FROM users WHERE auth_subject = 'owner'", java.util.UUID.class);
        // With include=trace (the list's default trace is a summary since review B-18).
        String sent = http.perform(auth(get(runPath + "/lines?limit=40&include=trace&groupBy=" + perform(get(runPath), cookie, 200)
                .path("classifications").path(0).path("id").asText()), cookie)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String written = json.writeValueAsString(readService.lines(java.util.UUID.fromString(run), owner, null, 40,
                perform(get(runPath), cookie, 200).path("classifications").path(0).path("id").asText()));
        assertThat(sent).isEqualTo(written).contains("\"positionNo\"");
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
        // TF-049: the workbook gets the sheet's line order (sort_index), not only the engine's.
        assertThat(database.queryForList("""
                SELECT k.value FROM jobs j JOIN exports e ON e.job_id = j.id,
                    jsonb_array_elements_text(j.input->'meta'->'lineOrder') WITH ORDINALITY k(value, n)
                WHERE e.id = ?::uuid ORDER BY k.n
                """, String.class, saved.path("frozen").path("exportIds").get(0).asText()))
                .isEqualTo(database.queryForList("SELECT line_key FROM run_lines WHERE run_id = ?::uuid ORDER BY sort_index",
                        String.class, run)).isNotEmpty();
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
        // P54 Q49 (TF-057): a saved version's frozen Excel whose job failed every attempt is built again from the stored
        // run when it is asked for (here the run is only version A's: the working version B has its own); the version
        // then points at the new export, and that one is written.
        String frozenExport = saved.path("frozen").path("exportIds").get(0).asText();
        String frozenJob = database.queryForObject("SELECT job_id::text FROM exports WHERE id = ?::uuid", String.class, frozenExport);
        awaitJob(frozenJob, cookie);
        assertThat(id(perform(post(runPath + "/exports").content("{}"), cookie, 202))).isEqualTo(frozenJob);
        database.update("UPDATE jobs SET status = 'failed' WHERE id = ?::uuid", frozenJob);
        String rebuiltJob = id(perform(post(runPath + "/exports").content("{}"), cookie, 202));
        assertThat(rebuiltJob).isNotEqualTo(frozenJob);
        String rebuilt = awaitJob(rebuiltJob, cookie).path("output").path("exportId").asText();
        assertThat(rebuilt).isNotEqualTo(frozenExport);
        assertThat(database.queryForObject("SELECT frozen->'exportIds'->>0 FROM boq_revisions WHERE id = ?::uuid", String.class, first))
                .isEqualTo(rebuilt);
        assertThat(database.queryForObject("SELECT storage_key FROM exports WHERE id = ?::uuid", String.class, rebuilt)).isNotBlank();
        http.perform(auth(get("/api/v1/exports/" + rebuilt + "/download"), cookie)).andExpect(status().isFound());
        // Asked again, the version answers the rebuilt file's job, as for any saved version (BR-25).
        assertThat(id(perform(post(runPath + "/exports").content("{}"), cookie, 202))).isEqualTo(rebuiltJob);
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
        verifyListQueries(project, cookie);
    }

    /**
     * Review B-20: listing a project's BoQs costs the same number of queries for 3 BoQs as for 10 (no query per BoQ),
     * and every listed BoQ is exactly its own view.
     */
    private void verifyListQueries(String project, Cookie cookie) throws Exception {
        String boqs = "/api/v1/projects/" + project + "/boqs";
        int made = 0;
        while (perform(get(boqs), cookie, 200).size() < 3) perform(post(boqs).content("{\"name\":\"Listed " + made++ + "\"}"), cookie, 201);
        int few = listQueries(boqs, cookie);
        for (int i = 0; i < 7; i++) perform(post(boqs).content("{\"name\":\"Listed more " + i + "\"}"), cookie, 201);
        int many = listQueries(boqs, cookie);
        System.out.println("[b-20] statements to list 3 BoQs: " + few + ", 10 BoQs: " + many);
        assertThat(many).as("queries for 10 BoQs against 3").isEqualTo(few);
        var listed = perform(get(boqs), cookie, 200);
        assertThat(listed.size()).isGreaterThanOrEqualTo(10);
        for (var boq : listed) assertThat(perform(get("/api/v1/boqs/" + id(boq)), cookie, 200)).isEqualTo(boq);
        var bill = listed.get(0);
        var versions = "/api/v1/boqs/" + id(bill) + "/revisions";
        for (var revision : perform(get(versions), cookie, 200)) {
            assertThat(perform(get("/api/v1/revisions/" + id(revision)), cookie, 200)).isEqualTo(revision);
        }
    }

    private int listQueries(String path, Cookie cookie) {
        return QueryCounter.count(() -> {
            try {
                return http.perform(auth(get(path), cookie)).andExpect(status().isOk()).andReturn();
            } catch (Exception failure) {
                throw new IllegalStateException(failure);
            }
        }).statements();
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

    /**
     * TF-009 (F14-AC4, BR-62): the month's processing minutes are the time of the jobs that ran: a parse, a run
     * and a preview of one org, each against its start and end.
     */
    @Test
    void usageMinutesAreTheTimeOfTheJobsThatRan() throws Exception {
        if (POSTGRES_QUEUE) startQueueWorkers();
        Cookie cookie = person("usage-minutes@example.test");
        String org = id(perform(post("/api/v1/orgs").content("{\"name\":\"Usage\",\"slug\":\"usage-minutes\"}"), cookie, 201));
        String project = id(perform(post("/api/v1/orgs/" + org + "/projects").content("{\"name\":\"Usage\"}"), cookie, 201));
        String model = id(perform(post("/api/v1/projects/" + project + "/models")
                .content("{\"name\":\"Architecture\",\"discipline\":\"architecture\"}"), cookie, 201));
        var jobs = new java.util.ArrayList<String>();
        String parse = startParse(cookie, model, variant(11));
        awaitJob(parse, cookie);
        jobs.add(parse);
        var boq = perform(post("/api/v1/projects/" + project + "/boqs").content("{\"name\":\"Usage\"}"), cookie, 201);
        String run = perform(post("/api/v1/revisions/" + boq.path("currentRevision").path("id").asText() + "/runs"), cookie, 202)
                .path("job").path("id").asText();
        awaitJob(run, cookie);
        jobs.add(run);
        String rules = id(perform(get("/api/v1/orgs/" + org + "/presets?kind=rule_set&layer=system"), cookie, 200).get(0));
        String version = perform(get("/api/v1/models/" + model + "/versions"), cookie, 200).get(0).path("id").asText();
        String preview = id(perform(post("/api/v1/presets/" + rules + "/preview").content("{\"modelVersionIds\":[\"" + version + "\"]}"),
                cookie, 202));
        awaitJob(preview, cookie);
        jobs.add(preview);
        long ran = 0;
        for (String job : jobs) {
            var state = perform(get("/api/v1/jobs/" + job), cookie, 200);
            ran += Duration.between(java.time.OffsetDateTime.parse(state.path("startedAt").asText()),
                    java.time.OffsetDateTime.parse(state.path("finishedAt").asText())).toMillis();
        }
        var usage = perform(get("/api/v1/orgs/" + org + "/usage"), cookie, 200);
        double minutes = usage.path("processingMinutes").asDouble();
        // The engine's own durations (what is metered) sit inside each job's start and end: over HTTP allow a second
        // of transport and ingestion per job and the 0.01-minute rounding. The queue worker also starts a process
        // per job before its clock runs (a fork on Linux, a spawn with imports on Windows): only the upper bound.
        double floor = POSTGRES_QUEUE ? 1 : ran - 1_000.0 * jobs.size() - 600;
        assertThat(minutes * 60_000).isBetween(floor, ran + 600.0);
        assertThat(usage.path("byKind").path("parse").isMissingNode()).isFalse();
    }

    /**
     * TF-186 (nfr.md "Availability and recovery") and TF-184: a job survives its worker going away for 25 s and
     * the database dropping every connection, with at most one attempt used up; the wait isn't metered. Opt-in with
     * `BOQLET_NATIVE_RESILIENCE=1` (about a minute and a half; CI sets it).
     */
    @Test
    @EnabledIfEnvironmentVariable(named = "BOQLET_NATIVE_RESILIENCE", matches = "1")
    void jobsSurviveTheWorkerAndTheDatabaseGoingAway() throws Exception {
        if (POSTGRES_QUEUE) startQueueWorkers();
        Cookie cookie = person("resilience@example.test");
        String org = id(perform(post("/api/v1/orgs").content("{\"name\":\"Resilience\",\"slug\":\"resilience\"}"), cookie, 201));
        String project = id(perform(post("/api/v1/orgs/" + org + "/projects").content("{\"name\":\"Resilience\"}"), cookie, 201));
        String model = id(perform(post("/api/v1/projects/" + project + "/models")
                .content("{\"name\":\"Architecture\",\"discipline\":\"architecture\"}"), cookie, 201));

        // The worker is killed in the middle of a parse and is back 25 s later.
        String parse = startParse(cookie, model, variant(21));
        awaitRunning(parse);
        long stopped = System.nanoTime();
        stopWorkers();
        Thread.sleep(25_000);
        startWorkers();
        awaitJob(parse, cookie, scaled(Duration.ofSeconds(180)));
        long waited = (System.nanoTime() - stopped) / 1_000_000;
        assertThat(database.queryForObject("SELECT attempts FROM jobs WHERE id = ?", Integer.class, java.util.UUID.fromString(parse)))
                .as("attempts").isLessThanOrEqualTo(2);
        if (!POSTGRES_QUEUE) {
            // TF-009: the attempt the worker dropped counts its own processing, not the 25 s the job waited.
            long metered = database.queryForObject("SELECT duration_ms FROM usage_events WHERE job_id = ?", Long.class,
                    java.util.UUID.fromString(parse));
            assertThat(metered).as("metered ms").isLessThan(waited - 20_000);
        }

        // The database goes away for a moment while a parse runs, as in a restart: it stops answering for 2 s, then
        // every connection is dropped (a real restart would move the container's mapped port). Hikari reconnects;
        // the exchange with the worker goes on.
        String second = startParse(cookie, model, variant(22));
        awaitRunning(second);
        var docker = POSTGRES.getDockerClient();
        docker.pauseContainerCmd(POSTGRES.getContainerId()).exec();
        Thread.sleep(2_000);
        docker.unpauseContainerCmd(POSTGRES.getContainerId()).exec();
        try (var admin = java.sql.DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var statement = admin.createStatement()) {
            statement.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND backend_type = 'client backend'");
        }
        awaitDatabase();
        awaitJob(second, cookie, scaled(Duration.ofSeconds(180)));
        assertThat(database.queryForObject("SELECT attempts FROM jobs WHERE id = ?", Integer.class, java.util.UUID.fromString(second)))
                .as("attempts after a database restart").isLessThanOrEqualTo(2);
    }

    /** A person of their own (the shared owner's session belongs to the other tests). */
    private Cookie person(String email) throws Exception {
        String token = com.boqlet.suite.SuiteSupport.TOKEN_PREFIX + java.util.Base64.getUrlEncoder().withoutPadding()
                .encodeToString(email.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        database.update("INSERT INTO users (id, auth_subject, email, name) VALUES (?, ?, ?, ?)", Ids.newId(), token, email, email);
        var cookie = http.perform(post("/api/v1/sessions").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"deviceLabel\":\"Resilience\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getCookie("boqlet_session");
        personTokens.put(cookie.getValue(), token);
        return cookie;
    }

    private static final java.util.Map<String, String> personTokens = new java.util.concurrent.ConcurrentHashMap<>();

    /** The Duplex with `n` trailing blank lines: another file, so it is parsed and not taken from an earlier version (BR-08). */
    private static byte[] variant(int n) throws IOException {
        var bytes = new java.io.ByteArrayOutputStream();
        bytes.write(java.nio.file.Files.readAllBytes(ROOT.resolve("fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc")));
        bytes.write("\n".repeat(n).getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        return bytes.toByteArray();
    }

    /** Registers a version, PUTs the bytes, completes it; answers the parse job. */
    private String startParse(Cookie cookie, String model, byte[] bytes) throws Exception {
        var staged = perform(post("/api/v1/models/" + model + "/versions")
                .content("{\"fileName\":\"Duplex.ifc\",\"sizeBytes\":" + bytes.length + "}"), cookie, 201);
        var put = HttpRequest.newBuilder(URI.create(staged.path("upload").path("url").asText()))
                .PUT(HttpRequest.BodyPublishers.ofByteArray(bytes)).timeout(Duration.ofSeconds(30)).build();
        assertThat(NETWORK.send(put, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(200);
        return perform(post("/api/v1/model-versions/" + id(staged.path("version")) + "/complete"), cookie, 200)
                .path("parseJobId").asText();
    }

    /** Waits until the worker is at work on the job (past its download). */
    /**
     * Waits until the worker is on the job past its download, its result not yet given: what follows (a killed worker,
     * the database going away) happens in the middle of the job. On the queue transport a stage reaches the database
     * within 0.5 s (worker_queue.STAGE_SECONDS); before TF-192 it waited for the 3 s heartbeat, and a warm Linux
     * parse of the Duplex (2.8 s) ended without one.
     */
    private void awaitRunning(String job) throws Exception {
        long until = System.nanoTime() + scaled(Duration.ofSeconds(60)).toNanos();
        while (System.nanoTime() < until) {
            var row = database.queryForMap("""
                    SELECT status, progress->>'stage' AS stage, worker_result IS NOT NULL AS answered FROM jobs WHERE id = ?
                    """, java.util.UUID.fromString(job));
            String status = (String) row.get("status");
            if ("running".equals(status) && !Boolean.TRUE.equals(row.get("answered"))
                    && row.get("stage") != null && !"download".equals(row.get("stage"))) return;
            if (!"queued".equals(status) && !"running".equals(status) || Boolean.TRUE.equals(row.get("answered")))
                throw new AssertionError("The job ended (" + status + ") before it was seen running past its download.");
            Thread.sleep(100);
        }
        throw new AssertionError("The job never ran.");
    }

    private void stopWorkers() throws Exception {
        if (POSTGRES_QUEUE) {
            for (var process : queueWorkers) process.destroyForcibly().waitFor();
            queueWorkers.clear();
        } else {
            worker.destroyForcibly().waitFor();
        }
    }

    private void startWorkers() throws Exception {
        if (POSTGRES_QUEUE) {
            startQueueWorkers();
        } else {
            workerStart.redirectOutput(ProcessBuilder.Redirect.appendTo(Path.of("target/native-worker.log").toFile()));
            worker = workerStart.start();
        }
    }

    private void awaitDatabase() throws Exception {
        long until = System.nanoTime() + scaled(Duration.ofSeconds(60)).toNanos();
        while (System.nanoTime() < until) {
            try {
                database.queryForObject("SELECT 1", Integer.class);
                return;
            } catch (org.springframework.dao.DataAccessException restarting) {
                Thread.sleep(250);
            }
        }
        throw new AssertionError("The database did not come back.");
    }

    private JsonNode awaitJob(String job, Cookie cookie) throws Exception {
        return awaitJob(job, cookie, scaled(Duration.ofSeconds(120)));
    }

    private JsonNode awaitJob(String job, Cookie cookie, Duration timeout) throws Exception {
        long until = System.nanoTime() + timeout.toNanos();
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
        String token = cookie == null ? "owner" : personTokens.getOrDefault(cookie.getValue(), "owner");
        return request.header(HttpHeaders.AUTHORIZATION, "Bearer " + token).cookie(cookie).contentType(MediaType.APPLICATION_JSON);
    }

    private static String id(JsonNode node) {
        return node.path("id").asText();
    }
}
