package com.boqlet.api.boq;

import com.boqlet.api.worker.JobHandler;
import com.boqlet.api.worker.Jobs;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class ExportJob implements JobHandler {
    private final JdbcTemplate database;

    ExportJob(JdbcTemplate database) {
        this.database = database;
    }

    @Override
    public String type() { return "export_xlsx"; }

    @Override
    public Map<String, Object> finished(Jobs.Attempt attempt, String status, JsonNode result) {
        if (!status.equals("succeeded")) return null;
        var output = result.path("output");
        String key = output.path("xlsxKey").asText();
        long bytes = output.path("sizeBytes").asLong();
        if (!key.equals(attempt.attemptPrefix() + "export.xlsx") || bytes <= 0) {
            throw new IllegalStateException("Invalid Excel artifact.");
        }
        database.update("UPDATE exports SET storage_key = ?, size_bytes = ? WHERE id = ? AND job_id = ?",
                key, bytes, attempt.subject(), attempt.id());
        return Map.of("exportId", attempt.subject());
    }
}
