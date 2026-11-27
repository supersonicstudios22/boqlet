package com.boqlet.api.boq;

import com.boqlet.api.audit.AuditReader;
import com.boqlet.api.identity.Login;
import com.boqlet.api.http.Csv;
import com.boqlet.api.http.Idempotency;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.contract.api.ExportsApi;
import com.boqlet.contract.model.*;
import java.time.OffsetDateTime;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
class ExportController implements ExportsApi {
    private final BoqExports exports;
    private final Diffs diffs;
    private final ImportEdits imports;
    private final Decisions decisions;
    private final AuditReader audit;
    private final OrgAccess orgs;
    private final ProjectAccess projects;
    private final BoqAccess boqs;
    private final Runs runs;
    private final Idempotency idempotency;
    private final JdbcTemplate database;
    private final ObjectMapper json;

    ExportController(BoqExports exports, Diffs diffs, ImportEdits imports, Decisions decisions, AuditReader audit,
                     OrgAccess orgs, ProjectAccess projects, BoqAccess boqs, Runs runs, Idempotency idempotency,
                     JdbcTemplate database, ObjectMapper json) {
        this.database = database;
        this.json = json;
        this.exports = exports;
        this.diffs = diffs;
        this.imports = imports;
        this.decisions = decisions;
        this.audit = audit;
        this.orgs = orgs;
        this.projects = projects;
        this.boqs = boqs;
        this.runs = runs;
        this.idempotency = idempotency;
    }

    @Override
    public ResponseEntity<Job> exportRun(UUID run, UUID idempotencyKey, ExportRunRequest request) {
        UUID actor = actor();
        return ResponseEntity.accepted().body(idempotency.once(actor, idempotencyKey, 202, Job.class,
                () -> runs.visible(run, actor), () -> exports.startRun(run, actor, request == null ? null : request.getGroupBy())));
    }

    @Override
    public ResponseEntity<Job> exportDiff(UUID diff, UUID idempotencyKey) {
        UUID actor = actor();
        return ResponseEntity.accepted().body(idempotency.once(actor, idempotencyKey, 202, Job.class,
                () -> diffs.get(diff, actor), () -> diffs.export(diff, actor)));
    }

    @Override
    public ResponseEntity<List<Export>> listRevisionExports(UUID revision) { return ResponseEntity.ok(exports.list(revision, actor())); }

    @Override
    public ResponseEntity<Export> getExport(UUID id) { return ResponseEntity.ok(exports.get(id, actor())); }

    @Override
    public ResponseEntity<Void> downloadExport(UUID id) {
        return ResponseEntity.status(HttpStatus.FOUND).cacheControl(CacheControl.noStore()).location(exports.download(id, actor())).build();
    }

    @Override
    public ResponseEntity<Job> importBoqEdits(UUID id, MultipartFile file, UUID idempotencyKey) {
        UUID actor = actor();
        return ResponseEntity.accepted().body(idempotency.once(actor, idempotencyKey, 202, Job.class,
                () -> boqs.revision(id, actor), () -> imports.upload(id, actor, file)));
    }

    @Override
    public ResponseEntity<EditsImportReport> getEditsImportReport(UUID job) { return ResponseEntity.ok(imports.report(job, actor())); }

    @Override
    public ResponseEntity<String> exportDecisionsCsv(UUID project) {
        var out = new Csv().row("kind", "question", "question_id", "answer", "note", "decided_by", "decided_at", "used_by_latest_runs", "promoted");
        for (var row : decisions.list(project, actor(), null)) {
            var answer = row.getAnswer().orElse(null);
            out.row(row.getKind(), row.getSummary(), row.getQuestionId(), answer == null ? "(dismissed)" : answer,
                    row.getNote(), row.getDecidedBy() == null ? "" : row.getDecidedBy().getName(), row.getDecidedAt(),
                    Boolean.TRUE.equals(row.getUsedByLatestRuns()) ? "yes" : "no", row.getPromotedToPresetVersionId().orElse(null) != null ? "yes" : "no");
        }
        return out.download("decisions.csv");
    }

    @Override
    public ResponseEntity<String> exportOrgAuditCsv(UUID org, String user, String action, String entity,
                                                   OffsetDateTime from, OffsetDateTime to) {
        OrgAccess.checkRole(orgs.require(org, actor()).role(), OrgRole.OWNER, OrgRole.ADMIN);
        return auditCsv(org, null, user, action, entity, from, to);
    }

    @Override
    public ResponseEntity<String> exportProjectAuditCsv(UUID project, String user, String action, String entity,
                                                       OffsetDateTime from, OffsetDateTime to) {
        var details = projects.require(project, actor());
        projects.role(details, "seeAudit");
        return auditCsv(details.getOrgId(), project, user, action, entity, from, to);
    }

    private ResponseEntity<String> auditCsv(UUID org, UUID project, String user, String action, String entity,
                                           OffsetDateTime from, OffsetDateTime to) {
        // F12 "Audit CSV": actor is the person's name or "system", project its name, data JSON.
        var out = new Csv().row("at", "actor", "action", "entityType", "entityId", "project", "data");
        var projectNames = new java.util.HashMap<UUID, String>();
        String cursor = null;
        do {
            var page = audit.page(org, project, cursor, 1000, user, action, entity, from, to);
            for (var row : page.getItems()) {
                UUID projectId = row.getProjectId() == null ? null : row.getProjectId().orElse(null);
                String projectName = projectId == null ? "" : projectNames.computeIfAbsent(projectId, id -> database
                        .query("SELECT name FROM projects WHERE id = ?", (result, index) -> result.getString(1), id)
                        .stream().findFirst().orElse(id.toString()));
                String data;
                try {
                    data = json.writeValueAsString(row.getData() == null ? Map.of() : row.getData());
                } catch (JsonProcessingException failed) {
                    throw new IllegalStateException(failed);
                }
                out.row(row.getAt(), row.getActor() == null ? "system" : row.getActor().getName(),
                        row.getAction(), row.getEntityType(), row.getEntityId(), projectName, data);
            }
            cursor = page.getNextCursor().orElse(null);
        } while (cursor != null);
        return out.download("audit.csv");
    }

    private static UUID actor() { return Login.current().userId(); }
}
