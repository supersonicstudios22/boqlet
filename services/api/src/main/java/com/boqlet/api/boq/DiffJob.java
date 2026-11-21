package com.boqlet.api.boq;

import com.boqlet.api.db.PostgresCopy;
import com.boqlet.api.worker.JobHandler;
import com.boqlet.api.worker.Jobs;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class DiffJob implements JobHandler {
    private final JdbcTemplate database;
    private final ArtifactReader artifacts;
    private final PostgresCopy copy;

    DiffJob(JdbcTemplate database, ArtifactReader artifacts, PostgresCopy copy) {
        this.database = database;
        this.artifacts = artifacts;
        this.copy = copy;
    }

    @Override
    public String type() { return "diff"; }

    @Override
    public Map<String, Object> finished(Jobs.Attempt attempt, String status, JsonNode result) {
        if (!status.equals("succeeded")) return null;
        String key = result.path("output").path("diffKey").asText();
        if (!key.equals(attempt.attemptPrefix() + "diff.json.gz")) throw new IllegalStateException("Unexpected diff artifact key.");
        JsonNode diff = artifacts.read(key);
        copy.copy("diff_lines (diff_id, seq, row_data)", rows -> {
            int index = 0;
            for (JsonNode line : diff.path("lines")) rows.add(attempt.subject(), index++, line);
        });
        copy.copy("diff_elements (diff_id, seq, row_data)", rows -> {
            int index = 0;
            for (JsonNode element : diff.path("elements")) rows.add(attempt.subject(), index++, element);
        });
        database.update("""
                UPDATE run_diffs SET diff_key = ?, summary = CAST(? AS jsonb), questions = CAST(? AS jsonb)
                WHERE id = ? AND job_id = ?
                """, key, diff.path("summary").toString(), diff.path("questions").toString(), attempt.subject(), attempt.id());
        return Map.of("diffId", attempt.subject());
    }
}
