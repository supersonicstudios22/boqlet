package com.boqlet.api.boq;

import com.boqlet.api.db.PostgresCopy;
import com.boqlet.api.db.StoredJson;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RunIndex {
    private final JdbcTemplate database;
    private final StoredJson json;
    private final ArtifactReader artifacts;
    private final PostgresCopy copy;

    private final io.micrometer.core.instrument.Timer ingestion;

    RunIndex(JdbcTemplate database, StoredJson json, ArtifactReader artifacts, PostgresCopy copy,
             io.micrometer.core.instrument.MeterRegistry meters) {
        this.ingestion = io.micrometer.core.instrument.Timer.builder("boqlet.runs.ingestion")
                .description("Time to index a run result's lines, questions, warnings and log").register(meters);
        this.database = database;
        this.json = json;
        this.artifacts = artifacts;
        this.copy = copy;
    }

    @Transactional
    public void ensure(UUID run) {
        var entries = database.query("""
                SELECT result_key, indexed_at IS NULL AS missing FROM runs
                WHERE id = ? AND result_key IS NOT NULL AND (indexed_at IS NULL OR indexed_at < now() - interval '1 day')
                FOR NO KEY UPDATE
                """, (row, i) -> new IndexEntry(row.getString("result_key"), row.getBoolean("missing")), run);
        if (entries.isEmpty()) return;
        var entry = entries.getFirst();
        if (entry.missing()) ingestion.record(() -> populate(run, artifacts.read(entry.key())));
        else database.update("UPDATE runs SET indexed_at = now() WHERE id = ?", run);
    }

    void populate(UUID run, JsonNode document) {
        String encoded = database.queryForObject("SELECT input_snapshot::text FROM runs WHERE id = ?", String.class, run);
        JsonNode snapshot = json.read(encoded, JsonNode.class);
        var versions = new LinkedHashMap<String, UUID>();
        for (var model : snapshot.path("inputs").path("models")) {
            String id = model.path("modelVersionId").asText();
            versions.put(id, UUID.fromString(id));
        }
        index(run, ordered(document.path("lines"), snapshot), document, versions);
        database.update("UPDATE runs SET indexed_at = now() WHERE id = ?", run);
    }

    private record IndexEntry(String key, boolean missing) {}

    /**
     * Display order (F06 §13): the engine's order, then each manual line placed after its
     * `sortHint` line, then each edited line after its `sortAfter` line (`null`: first in its
     * section). A target that isn't in the run leaves the line where it is.
     */
    private List<JsonNode> ordered(JsonNode source, JsonNode snapshot) {
        var lines = new ArrayList<JsonNode>();
        source.forEach(lines::add);
        var moves = new ArrayList<Map.Entry<String, JsonNode>>();
        for (JsonNode manual : snapshot.path("manualItems")) {
            if (manual.hasNonNull("sortHint")) moves.add(Map.entry(manual.path("item").path("id").asText(), manual.get("sortHint")));
        }
        for (JsonNode override : snapshot.path("overrides")) {
            if (override.has("sortAfter")) moves.add(Map.entry(override.path("lineKey").asText(), override.get("sortAfter")));
        }
        String primary = null;
        for (JsonNode line : lines) {
            var systems = line.path("codes").fieldNames();
            if (systems.hasNext()) {
                primary = systems.next();
                break;
            }
        }
        for (var move : moves) {
            int from = indexOf(lines, move.getKey());
            if (from < 0) continue;
            JsonNode line = lines.remove(from);
            int to;
            if (move.getValue().isNull()) {
                String section = section(line, primary);
                int first = -1;
                for (int index = 0; index < lines.size() && first < 0; index++) {
                    if (section(lines.get(index), primary).equals(section)) first = index;
                }
                to = first < 0 ? from : first;
            } else {
                int target = indexOf(lines, move.getValue().asText());
                to = target < 0 ? from : target + 1;
            }
            lines.add(to, line);
        }
        return lines;
    }

    private static int indexOf(List<JsonNode> lines, String key) {
        for (int index = 0; index < lines.size(); index++) {
            if (lines.get(index).path("key").asText().equals(key)) return index;
        }
        return -1;
    }

    /** The line's section in the first classification: its code path, e.g. `A/A.01`. */
    private static String section(JsonNode line, String primary) {
        if (primary == null) return "";
        var path = new ArrayList<String>();
        line.path("codes").path(primary).path("path").forEach(step -> path.add(step.path("code").asText()));
        return String.join("/", path);
    }

    private void index(UUID run, List<JsonNode> lines, JsonNode doc, Map<String, UUID> versions) {
        copy.copy("run_lines (run_id, sort_index, line_key, line)", rows -> {
            for (int index = 0; index < lines.size(); index++) {
                var line = lines.get(index);
                rows.add(run, index, line.path("key").asText(), line);
            }
        });
        copy.copy("run_line_elements (run_id, line_key, guid, model_version_id)", rows -> {
            for (JsonNode line : lines) for (JsonNode element : line.path("trace").path("elements")) {
                UUID version = element.has("model") ? versions.get(element.path("model").asText())
                        : versions.size() == 1 ? versions.values().iterator().next() : null;
                rows.add(run, line.path("key").asText(), element.path("guid").asText(), version);
            }
        });
        copy.copy("run_questions (run_id, question_id, sort_index, question)", rows -> {
            int index = 0;
            for (JsonNode question : doc.path("questions")) rows.add(run, question.path("id").asText(), index++, question);
        });
        copy.copy("run_warnings (run_id, seq, warning)", rows -> {
            int index = 0;
            for (JsonNode warning : doc.path("warnings")) rows.add(run, index++, warning);
        });
        copy.copy("run_log_entries (run_id, seq, entry)", rows -> {
            for (JsonNode log : doc.path("log")) rows.add(run, log.path("seq").asInt(), log);
        });
    }

}
