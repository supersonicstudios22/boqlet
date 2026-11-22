package com.boqlet.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * TF-071: every failure answers the API's error body with its real status, over a real server (the
 * servlet error dispatch doesn't happen in MockMvc). Before, all of these answered `401`.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"BOQLET_NATIVE_AUTH=true", "BOQLET_APP_URL=https://booqlet.test", "boqlet.auth.secure-cookie=false"})
@Testcontainers
@DirtiesContext
class ErrorResponsesTest {
    private static final String ORIGIN = "https://booqlet.test";
    private static final String EMAIL = "errors@example.test";
    private static final String PASSWORD = "a long native test password";

    @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired ObjectMapper json;
    private final HttpClient http = HttpClient.newHttpClient();

    @Test
    void failuresAnswerTheirStatusAndCodeNotUnauthenticated() throws Exception {
        String cookie = signIn();
        assertError(send(get("/api/v1/notifications?limit=5000", cookie)), 400, "invalid_parameter");
        assertError(send(get("/api/v1/me", cookie).header("Origin", ORIGIN).method("DELETE", HttpRequest.BodyPublishers.noBody())), 405, "method_not_allowed");
        // The firewall rejects these before any handler; the error page used to be denied and answered 401.
        assertError(send(get("/api/v1//me", cookie)), 400, "invalid_request");
        assertError(send(get("/api/v1/me;x=1", cookie)), 400, "invalid_request");
        // Multipart is capped at 20 MB by the container (`spring.servlet.multipart`).
        byte[] file = new byte[21 << 20];
        String boundary = "boundary-tf071";
        byte[] head = ("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"codes.csv\"\r\n"
                + "Content-Type: text/csv\r\n\r\n").getBytes(StandardCharsets.UTF_8);
        byte[] tail = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
        var body = new java.io.ByteArrayOutputStream();
        body.write(head);
        body.write(file);
        body.write(tail);
        assertError(send(get("/api/v1/codelists/read", cookie).header("Origin", ORIGIN)
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))), 413, "too_large");
        // NUL in a body is refused before it reaches Postgres (TF-176).
        assertError(send(get("/api/v1/me", cookie).header("Origin", ORIGIN).header("Content-Type", "application/json")
                .method("PATCH", HttpRequest.BodyPublishers.ofString("{\"name\":\"a\\u0000b\"}"))), 400, "invalid_body");
        // An unexpected failure (here a database error) is a logged 500, not a 401.
        db.execute("CREATE FUNCTION tf071_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'tf071'; END $$");
        db.execute("CREATE TRIGGER tf071_fail BEFORE UPDATE OF name ON users FOR EACH ROW EXECUTE FUNCTION tf071_fail()");
        try {
            assertError(send(get("/api/v1/me", cookie).header("Origin", ORIGIN).header("Content-Type", "application/json")
                    .method("PATCH", HttpRequest.BodyPublishers.ofString("{\"name\":\"Unexpected\"}"))), 500, "internal");
        } finally {
            db.execute("DROP TRIGGER tf071_fail ON users");
            db.execute("DROP FUNCTION tf071_fail()");
        }
        // The error page itself is not a route.
        assertThat(send(get("/error", null)).statusCode()).isEqualTo(401);
    }

    private String signIn() throws Exception {
        String token = "e".repeat(43);
        var hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        db.update("INSERT INTO native_setup_links VALUES (?, ?, now() + interval '1 hour', 'setup')", EMAIL, hash);
        var setup = send(post("/api/v1/auth/set-password", Map.of("token", token, "password", PASSWORD, "name", "Errors")));
        assertThat(setup.statusCode()).isEqualTo(204);
        var signIn = send(post("/api/v1/auth/sign-in", Map.of("email", EMAIL, "password", PASSWORD, "deviceLabel", "Test")));
        assertThat(signIn.statusCode()).isEqualTo(201);
        return signIn.headers().firstValue("Set-Cookie").orElseThrow().split(";", 2)[0];
    }

    private HttpRequest.Builder get(String path, String cookie) {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
        return cookie == null ? request : request.header("Cookie", cookie);
    }

    private HttpRequest.Builder post(String path, Map<String, String> body) throws Exception {
        return get(path, null).header("Origin", ORIGIN).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
    }

    private HttpResponse<String> send(HttpRequest.Builder request) throws Exception {
        return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private void assertError(HttpResponse<String> response, int status, String code) throws Exception {
        assertThat(response.statusCode()).as(response.uri() + " " + response.body()).isEqualTo(status);
        assertThat(json.readTree(response.body()).path("code").asText()).as(response.body()).isEqualTo(code);
    }
}
