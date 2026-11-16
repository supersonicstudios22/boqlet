package com.boqlet.api.boq;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.db.PostgresCopy;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.storage.ObjectStorage;
import com.boqlet.api.worker.JobHandler;
import com.boqlet.api.worker.Jobs;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.util.*;
import java.util.zip.GZIPInputStream;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class RunJob implements JobHandler {
    private final JdbcTemplate database;
    private final ObjectMapper mapper;
    private final StoredJson json;
    private final ObjectStorage storage;
    private final PostgresCopy copy;
    private final AuditWriter audit;

    RunJob(JdbcTemplate database, ObjectMapper mapper, StoredJson json, ObjectStorage storage, PostgresCopy copy, AuditWriter audit) {
        this.database = database;
        this.mapper = mapper;
        this.json = json;
        this.storage = storage;
        this.copy = copy;
        this.audit = audit;
    }

    @Override
    public String type() { return "run"; }

    @Override
    public void running(Jobs.Attempt attempt) {
        database.update("UPDATE runs SET status = 'running' WHERE id = ? AND job_id = ?", attempt.subject(), attempt.id());
    }

    @Override
    public Map<String, Object> finished(Jobs.Attempt attempt, String status, JsonNode result) {
        UUID run = attempt.subject();
        if (!status.equals("succeeded")) {
            database.update("""
                    UPDATE runs SET status = ?, error = CAST(? AS jsonb), finished_at = now() WHERE id = ? AND job_id = ?
                    """, status, result.has("error") ? result.get("error").toString() : null, run, attempt.id());
            return Map.of("runId", run);
        }
        var output = result.path("output");
        String key = output.path("resultKey").asText();
        if (!key.equals(attempt.attemptPrefix() + "result.json.gz")) throw new IllegalStateException("Invalid run artifact.");
        JsonNode doc = result(key);
        var versions = new LinkedHashMap<String, UUID>();
        for (JsonNode model : attempt.input().path("models")) {
            String id = model.path("id").asText();
            versions.put(id, UUID.fromString(id));
        }
        var lines = ordered(doc.path("lines"), run);
        index(run, lines, doc, versions);
        var stats = json.object(doc.path("stats"));
        stats.put("questions", doc.path("questions").size());
        int blocking = 0;
        for (JsonNode question : doc.path("questions")) if (question.path("blocking").asBoolean()) blocking++;
        stats.put("blockingQuestions", blocking);
        stats.put("warnings", doc.path("warnings").size());
        stats.retain("elements", "measuredElements", "excludedElements", "unmatchedElements", "lines", "flaggedLines",
                "decisionsApplied", "durationMs", "questions", "blockingQuestions", "warnings");
        String runStatus = blocking > 0 || doc.path("status").asText().equals("needs_input") ? "needs_input" : "complete";
        database.update("""
                UPDATE runs SET status = ?, result_key = ?, stats = CAST(? AS jsonb), models = CAST(? AS jsonb),
                    building = CAST(? AS jsonb), engine_version = ?, finished_at = now()
                WHERE id = ? AND job_id = ?
                """, runStatus, key, stats.toString(), optional(doc, "models"), optional(doc, "building"),
                output.path("engineVersion").asText("worker"), run, attempt.id());
        database.update("""
                UPDATE boq_revisions SET current_run_id = ?, updated_at = now()
                WHERE id = (SELECT revision_id FROM runs WHERE id = ?) AND status <> 'issued'
                """, run, run);
        audit.record(new RequestContext(attempt.actor(), null, attempt.org(), null), AuditWriter.ActorKind.SYSTEM, attempt.project(),
                "run.completed", "run", run, json.object(Map.of("status", runStatus)));
        return Map.of("runId", run);
    }

    private JsonNode result(String key) {
        try (var raw = storage.open(key); var gzip = new GZIPInputStream(raw)) {
            return mapper.readTree(gzip);
        } catch (IOException failure) {
            throw new IllegalStateException("Could not read run output.", failure);
        }
    }

    private List<JsonNode> ordered(JsonNode source, UUID run) {
        String encoded = database.queryForObject("SELECT input_snapshot::text FROM runs WHERE id = ?", String.class, run);
        JsonNode snapshot = json.read(encoded, JsonNode.class);
        var lines = new ArrayList<JsonNode>();
        var byKey = new HashMap<String, JsonNode>();
        source.forEach(line -> {
            lines.add(line);
            byKey.put(line.path("key").asText(), line);
        });
        for (JsonNode override : snapshot.path("overrides")) {
            if (!override.has("sortAfter")) continue;
            var line = byKey.get(override.path("lineKey").asText());
            JsonNode after = override.get("sortAfter").isNull() ? null : byKey.get(override.path("sortAfter").asText());
            if (line == null || line.equals(after) || (!override.get("sortAfter").isNull() && after == null)) continue;
            lines.remove(line);
            lines.add(after == null ? 0 : lines.indexOf(after) + 1, line);
        }
        return lines;
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

    private static String optional(JsonNode doc, String name) {
        return doc.hasNonNull(name) ? doc.get(name).toString() : null;
    }
}
