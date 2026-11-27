package com.boqlet.api.boq;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The line list's trace summary (review B-18) runs through JDBC with named parameters, as `RunReads` runs it (a
 * `?` jsonb operator would be taken for a parameter there), and keeps only what the list promises.
 */
@Testcontainers
class RunLineSummaryTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void aSummaryKeepsTheFormulaSourceLineAndEachElementsGuidQuantityAndModel() throws Exception {
        var named = new NamedParameterJdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        named.getJdbcTemplate().execute("CREATE TABLE IF NOT EXISTS run_lines (run_id uuid NOT NULL, line jsonb NOT NULL)");
        UUID run = UUID.randomUUID();
        String line = """
                {"key": "k", "quantity": 3.5, "trace": {"formula": "net_area", "params": {"a": 1}, "sourceLine": "s",
                 "steps": [{"kind": "sum"}],
                 "elements": [{"guid": "g1", "name": "Wall 1", "quantity": 2, "model": "m1", "decisions": [{"questionId": "q"}]},
                              {"guid": "g2", "quantity": null, "note": "missing"}]}}
                """;
        named.update("INSERT INTO run_lines (run_id, line) VALUES (:run, CAST(:line AS jsonb))",
                new MapSqlParameterSource().addValue("run", run).addValue("line", line));

        String summary = named.queryForObject("SELECT " + RunReads.SUMMARY + " AS line FROM run_lines p WHERE p.run_id = :run",
                new MapSqlParameterSource().addValue("run", run), String.class);

        var tree = JSON.readTree(summary);
        assertThat(tree.path("key").asText()).isEqualTo("k");
        assertThat(tree.path("quantity").asDouble()).isEqualTo(3.5);
        assertThat(JSON.readTree(tree.path("trace").toString())).isEqualTo(JSON.readTree("""
                {"formula": "net_area", "params": {}, "sourceLine": "s",
                 "elements": [{"guid": "g1", "quantity": 2, "model": "m1"}, {"guid": "g2", "quantity": null}]}
                """));
    }
}
