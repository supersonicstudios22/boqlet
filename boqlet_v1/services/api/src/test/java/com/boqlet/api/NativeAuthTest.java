package com.boqlet.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
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

@SpringBootTest(properties = {"BOQLET_NATIVE_AUTH=true", "BOQLET_APP_URL=https://booqlet.test"})
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

    @Test
    void verifiedSetupCookieOriginTakeoverAndOperatorRecovery() throws Exception {
        http.perform(setup(SETUP, PASSWORD)).andExpect(status().isBadRequest());
        issue(SETUP, "setup");
        http.perform(setup(SETUP, PASSWORD)).andExpect(status().isNoContent());
        http.perform(setup(SETUP, PASSWORD)).andExpect(status().isBadRequest());
        assertThat(db.queryForObject("SELECT password_hash FROM native_credentials", String.class)).startsWith("$argon2id$");

        http.perform(signIn(PASSWORD, false).header("Origin", "https://other.test"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("invalid_origin"));
        http.perform(signIn("incorrect password", false).header("Origin", ORIGIN)).andExpect(status().isUnauthorized());
        var first = http.perform(signIn(PASSWORD, false).header("Origin", ORIGIN)).andExpect(status().isCreated())
                .andReturn().getResponse().getCookie("boqlet_session");
        assertThat(first).isNotNull();
        assertThat(first.getValue()).hasSize(43);
        assertThat(first.isHttpOnly() && first.getSecure()).isTrue();
        http.perform(get("/api/v1/me").cookie(first)).andExpect(status().isOk()).andExpect(jsonPath("$.user.email").value(EMAIL));
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
        http.perform(delete("/api/v1/sessions/current").header("Origin", ORIGIN).cookie(third)).andExpect(status().isNoContent());
        http.perform(get("/api/v1/me").cookie(third)).andExpect(status().isUnauthorized());
    }

    private void issue(String token, String purpose) throws Exception {
        var hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        db.update("INSERT INTO native_setup_links VALUES (?, ?, now() + interval '1 hour', ?)", EMAIL, hash, purpose);
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
