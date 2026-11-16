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
    private final long uploadLimit;

    Models(JdbcTemplate database, StoredJson json, ObjectMapper mapper, ProjectAccess projects, EntitlementService limits,
           ObjectStorage storage, Jobs jobs, WorkerClient worker, AuditWriter audit,
           @Value("${boqlet.worker.max-upload-mib}") long uploadMib) {
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
        database.update("""
                INSERT INTO models (id, project_id, name, discipline, scope) VALUES (?, ?, ?, ?, CAST(? AS jsonb))
                """, id, project, nonblank(request.getName()), request.getDiscipline() == null ? "detect" : nonblank(request.getDiscipline()),
                request.getScope() == null ? null : json.object(request.getScope()).toString());
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
                request.getDiscipline() == null ? null : nonblank(request.getDiscipline()),
                request.getScope() == null ? null : json.object(request.getScope()).toString(), id);
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
                .stream().map(VersionRow::tree).toList();
    }

    public ModelVersion getVersion(UUID id, UUID actor) {
        return visible(id, actor).tree();
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
    public ModelVersion complete(UUID id, UUID actor, CompleteModelUploadRequest request) {
        Project project = projects.lock(version(id).project(), actor, "editModels");
        VersionRow row = version(id);
        checkModelActive(model(row.tree().getModelId()));
        if (row.tree().getStatus() != ModelVersionStatus.AWAITING_UPLOAD) return row.tree();
        storage.seal(row.upload(), row.source(), row.multipart(), request == null ? null : request.getParts(),
                row.tree().getSizeBytes(), row.source().endsWith(".ifczip"));
        return enqueue(project, row, actor);
    }

    @Transactional
    public ModelVersion retry(UUID id, UUID actor) {
        Project project = projects.lock(version(id).project(), actor, "editModels");
        VersionRow row = version(id);
        checkModelActive(model(row.tree().getModelId()));
        if (row.tree().getStatus() != ModelVersionStatus.FAILED || !row.retryable()) {
            throw failure(HttpStatus.CONFLICT, "invalid_transition", "Only a failed version with a retryable error can be retried.");
        }
        return enqueue(project, row, actor);
    }

    @Transactional
    public void delete(UUID id, UUID actor) {
        Project project = projects.lock(version(id).project(), actor, "editModels");
        var row = version(id);
        var status = row.tree().getStatus();
        if (status == ModelVersionStatus.QUEUED || status == ModelVersionStatus.PROCESSING) {
            throw failure(HttpStatus.CONFLICT, "invalid_transition", "Wait for parsing to finish before deleting the version.");
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
        return storage.download(ready(visible(version, actor), "geometryKey"), "private, max-age=31536000, immutable",
                "model/gltf-binary");
    }

    public SceneIndex scene(UUID version, UUID actor) {
        try (var stream = storage.open(ready(visible(version, actor), "sceneKey"))) {
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
        UUID id = row.tree().getId();
        String prefix = ObjectStorage.orgPrefix(project.getOrgId()) + "models/" + id + "/" + Ids.newId() + "/";
        UUID job = jobs.enqueue("parse", project.getOrgId(), project.getId(), actor, "modelVersion", id, prefix,
                Map.of("modelVersionId", id, "sourceKey", row.source(), "fileName", row.tree().getFileName()), 5);
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
        if (error != null) version.setError(new com.boqlet.contract.model.Error(error.path("code").asText(), error.path("message").asText()));
        return new VersionRow(version, result.getObject("project_id", UUID.class), result.getString("source_key"),
                result.getString("upload_key"), result.getString("multipart_id"),
                json.read(result.getString("artifacts"), JsonNode.class), error != null && error.path("retryable").asBoolean());
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

    private static ApiException failure(HttpStatus status, String code, String message) {
        return new ApiException(status, code, message, Map.of());
    }

    private record ModelRow(Model tree, UUID latest) {}
    private record VersionRow(ModelVersion tree, UUID project, String source, String upload, String multipart,
                              JsonNode artifacts, boolean retryable) {}
}
