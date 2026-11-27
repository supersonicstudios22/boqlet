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
            error = versionError(error);
            int failed = database.update("""
                    UPDATE model_versions SET status = 'failed', error = CAST(? AS jsonb)
                    WHERE id = ? AND parse_job_id = ?
                    """, error.toString(), attempt.subject(), attempt.id());
            // BR-51, F09: a failed or cancelled parse is in the audit, with the version's error code (TF-034).
            if (failed == 1) {
                audit.record(new RequestContext(attempt.actor(), null, attempt.org(), null), AuditWriter.ActorKind.SYSTEM,
                        attempt.project(), "model_version.failed", "modelVersion", attempt.subject(),
                        json.object(Map.of("code", error.path("code").asText(), "jobId", attempt.id().toString())));
            }
            return Map.of("modelVersionId", attempt.subject());
        }
        var output = result.path("output");
        String sha = output.path("sha256").asText();
        var summary = json.object(output.path("summary"));
        summary.remove(java.util.List.of("fileName", "sizeBytes"));
        JsonNode artifacts = output.path("artifacts");
        validate(attempt, sha, summary, artifacts);
        if (!ready(attempt.org(), attempt.project(), attempt.actor(), attempt.subject(), sha, summary, artifacts.toString(), attempt.id())) {
            throw new IllegalStateException("The model version no longer applies to the job.");
        }
        return Map.of("modelVersionId", attempt.subject());
    }

    /** The codes a failed version answers (state-machines.md ModelVersion, TF-037); the app translates each. */
    static final java.util.Set<String> VERSION_ERRORS = java.util.Set.of("not_ifc", "unsupported_schema", "corrupt_file",
            "truncated_file", "no_project", "too_large", "too_complex", "parse_timeout", "parse_error", "cancelled", "upload_expired");

    /**
     * A job's error as a version's: a code of the list, the job's own code kept as `cause` (for support).
     * Timeouts are `parse_timeout`; the worker's and the backend's own failures (`worker_lost`,
     * `engine_unavailable`, `engine_process_failed`, `engine_error`, `invalid_input`, `ingestion_failed`...) are `parse_error`.
     */
    static com.fasterxml.jackson.databind.node.ObjectNode versionError(JsonNode error) {
        var out = error != null && error.isObject() ? ((com.fasterxml.jackson.databind.node.ObjectNode) error).deepCopy()
                : com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        String code = out.path("code").asText("");
        String mapped = VERSION_ERRORS.contains(code) ? code
                : java.util.Set.of("engine_timeout", "job_timeout", "timeout").contains(code) ? "parse_timeout" : "parse_error";
        if (!mapped.equals(code)) out.put("cause", code).put("code", mapped);
        if (!out.hasNonNull("message")) out.put("message", "The model could not be parsed.");
        return out;
    }

    /**
     * A version of `org` is ready with a parse result: its own (`job` is its parse job) or the
     * result of an identical file already parsed in the org (`job` null, BR-08). Answers false when
     * the version no longer applies (deleted, or another job's).
     */
    boolean ready(UUID org, UUID project, UUID actor, UUID version, String sha, JsonNode summary, String artifacts, UUID job) {
        database.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", row -> {}, org + ":" + sha);
        UUID model = database.queryForObject("SELECT model_id FROM model_versions WHERE id = ?", UUID.class, version);
        Integer duplicate = database.query("""
                SELECT number FROM model_versions WHERE org_id = ? AND model_id = ? AND sha256 = ?
                    AND status = 'ready' AND id <> ? AND deleted_at IS NULL
                ORDER BY number DESC LIMIT 1
                """, (row, index) -> row.getInt("number"), org, model, sha, version)
                .stream().findFirst().orElse(null);
        String sharedArtifacts = database.query("""
                SELECT artifacts::text FROM model_versions
                WHERE org_id = ? AND sha256 = ? AND id <> ? AND status = 'ready' AND deleted_at IS NULL
                ORDER BY created_at LIMIT 1
                """, (row, index) -> row.getString("artifacts"), org, sha, version)
                .stream().findFirst().orElse(artifacts);
        int updated = database.update("""
                UPDATE model_versions SET status = 'ready', sha256 = ?, summary = CAST(? AS jsonb),
                    artifacts = CAST(? AS jsonb), error = NULL, identical_to_number = ?
                WHERE id = ? AND parse_job_id IS NOT DISTINCT FROM ? AND deleted_at IS NULL
                """, sha, summary.toString(), sharedArtifacts, duplicate, version, job);
        if (updated != 1) return false;
        // "detect": the first parsed version's guess becomes the model's discipline (F03 §1), when it is one of
        // the disciplines; a guess that isn't ("unknown", "mixed", "infrastructure") becomes architecture (TF-128).
        String guess = summary.path("disciplineGuess").asText("");
        database.update("UPDATE models SET discipline = ? WHERE id = ? AND discipline = 'detect'",
                Models.disciplines(database, org).contains(guess) ? guess : "architecture", model);
        database.update("""
                UPDATE models SET latest_version_id = ?, updated_at = now()
                WHERE id = ? AND coalesce((SELECT number FROM model_versions WHERE id = models.latest_version_id), 0)
                    < (SELECT number FROM model_versions WHERE id = ?)
                """, version, model, version);
        audit.record(new RequestContext(actor, null, org, null), AuditWriter.ActorKind.SYSTEM,
                project, "model_version.ready", "modelVersion", version, json.object(Map.of("modelId", model)));
        newerModel(org, project, version, model);
        return true;
    }

    /** The summary of a ready version of the org with this file, if the org has parsed it before (BR-08). */
    JsonNode parsedBefore(UUID org, String sha, UUID version) {
        return database.query("""
                SELECT summary::text FROM model_versions
                WHERE org_id = ? AND sha256 = ? AND id <> ? AND status = 'ready' AND deleted_at IS NULL
                ORDER BY created_at LIMIT 1
                """, (row, index) -> json.read(row.getString(1), JsonNode.class), org, sha, version).stream().findFirst().orElse(null);
    }

    private void newerModel(UUID org, UUID projectId, UUID version, UUID model) {
        String project = notifications.projectUrl(org, projectId);
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
            notifications.send(row.getObject("user_id", UUID.class), org, projectId,
                    "boq.new_version_available", null, Map.of("boq", row.getString("boq"),
                    "model", row.getString("model"), "version", row.getInt("number")), project + "/boqs/" + boq, "boq", boq);
        }, model, version, projectId);
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
