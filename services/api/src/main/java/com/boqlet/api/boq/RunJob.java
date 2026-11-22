package com.boqlet.api.boq;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.worker.JobHandler;
import com.boqlet.api.worker.Jobs;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class RunJob implements JobHandler {
    private final JdbcTemplate database;
    private final StoredJson json;
    private final ArtifactReader artifacts;
    private final RunIndex index;
    private final AuditWriter audit;

    RunJob(JdbcTemplate database, StoredJson json, ArtifactReader artifacts, RunIndex index, AuditWriter audit) {
        this.database = database;
        this.json = json;
        this.artifacts = artifacts;
        this.index = index;
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
            int ended = database.update("""
                    UPDATE runs SET status = ?, error = CAST(? AS jsonb), finished_at = now() WHERE id = ? AND job_id = ?
                    """, status, result.has("error") ? result.get("error").toString() : null, run, attempt.id());
            // A run that fails or is cancelled is in the audit too, with its error code (BR-51, TF-034).
            if (ended == 1) {
                var data = json.object(Map.of("runId", run.toString(), "status", status));
                if (result.path("error").hasNonNull("code")) data.put("code", result.path("error").path("code").asText());
                audit.record(new RequestContext(attempt.actor(), null, attempt.org(), null), AuditWriter.ActorKind.SYSTEM,
                        attempt.project(), status.equals("cancelled") ? "run.cancelled" : "run.failed", "run", run, data);
            }
            return Map.of("runId", run);
        }
        var output = result.path("output");
        String key = output.path("resultKey").asText();
        if (!key.equals(attempt.attemptPrefix() + "result.json.gz")) throw new IllegalStateException("Invalid run artifact.");
        JsonNode doc = artifacts.read(key);
        index.populate(run, doc);
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
                    building = CAST(? AS jsonb), engine_version = ?, answered_questions = CAST(? AS jsonb), finished_at = now()
                WHERE id = ? AND job_id = ?
                """, runStatus, key, stats.toString(), optional(doc, "models"), optional(doc, "building"),
                output.path("engineVersion").asText("worker"), optional(doc, "answeredQuestionIds"), run, attempt.id());
        // The newest finished run is current (F04): a run started before the current one doesn't replace it (TF-094).
        database.update("""
                UPDATE boq_revisions SET current_run_id = ?, updated_at = now()
                WHERE id = (SELECT revision_id FROM runs WHERE id = ?) AND status <> 'issued'
                    AND (current_run_id IS NULL OR (SELECT created_at FROM runs WHERE id = current_run_id)
                        <= (SELECT created_at FROM runs WHERE id = ?))
                """, run, run, run);
        var ids = database.queryForMap("""
                SELECT r.id AS "revisionId", r.boq_id AS "boqId" FROM runs n JOIN boq_revisions r ON r.id = n.revision_id
                WHERE n.id = ?
                """, run);
        var event = json.object(ids).put("status", runStatus).put("runId", run.toString());
        audit.record(new RequestContext(attempt.actor(), null, attempt.org(), null), AuditWriter.ActorKind.SYSTEM, attempt.project(),
                "run.completed", "run", run, event);
        return Map.of("runId", run);
    }

    private static String optional(JsonNode doc, String name) {
        return doc.hasNonNull(name) ? doc.get(name).toString() : null;
    }
}
