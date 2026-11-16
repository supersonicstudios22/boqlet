package com.boqlet.api.boq;

import com.boqlet.api.audit.AuditReader;
import com.boqlet.api.identity.Login;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.contract.api.ExportsApi;
import com.boqlet.contract.model.*;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
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

    ExportController(BoqExports exports, Diffs diffs, ImportEdits imports, Decisions decisions, AuditReader audit,
                     OrgAccess orgs, ProjectAccess projects) {
        this.exports = exports;
        this.diffs = diffs;
        this.imports = imports;
        this.decisions = decisions;
        this.audit = audit;
        this.orgs = orgs;
        this.projects = projects;
    }

    @Override
    public ResponseEntity<Job> exportRun(UUID run, ExportRunRequest request) {
        return ResponseEntity.accepted().body(exports.startRun(run, actor(), request == null ? null : request.getGroupBy()));
    }

    @Override
    public ResponseEntity<Job> exportDiff(UUID diff) { return ResponseEntity.accepted().body(diffs.export(diff, actor())); }

    @Override
    public ResponseEntity<List<Export>> listRevisionExports(UUID revision) { return ResponseEntity.ok(exports.list(revision, actor())); }

    @Override
    public ResponseEntity<Export> getExport(UUID id) { return ResponseEntity.ok(exports.get(id, actor())); }

    @Override
    public ResponseEntity<Void> downloadExport(UUID id) {
        return ResponseEntity.status(HttpStatus.FOUND).cacheControl(CacheControl.noStore()).location(exports.download(id, actor())).build();
    }

    @Override
    public ResponseEntity<Job> importBoqEdits(UUID id, MultipartFile file) {
        return ResponseEntity.accepted().body(imports.upload(id, actor(), file));
    }

    @Override
    public ResponseEntity<EditsImportReport> getEditsImportReport(UUID job) { return ResponseEntity.ok(imports.report(job, actor())); }

    @Override
    public ResponseEntity<String> exportDecisionsCsv(UUID project) {
        var out = new StringBuilder("\uFEFF");
        csv(out, "kind", "question", "question_id", "answer", "note", "decided_by", "decided_at", "used_by_latest_runs", "promoted");
        for (var row : decisions.list(project, actor(), null)) {
            var answer = row.getAnswer().orElse(null);
            csv(out, row.getKind(), row.getSummary(), row.getQuestionId(), answer == null ? "(dismissed)" : answer,
                    row.getNote(), row.getDecidedBy() == null ? "" : row.getDecidedBy().getName(), row.getDecidedAt(),
                    Boolean.TRUE.equals(row.getUsedByLatestRuns()) ? "yes" : "no", row.getPromotedToPresetVersionId().orElse(null) != null ? "yes" : "no");
        }
        return csvResponse("decisions.csv", out);
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
        var out = new StringBuilder("\uFEFF");
        csv(out, "at", "actor", "actor_kind", "action", "entity_type", "entity_id", "data");
        String cursor = null;
        do {
            var page = audit.page(org, project, cursor, 1000, user, action, entity, from, to);
            for (var row : page.getItems()) {
                csv(out, row.getAt(), row.getActor() == null ? "" : row.getActor().getName(),
                        row.getActorKind(), row.getAction(), row.getEntityType(), row.getEntityId(), row.getData());
            }
            cursor = page.getNextCursor().orElse(null);
        } while (cursor != null);
        return csvResponse("audit.csv", out);
    }

    private static void csv(StringBuilder out, Object... values) {
        out.append(java.util.Arrays.stream(values).map(value -> {
            String text = value == null ? "" : value.toString();
            if (value instanceof String && text.stripLeading().matches("(?s)^[=+@-].*")) text = "'" + text;
            return "\"" + text.replace("\"", "\"\"") + "\"";
        }).collect(Collectors.joining(","))).append("\r\n");
    }

    private static ResponseEntity<String> csvResponse(String file, StringBuilder data) {
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, "text/csv; charset=utf-8")
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + file + "\"").body(data.toString());
    }

    private static UUID actor() { return Login.current().userId(); }
}
