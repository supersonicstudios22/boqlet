package com.boqlet.api.boq;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The grouped {@code /lines} view's subtotal (BR-63) on the vectors the sheet (Vitest) and the Excel writer
 * (pytest) run too: {@code fixtures/subtotals.json}. The SQL runs on PostgreSQL over a table with the two
 * columns it reads.
 */
@Testcontainers
class GroupSubtotalTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    private static final ObjectMapper JSON = new ObjectMapper();

    static Stream<Arguments> vectors() throws Exception {
        var root = Path.of("").toAbsolutePath();
        while (!Files.exists(root.resolve("fixtures/subtotals.json"))) root = root.getParent();
        var vectors = new ArrayList<Arguments>();
        for (var vector : JSON.readTree(root.resolve("fixtures/subtotals.json").toFile()).get("vectors"))
            vectors.add(Arguments.of(vector.get("name").asText(), vector));
        return vectors.stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("vectors")
    void aGroupSubtotalMatchesTheSharedVectors(String name, JsonNode vector) throws Exception {
        var source = new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        var named = new NamedParameterJdbcTemplate(source);
        named.getJdbcTemplate().execute("CREATE TABLE IF NOT EXISTS run_lines (run_id uuid NOT NULL, line jsonb NOT NULL)");
        UUID run = UUID.randomUUID();
        for (var line : vector.get("lines")) {
            var stored = ((ObjectNode) line.deepCopy());
            stored.set("codes", JSON.readTree("{\"x\": {\"code\": \"1\", \"title\": \"One\", \"path\": [{\"code\": \"1\", \"title\": \"One\"}]}}"));
            named.update("INSERT INTO run_lines (run_id, line) VALUES (:run, CAST(:line AS jsonb))",
                    new MapSqlParameterSource().addValue("run", run).addValue("line", JSON.writeValueAsString(stored)));
        }
        var args = new MapSqlParameterSource().addValue("run", run).addValue("system", "x").addValue("depth", 1);
        List<com.boqlet.contract.model.LineGroup> groups = RunReads.groups(named, " FROM run_lines l WHERE l.run_id = :run", args);

        var expected = vector.get("expected");
        assertThat(groups).hasSize(1);
        var group = groups.getFirst();
        assertThat(group.getPath()).isEqualTo("1");
        assertThat(group.getLineCount()).isEqualTo(expected.get("count").asInt());
        assertThat(group.getUnit().get()).isEqualTo(expected.get("unit").isNull() ? null : expected.get("unit").asText());
        if (expected.get("quantity").isNull()) assertThat(group.getQuantity().get()).isNull();
        else assertThat(group.getQuantity().get()).isEqualByComparingTo(new BigDecimal(expected.get("quantity").asText()));
    }
}
