package com.boqlet.api.boq;

import com.boqlet.api.worker.JobHandler;
import com.boqlet.api.worker.Jobs;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class ImportEditsJob implements JobHandler {
    private final JdbcTemplate database;

    ImportEditsJob(JdbcTemplate database) {
        this.database = database;
    }

    @Override
    public String type() { return "import_boq_edits"; }

    @Override
    public Map<String, Object> finished(Jobs.Attempt attempt, String status, JsonNode result) {
        if (!status.equals("succeeded")) return null;
        var output = result.path("output");
        String key = output.path("reportKey").asText();
        if (!key.equals(attempt.attemptPrefix() + "edits.json.gz")) throw new IllegalStateException("Invalid import report artifact.");
        database.update("INSERT INTO edits_import_reports (job_id, report_key) VALUES (?, ?)", attempt.id(), key);
        return Map.of("importReport", output.path("counts"));
    }
}
