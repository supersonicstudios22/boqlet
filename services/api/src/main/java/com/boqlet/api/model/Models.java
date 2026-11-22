package com.boqlet.api.model;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.api.storage.ObjectStorage;
import com.boqlet.api.worker.Jobs;
import com.boqlet.api.worker.WorkerClient;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class Models {
    private static final String VERSION_QUERY = """
            SELECT v.*, u.name AS uploader_name, m.project_id FROM model_versions v
            JOIN models m ON m.id = v.model_id LEFT JOIN users u ON u.id = v.uploaded_by AND u.deleted_at IS NULL
            WHERE v.deleted_at IS NULL
            """;
    private static final String MODEL_QUERY = """
            SELECT m.*, (SELECT count(*) FROM model_versions v WHERE v.model_id = m.id AND v.deleted_at IS NULL) AS version_count
            FROM models m WHERE true
            """;
    private static final BigDecimal MIB = BigDecimal.valueOf(1L << 20);

    private final JdbcTemplate database;
    private final StoredJson json;
    private final ObjectMapper mapper;
    private final ProjectAccess projects;
    private final EntitlementService limits;
    private final ObjectStorage storage;
    private final Jobs jobs;
    private final WorkerClient worker;
    private final AuditWriter audit;
    private final ParseJob parses;
    private final long uploadLimit;

    Models(JdbcTemplate database, StoredJson json, ObjectMapper mapper, ProjectAccess projects, EntitlementService limits,
           ObjectStorage storage, Jobs jobs, WorkerClient worker, AuditWriter audit, ParseJob parses,
           @Value("${boqlet.worker.max-upload-mib}") long uploadMib) {
        this.parses = parses;
        this.database = database;
        this.json = json;
        this.mapper = mapper;
        this.projects = projects;
        this.limits = limits;
        this.storage = storage;
        this.jobs = jobs;
        this.worker = worker;
        this.audit = audit;
        this.uploadLimit = Math.multiplyExact(uploadMib, 1L << 20);
    }

    public List<Model> list(UUID project, UUID actor) {
        projects.require(project, actor);
        return database.query(MODEL_QUERY + " AND m.project_id = ? AND NOT m.archived ORDER BY m.created_at, m.id",
                this::modelRow, project).stream().map(this::withLatest).toList();
    }

    public Model get(UUID id, UUID actor) {
        ModelRow row = model(id);
        projects.require(row.tree().getProjectId(), actor);
        return withLatest(row);
    }

    @Transactional
    public Model create(UUID project, UUID actor, ModelCreate request) {
        Project p = projects.lock(project, actor, "editModels");
        UUID id = Ids.newId();
        String discipline = request.getDiscipline() == null ? DETECT : discipline(p.getOrgId(), request.getDiscipline());
        database.update("""
                INSERT INTO models (id, project_id, name, discipline, scope) VALUES (?, ?, ?, ?, CAST(? AS jsonb))
                """, id, project, nonblank(request.getName()), discipline, scope(request.getScope()));
        event(p, actor, "model.created", "model", id);
        return model(id).tree();
    }

    @Transactional
    public Model update(UUID id, UUID actor, ModelUpdate request) {
        ModelRow row = model(id);
        Project project = projects.lock(row.tree().getProjectId(), actor, "editModels");
        checkModelActive(model(id));
        database.update("""
                UPDATE models SET name = coalesce(?, name), discipline = coalesce(?, discipline),
                    scope = coalesce(CAST(? AS jsonb), scope), updated_at = now() WHERE id = ?
                """, request.getName() == null ? null : nonblank(request.getName()),
                request.getDiscipline() == null ? null : discipline(project.getOrgId(), request.getDiscipline()),
                scope(request.getScope()), id);
        event(project, actor, "model.updated", "model", id);
        return withLatest(model(id));
    }

    @Transactional
    public void archive(UUID id, UUID actor) {
        Project project = projects.lock(model(id).tree().getProjectId(), actor, "editModels");
        if (database.update("UPDATE models SET archived = true, updated_at = now() WHERE id = ? AND NOT archived", id) != 0) {
            event(project, actor, "model.archived", "model", id);
        }
    }

    public List<ModelVersion> versions(UUID model, UUID actor) {
        projects.require(model(model).tree().getProjectId(), actor);
        return database.query(VERSION_QUERY + " AND v.model_id = ? ORDER BY v.number DESC", this::versionRow, model)
                .stream().map(this::withUsage).toList();
    }

    public ModelVersion getVersion(UUID id, UUID actor) {
        return withUsage(visible(id, actor));
    }

    public record WorkerModel(UUID project, UUID version, UUID model, String name, String fileName, String discipline,
                              Map<String, Object> scope, JsonNode artifacts) {
        public Map<String, Object> input() {
            return Map.of("id", version, "modelId", model, "name", name, "fileName", fileName, "discipline", discipline,
                    "scope", scope, "parsedKey", artifacts.path("parsedKey").asText(), "meshesKey", artifacts.path("meshesKey").asText());
        }
    }

    public WorkerModel workerModel(UUID id, UUID actor) {
        var row = visible(id, actor);
        ready(row, "parsedKey");
        Model model = model(row.tree().getModelId()).tree();
        return new WorkerModel(row.project(), row.tree().getId(), model.getId(), model.getName(), row.tree().getFileName(),
                model.getDiscipline(), model.getScope() == null ? Map.of() : model.getScope(), row.artifacts());
    }

    @Transactional
    public CreateModelVersion201Response createVersion(UUID model, UUID actor, CreateModelVersionRequest request) {
        Project project = projects.lock(model(model).tree().getProjectId(), actor, "editModels");
        checkModelActive(model(model));
        String filename = nonblank(request.getFileName());
        if (filename.length() > 255 || filename.matches("(?s).*[\\\\/\\p{Cntrl}].*")) {
            throw failure(HttpStatus.BAD_REQUEST, "invalid_body", "Invalid model filename.");
        }
        boolean zipped = filename.toLowerCase(Locale.ROOT).endsWith(".ifczip");
        if (!zipped && !filename.toLowerCase(Locale.ROOT).endsWith(".ifc")) {
            throw failure(HttpStatus.BAD_REQUEST, "not_ifc", "Choose an IFC or IFCZIP file.");
        }
        long size = request.getSizeBytes();
        if (size <= 0) throw failure(HttpStatus.BAD_REQUEST, "invalid_body", "Model file must not be empty.");
        if (size > uploadLimit) throw failure(HttpStatus.PAYLOAD_TOO_LARGE, "model_too_large", "The file exceeds the worker upload limit.");
        UUID org = project.getOrgId();
        limits.checkSize(org, actor, "maxModelVersionMb", BigDecimal.valueOf(size).divide(MIB));
        // F03: refused before any bytes go to storage, not only when the parse is enqueued (TF-076).
        limits.checkConsumption(org, actor, "processingMinutesPerMonth",
                limits.processingMillis(org, java.time.YearMonth.now(java.time.ZoneOffset.UTC)), 60_000);
        UUID id = Ids.newId();
        String prefix = ObjectStorage.orgPrefix(org) + "uploads/" + id + "/";
        String incoming = prefix + "incoming";
        String source = prefix + (zipped ? "source.ifczip" : "source.ifc");
        int number = database.queryForObject("SELECT coalesce(max(number), 0) + 1 FROM model_versions WHERE model_id = ?",
                Integer.class, model);
        ObjectStorage.Upload grant = storage.upload(incoming, size);
        try {
            database.update("""
                    INSERT INTO model_versions (id, model_id, org_id, number, file_name, size_bytes, source_key,
                                                upload_key, multipart_id, uploaded_by, note)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, id, model, org, number, filename, size, source, incoming, grant.multipartId(), actor, request.getNote());
            event(project, actor, "model_version.created", "modelVersion", id);
        } catch (RuntimeException error) {
            storage.abort(incoming, grant.multipartId());
            throw error;
        }
        return new CreateModelVersion201Response(version(id).tree(), grant.instructions());
    }

    @Transactional
    public UUID seedDuplex(Project project, UUID actor) {
        if (!Boolean.TRUE.equals(project.getSample())) throw new IllegalArgumentException("Expected a sample project.");
        String filename = "Ifc2x3_Duplex_Architecture.ifc";
        byte[] data;
        try (var input = new org.springframework.core.io.ClassPathResource("samples/" + filename).getInputStream()) {
            data = input.readAllBytes();
        } catch (IOException failure) {
            throw new IllegalStateException("The bundled Duplex sample is unavailable.", failure);
        }
        UUID model = create(project.getId(), actor, new ModelCreate("Duplex architecture").discipline("architecture")).getId();
        UUID id = Ids.newId();
        UUID org = project.getOrgId();
        String key = ObjectStorage.orgPrefix(org) + "uploads/" + id + "/source.ifc";
        storage.put(key, "application/octet-stream", data);
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCompletion(int status) {
                        if (status == STATUS_ROLLED_BACK) storage.delete(key);
                    }
                });
        database.update("""
                INSERT INTO model_versions (id, model_id, org_id, number, file_name, size_bytes, source_key, upload_key, uploaded_by)
                VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
                """, id, model, org, filename, data.length, key, key, actor);
        event(project, actor, "model_version.created", "modelVersion", id);
        enqueue(project, version(id), actor, false);
        return id;
    }

    @Transactional
    public ModelVersion complete(UUID id, UUID actor, CompleteModelUploadRequest request) {
        Project project = projects.lock(version(id).project(), actor, "editModels");
        VersionRow row = version(id);
        checkModelActive(model(row.tree().getModelId()));
        if (row.tree().getStatus() != ModelVersionStatus.AWAITING_UPLOAD) return row.tree();
        // An upload not completed within 24 h has failed (state-machines.md), also before the hourly sweep (TF-031):
        // nothing is queued; the answer is the failed version, as for a file that isn't IFC.
        if (Boolean.TRUE.equals(database.queryForObject(
                "SELECT created_at <= now() - interval '24 hours' FROM model_versions WHERE id = ?", Boolean.class, id))) {
            storage.abort(row.upload(), row.multipart());
            expireUpload(database, json, audit, project.getOrgId(), project.getId(), id);
            return version(id).tree();      // failed, as a not_ifc upload: nothing is queued
        }
        try {
            storage.seal(row.upload(), row.source(), row.multipart(), request == null ? null : request.getParts(),
                    row.tree().getSizeBytes(), row.source().endsWith(".ifczip"));
        } catch (ApiException failure) {
            if (!failure.body().code().equals("not_ifc")) throw failure;
            database.update("""
                    UPDATE model_versions SET status = 'failed', error = CAST(? AS jsonb) WHERE id = ?
                    """, json.object(Map.of("code", "not_ifc", "message", failure.getMessage(), "retryable", false)).toString(), id);
            event(project, actor, "model_version.failed", "modelVersion", id);
            return version(id).tree();
        }
        // BR-08: a file the org has parsed before is ready at once, with no parse job (F03-AC4).
        String sha = storage.sha256(row.source());
        var summary = parses.parsedBefore(project.getOrgId(), sha, id);
        if (summary != null && parses.ready(project.getOrgId(), project.getId(), actor, id, sha, summary, null, null)) {
            return version(id).tree();
        }
        return enqueue(project, row, actor);
    }

    @Transactional
    public ModelVersion retry(UUID id, UUID actor) {
        Project project = projects.lock(version(id).project(), actor, "editModels");
        VersionRow row = version(id);
        checkModelActive(model(row.tree().getModelId()));
        if (row.tree().getStatus() != ModelVersionStatus.FAILED || !row.retryable()) {
            throw transition("Only a failed version with a retryable error can be retried.", row.tree().getStatus());
        }
        return enqueue(project, row, actor);
    }

    @Transactional
    public void delete(UUID id, UUID actor) {
        Project project = projects.lock(version(id).project(), actor, "editModels");
        var row = version(id);
        var status = row.tree().getStatus();
        if (status == ModelVersionStatus.QUEUED || status == ModelVersionStatus.PROCESSING) {
            throw transition("Wait for parsing to finish before deleting the version.", status);
        }
        // A version a BoQ uses (its inputs or a run) stays: deleting it left the BoQ unable to regenerate (TF-032).
        var usedBy = withUsage(row).getUsedBy();
        if (!usedBy.isEmpty()) {
            throw new ApiException(HttpStatus.CONFLICT, "version_in_use", "A BoQ uses this model version.",
                    Map.of("usedBy", usedBy.stream().map(ref -> Map.of("boqId", ref.getBoqId().toString(), "boqName", ref.getBoqName(),
                            "revisionId", ref.getRevisionId().toString(), "label", ref.getLabel())).toList()));
        }
        if (status == ModelVersionStatus.AWAITING_UPLOAD) storage.abort(row.upload(), row.multipart());
        database.update("UPDATE model_versions SET deleted_at = now() WHERE id = ?", id);
        database.update("""
                UPDATE models SET latest_version_id = (
                    SELECT id FROM model_versions WHERE model_id = models.id AND deleted_at IS NULL AND status = 'ready'
                    ORDER BY number DESC LIMIT 1)
                WHERE id = ? AND latest_version_id = ?
                """, row.tree().getModelId(), id);
        event(project, actor, "model_version.deleted", "modelVersion", id);
    }

    public URI geometry(UUID version, UUID actor) {
        return storage.download(ready(visibleArtifactVersion(version, actor), "geometryKey"), "private, max-age=31536000, immutable",
                "model/gltf-binary");
    }

    public SceneIndex scene(UUID version, UUID actor) {
        return readScene(visibleArtifactVersion(version, actor));
    }

    private SceneIndex readScene(VersionRow row) {
        try (var stream = storage.open(ready(row, "sceneKey"))) {
            return mapper.readValue(stream, SceneIndex.class);
        } catch (IOException error) {
            throw failure(HttpStatus.SERVICE_UNAVAILABLE, "artifact_unavailable", "Could not read the scene index.");
        }
    }

    public NamesResponse names(UUID version, UUID actor, NamesInModelRequest request) {
        var row = visible(version, actor);
        String parsed = ready(row, "parsedKey");
        Project project = projects.require(row.project(), actor);
        var docs = new ArrayList<JsonNode>();
        List<UUID> ids = request.getDictionaryVersionIds();
        if (ids == null) {
            ids = new ArrayList<>(project.getDefaults().getDictionaryVersionIds() == null
                    ? List.of() : project.getDefaults().getDictionaryVersionIds());
            ids.addAll(database.queryForList("SELECT latest_published_version_id FROM presets WHERE id = ?",
                    UUID.class, project.getProjectDictionaryId()));
        }
        for (UUID id : ids) {
            var doc = database.query("""
                    SELECT v.doc::text FROM preset_versions v JOIN presets p ON p.id = v.preset_id
                    WHERE v.id = ? AND v.status = 'published' AND p.kind = 'dictionary'
                      AND (p.layer = 'system' OR (p.org_id = ? AND (p.project_id IS NULL OR p.project_id = ?)))
                    """, (record, index) -> json.read(record.getString("doc"), JsonNode.class),
                    id, project.getOrgId(), project.getId()).stream().findFirst().orElseThrow(() ->
                    failure(HttpStatus.BAD_REQUEST, "invalid_preset", "The dictionary is unavailable for this project."));
            docs.add(doc);
        }
        if (request.getDraftDictionaries() != null) request.getDraftDictionaries().forEach(doc -> docs.add(json.object(doc)));
        return worker.rpc("names", Map.of("parsedKey", parsed, "dictionaries", docs), NamesResponse.class);
    }

    private ModelVersion enqueue(Project project, VersionRow row, UUID actor) {
        return enqueue(project, row, actor, true);
    }

    private ModelVersion enqueue(Project project, VersionRow row, UUID actor, boolean metered) {
        UUID id = row.tree().getId();
        String prefix = ObjectStorage.orgPrefix(project.getOrgId()) + "models/" + id + "/" + Ids.newId() + "/";
        UUID job = jobs.enqueue("parse", project.getOrgId(), project.getId(), actor, "modelVersion", id, prefix,
                Map.of("modelVersionId", id, "sourceKey", row.source(), "fileName", row.tree().getFileName()), 5, metered);
        database.update("UPDATE model_versions SET status = 'queued', parse_job_id = ?, error = NULL WHERE id = ?", job, id);
        event(project, actor, "model_version.queued", "modelVersion", id);
        return version(id).tree();
    }

    private VersionRow visible(UUID id, UUID actor) {
        var row = version(id);
        projects.require(row.project(), actor);
        return row;
    }

    private String ready(VersionRow row, String artifact) {
        if (row.tree().getStatus() != ModelVersionStatus.READY) {
            throw failure(HttpStatus.CONFLICT, "model_not_ready", "The model version is not ready.");
        }
        return row.artifacts().path(artifact).asText();
    }

    private ModelRow model(UUID id) {
        return database.query(MODEL_QUERY + " AND m.id = ?", this::modelRow, id).stream().findFirst()
                .orElseThrow(() -> failure(HttpStatus.NOT_FOUND, "not_found", "The model was not found."));
    }

    private VersionRow version(UUID id) {
        return database.query(VERSION_QUERY + " AND v.id = ?", this::versionRow, id).stream().findFirst()
                .orElseThrow(() -> failure(HttpStatus.NOT_FOUND, "not_found", "The model version was not found."));
    }

    private VersionRow historicalVersion(UUID id) {
        return database.query(VERSION_QUERY.replace("WHERE v.deleted_at IS NULL", "WHERE true") + " AND v.id = ?",
                this::versionRow, id).stream().findFirst()
                .orElseThrow(() -> failure(HttpStatus.NOT_FOUND, "not_found", "The model version was not found."));
    }

    private VersionRow visibleArtifactVersion(UUID version, UUID actor) {
        var row = historicalVersion(version);
        projects.require(row.project(), actor);
        if (row.deleted() && withUsage(row).getUsedBy().isEmpty()) {
            throw failure(HttpStatus.NOT_FOUND, "not_found", "The model version was not found.");
        }
        return row;
    }

    private ModelVersion withUsage(VersionRow row) {
        UUID id = row.tree().getId();
        var revisions = database.query("""
                SELECT b.id, b.name, r.id AS revision, r.label, r.status FROM boqs b
                JOIN boq_revisions r ON r.boq_id = b.id
                WHERE b.project_id = ? AND (
                    r.inputs->'models' @> jsonb_build_array(jsonb_build_object('modelVersionId', CAST(? AS text)))
                    OR EXISTS (SELECT 1 FROM runs n WHERE n.revision_id = r.id
                       AND n.snapshot_versions->'models' @> jsonb_build_array(jsonb_build_object('modelVersionId', CAST(? AS text)))))
                ORDER BY b.name, r.number
                """, (data, index) -> new RevisionRef(data.getObject("id", UUID.class), data.getString("name"),
                    data.getObject("revision", UUID.class), data.getString("label"), RevisionStatus.fromValue(data.getString("status"))),
                row.project(), id, id);
        row.tree().setUsedBy(revisions);
        return row.tree();
    }

    private Model withLatest(ModelRow row) {
        if (row.latest() != null) row.tree().setLatestVersion(version(row.latest()).tree());
        return row.tree();
    }

    private ModelRow modelRow(ResultSet result, int ignored) throws SQLException {
        var model = new Model(result.getObject("id", UUID.class), result.getObject("project_id", UUID.class),
                result.getString("name"), result.getString("discipline"), result.getBoolean("archived"))
                .versionCount(result.getInt("version_count"));
        if (result.getString("scope") != null) model.setScope(json.read(result.getString("scope"), Map.class));
        return new ModelRow(model, result.getObject("latest_version_id", UUID.class));
    }

    private VersionRow versionRow(ResultSet result, int ignored) throws SQLException {
        ModelVersion version = new ModelVersion(result.getObject("id", UUID.class), result.getObject("model_id", UUID.class),
                result.getInt("number"), result.getString("file_name"), result.getInt("size_bytes"),
                ModelVersionStatus.fromValue(result.getString("status")), result.getObject("uploaded_at", OffsetDateTime.class))
                .sha256(result.getString("sha256")).note(result.getString("note"))
                .parseJobId(result.getObject("parse_job_id", UUID.class))
                .identicalToVersion(result.getObject("identical_to_number", Integer.class))
                .summary(json.read(result.getString("summary"), ModelSummary.class)).usedBy(List.of());
        if (result.getString("uploader_name") != null) {
            version.setUploadedBy(new UserRef(result.getObject("uploaded_by", UUID.class), result.getString("uploader_name")));
        }
        JsonNode error = json.read(result.getString("error"), JsonNode.class);
        if (error != null) {
            var failure = new com.boqlet.contract.model.Error(error.path("code").asText(), error.path("message").asText());
            // TF-020: whether a retry can help; TF-037: the job's own code when it isn't one of the version's.
            var details = new java.util.LinkedHashMap<String, Object>(Map.of("retryable", error.path("retryable").asBoolean(false)));
            if (error.hasNonNull("cause")) details.put("cause", error.path("cause").asText());
            failure.setDetails(details);
            version.setError(failure);
        }
        return new VersionRow(version, result.getObject("project_id", UUID.class), result.getString("source_key"),
                result.getString("upload_key"), result.getString("multipart_id"),
                json.read(result.getString("artifacts"), JsonNode.class), error != null && error.path("retryable").asBoolean(),
                result.getObject("deleted_at") != null);
    }

    static final String DETECT = "detect";

    /**
     * The disciplines a model may have (F03 §1): the keys of the federation settings the org can use (the
     * system default and the org's own), besides "detect", which leaves it to the first version (TF-128).
     */
    static java.util.Set<String> disciplines(JdbcTemplate database, UUID org) {
        return new java.util.HashSet<>(database.queryForList("""
                SELECT DISTINCT jsonb_object_keys(v.doc->'disciplines') FROM presets p
                JOIN preset_versions v ON v.id = p.latest_published_version_id
                WHERE p.kind = 'federation' AND NOT p.archived AND (p.layer = 'system' OR p.org_id = ?)
                    AND jsonb_typeof(v.doc->'disciplines') = 'object'
                """, String.class, org));
    }

    private String discipline(UUID org, String value) {
        String discipline = nonblank(value);
        if (discipline.equals(DETECT)) return discipline;
        var allowed = disciplines(database, org);
        if (!allowed.contains(discipline)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_discipline", "Choose one of the disciplines of the federation settings.",
                    Map.of("allowed", allowed.stream().sorted().toList()));
        }
        return discipline;
    }

    /** A model's scope, checked against its schema by the engine (`ModelScope`): a typo is refused, not ignored (TF-074). */
    private String scope(Map<String, Object> scope) {
        if (scope == null) return null;
        // The generated request defaults the scope to {}: nothing to check, and creating a model mustn't need the engine.
        if (scope.isEmpty()) return json.object(scope).toString();
        var checked = worker.rpc("check", Map.of("kind", "model-scope", "doc", scope), CheckResponse.class);
        if (!Boolean.TRUE.equals(checked.getOk())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_scope", "The model's scope is not valid.",
                    Map.of("problems", checked.getProblems()));
        }
        return json.object(scope).toString();
    }

    /** An upload not completed within 24 h: the version fails with `upload_expired`, audited (TF-031). */
    public static void expireUpload(JdbcTemplate database, StoredJson json, AuditWriter audit, UUID org, UUID project, UUID version) {
        int changed = database.update("""
                UPDATE model_versions SET status = 'failed', error = CAST(? AS jsonb), multipart_id = NULL
                WHERE id = ? AND status = 'awaiting_upload'
                """, json.object(Map.of("code", "upload_expired", "message", "The upload was not completed within 24 hours.",
                        "retryable", false)).toString(), version);
        if (changed == 1) {
            audit.record(new RequestContext(null, null, org, null), AuditWriter.ActorKind.SYSTEM, project,
                    "model_version.failed", "modelVersion", version, json.object(Map.of("code", "upload_expired")));
        }
    }

    private void event(Project project, UUID actor, String action, String type, UUID subject) {
        audit.record(new RequestContext(actor, null, project.getOrgId(), null), AuditWriter.ActorKind.USER,
                project.getId(), action, type, subject, json.object(Map.of()));
    }

    private static void checkModelActive(ModelRow row) {
        if (Boolean.TRUE.equals(row.tree().getArchived())) {
            throw failure(HttpStatus.CONFLICT, "model_archived", "The model is archived.");
        }
    }

    private static String nonblank(String value) {
        if (value.isBlank()) throw failure(HttpStatus.BAD_REQUEST, "invalid_body", "Provide a non-empty value.");
        return value.strip();
    }

    /** `409 invalid_transition` naming the version's current state (state-machines.md, TF-030). */
    private static ApiException transition(String message, ModelVersionStatus state) {
        return new ApiException(HttpStatus.CONFLICT, "invalid_transition", message, Map.of("state", state.getValue()));
    }

    private static ApiException failure(HttpStatus status, String code, String message) {
        return new ApiException(status, code, message, Map.of());
    }

    private record ModelRow(Model tree, UUID latest) {}
    private record VersionRow(ModelVersion tree, UUID project, String source, String upload, String multipart,
                              JsonNode artifacts, boolean retryable, boolean deleted) {}
}
