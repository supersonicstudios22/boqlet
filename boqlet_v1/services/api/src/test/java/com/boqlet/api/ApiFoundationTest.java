package com.boqlet.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.audit.AuditWriter.ActorKind;
import com.boqlet.api.db.Ids;
import com.boqlet.api.http.Idempotency;
import com.boqlet.api.http.RequestContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class ApiFoundationTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc http;
    @Autowired ObjectMapper json;
    @Autowired Idempotency idempotency;
    @Autowired AuditWriter audit;
    @Autowired JdbcTemplate database;

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
}
