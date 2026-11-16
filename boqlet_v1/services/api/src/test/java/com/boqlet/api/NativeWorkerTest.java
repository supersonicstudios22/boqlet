package com.boqlet.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
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

@SpringBootTest
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
    private static final HttpClient NETWORK = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Container
    static final GenericContainer<?> S3 = new GenericContainer<>(DockerImageName.parse("minio/minio:latest"))
            .withEnv("MINIO_ROOT_USER", ACCESS).withEnv("MINIO_ROOT_PASSWORD", SECRET)
            .withCommand("server", "/data").withExposedPorts(9000)
            .waitingFor(Wait.forHttp("/minio/health/ready").forPort(9000));

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
        properties.add("boqlet.auth.pilot-emails", () -> "owner@example.test");
        properties.add("boqlet.storage.bucket", () -> BUCKET);
        properties.add("boqlet.storage.region", () -> "us-east-1");
        properties.add("boqlet.storage.endpoint", () -> endpoint);
        properties.add("boqlet.worker.url", () -> url);
    }

    @AfterAll
    static void stopWorker() {
        if (worker != null) worker.destroy();
    }

    @Autowired MockMvc http;
    @Autowired ObjectMapper json;

    @Test
    void duplexUploadRunsWorkerAndServesModelArtifacts() throws Exception {
        Cookie cookie = http.perform(post("/api/v1/sessions").header(HttpHeaders.AUTHORIZATION, "Bearer owner")
                .contentType(MediaType.APPLICATION_JSON).content("{\"deviceLabel\":\"Native worker test\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getCookie("boqlet_session");
        String org = id(perform(post("/api/v1/orgs").content("{\"name\":\"Native\",\"slug\":\"native-worker\"}"), cookie, 201));
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
