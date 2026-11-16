package com.boqlet.api.model;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.realtime.Notifications;
import com.boqlet.api.worker.JobHandler;
import com.boqlet.api.worker.Jobs;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class ParseJob implements JobHandler {
    private final JdbcTemplate database;
    private final StoredJson json;
    private final AuditWriter audit;
    private final Notifications notifications;

    ParseJob(JdbcTemplate database, StoredJson json, AuditWriter audit, Notifications notifications) {
        this.database = database;
        this.json = json;
        this.audit = audit;
        this.notifications = notifications;
    }

    @Override
    public String type() {
        return "parse";
    }

    @Override
    public void running(Jobs.Attempt attempt) {
        database.update("UPDATE model_versions SET status = 'processing' WHERE id = ? AND parse_job_id = ?",
                attempt.subject(), attempt.id());
    }

    @Override
    public Map<String, Object> finished(Jobs.Attempt attempt, String status, JsonNode result) {
        if (!"succeeded".equals(status)) {
            JsonNode error = result.path("error");
            if ("cancelled".equals(status)) {
                error = json.object(Map.of("code", "cancelled", "message", "The parse was cancelled.", "retryable", true));
            }
            database.update("""
                    UPDATE model_versions SET status = 'failed', error = CAST(? AS jsonb)
                    WHERE id = ? AND parse_job_id = ?
                    """, error.toString(), attempt.subject(), attempt.id());
            return Map.of("modelVersionId", attempt.subject());
        }
        var output = result.path("output");
        String sha = output.path("sha256").asText();
        var summary = json.object(output.path("summary"));
        summary.remove(java.util.List.of("fileName", "sizeBytes"));
        JsonNode artifacts = output.path("artifacts");
        validate(attempt, sha, summary, artifacts);
        database.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", row -> {},
                attempt.org() + ":" + sha);
        UUID model = database.queryForObject("SELECT model_id FROM model_versions WHERE id = ?", UUID.class, attempt.subject());
        Integer duplicate = database.query("""
                SELECT number FROM model_versions WHERE org_id = ? AND model_id = ? AND sha256 = ?
                    AND status = 'ready' AND id <> ? AND deleted_at IS NULL
                ORDER BY number DESC LIMIT 1
                """, (row, index) -> row.getInt("number"), attempt.org(), model, sha, attempt.subject())
                .stream().findFirst().orElse(null);
        String sharedArtifacts = database.query("""
                SELECT artifacts::text FROM model_versions
                WHERE org_id = ? AND sha256 = ? AND id <> ? AND status = 'ready' AND deleted_at IS NULL
                ORDER BY created_at LIMIT 1
                """, (row, index) -> row.getString("artifacts"), attempt.org(), sha, attempt.subject())
                .stream().findFirst().orElse(artifacts.toString());
        int updated = database.update("""
                UPDATE model_versions SET status = 'ready', sha256 = ?, summary = CAST(? AS jsonb),
                    artifacts = CAST(? AS jsonb), error = NULL, identical_to_number = ?
                WHERE id = ? AND parse_job_id = ? AND deleted_at IS NULL
                """, sha, summary.toString(), sharedArtifacts, duplicate, attempt.subject(), attempt.id());
        if (updated != 1) throw new IllegalStateException("The model version no longer applies to the job.");
        database.update("""
                UPDATE models SET latest_version_id = ?, updated_at = now()
                WHERE id = ? AND coalesce((SELECT number FROM model_versions WHERE id = models.latest_version_id), 0)
                    < (SELECT number FROM model_versions WHERE id = ?)
                """, attempt.subject(), model, attempt.subject());
        audit.record(new RequestContext(attempt.actor(), null, attempt.org(), null), AuditWriter.ActorKind.SYSTEM,
                attempt.project(), "model_version.ready", "modelVersion", attempt.subject(), json.object(Map.of("modelId", model)));
        newerModel(attempt, model);
        return Map.of("modelVersionId", attempt.subject());
    }

    private void newerModel(Jobs.Attempt attempt, UUID model) {
        String project = notifications.projectUrl(attempt.org(), attempt.project());
        database.query("""
                SELECT DISTINCT b.id, b.name AS boq, m.name AS model, latest.number, members.user_id
                FROM boqs b JOIN boq_revisions r ON r.id = b.current_revision_id
                JOIN models m ON m.id = ? AND m.project_id = b.project_id
                JOIN model_versions latest ON latest.id = m.latest_version_id AND latest.id = ?
                JOIN projects project ON project.id = b.project_id
                JOIN memberships members ON members.org_id = project.org_id
                JOIN users recipient ON recipient.id = members.user_id AND recipient.deleted_at IS NULL
                LEFT JOIN project_members pm ON pm.project_id = b.project_id AND pm.user_id = members.user_id
                WHERE b.project_id = ? AND NOT b.archived AND b.status = 'working' AND r.status <> 'issued'
                  AND (members.role IN ('owner','admin') OR pm.role IN ('lead','estimator'))
                  AND EXISTS (SELECT 1 FROM model_versions older WHERE older.model_id = m.id AND older.number < latest.number
                              AND r.inputs->'models' @> jsonb_build_array(jsonb_build_object('modelVersionId', older.id)))
                """, row -> {
            UUID boq = row.getObject("id", UUID.class);
            notifications.send(row.getObject("user_id", UUID.class), attempt.org(), attempt.project(),
                    "boq.new_version_available", null, Map.of("boq", row.getString("boq"),
                    "model", row.getString("model"), "version", row.getInt("number")), project + "/boqs/" + boq, "boq", boq);
        }, model, attempt.subject(), attempt.project());
    }

    private static void validate(Jobs.Attempt attempt, String sha, JsonNode summary, JsonNode artifacts) {
        if (!sha.matches("[0-9a-f]{64}") || !summary.isObject() || !artifacts.isObject()) {
            throw new IllegalStateException("Invalid worker parse result.");
        }
        String prefix = attempt.attemptPrefix();
        for (String name : new String[]{"parsedKey", "meshesKey", "sceneKey", "geometryKey"}) {
            if (!artifacts.path(name).asText().startsWith(prefix)) {
                throw new IllegalStateException("The model artifact is outside the organisation.");
            }
        }
    }
}
