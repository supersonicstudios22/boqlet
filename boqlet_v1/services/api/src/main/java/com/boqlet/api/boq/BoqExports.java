package com.boqlet.api.boq;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.api.storage.ObjectStorage;
import com.boqlet.api.worker.Jobs;
import com.boqlet.contract.model.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BoqExports {
    static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private final JdbcTemplate database;
    private final StoredJson json;
    private final Jobs jobs;
    private final Runs runs;
    private final BoqAccess boqs;
    private final ProjectAccess projects;
    private final OrgAccess orgs;
    private final EntitlementService limits;
    private final ObjectStorage storage;
    private final AuditWriter audit;

    BoqExports(JdbcTemplate database, StoredJson json, Jobs jobs, Runs runs, BoqAccess boqs, ProjectAccess projects,
               OrgAccess orgs, EntitlementService limits, ObjectStorage storage, AuditWriter audit) {
        this.database = database;
        this.json = json;
        this.jobs = jobs;
        this.runs = runs;
        this.boqs = boqs;
        this.projects = projects;
        this.orgs = orgs;
        this.limits = limits;
        this.storage = storage;
        this.audit = audit;
    }

    @Transactional
    public Job startRun(UUID runId, UUID actor, String groupBy) {
        var run = runs.visible(runId, actor);
        var scope = boqs.bill(run.boq(), actor);
        if (!runId.equals(scope.revision().run()) || scope.revision().status() == RevisionStatus.ISSUED) {
            scope = boqs.revision(run.run().getRevisionId(), actor);
        }
        var entry = schedule(scope, run, actor, groupBy, false, scope.revision().label(), null, null);
        return jobs.get(entry.job(), actor);
    }

    Scheduled schedule(BoqAccess.Scope scope, RunCatalog.Entry run, UUID actor, String groupBy, boolean frozen,
                       String label, String note, OffsetDateTime issued) {
        if (run.resultKey() == null) throw BoqAccess.failure(HttpStatus.CONFLICT, "no_run", "Generate the BoQ before exporting.");
        var project = scope.project();
        var revision = scope.revision();
        var currentId = run.run().getId();
        var settings = orgs.require(project.getOrgId(), actor).org().getSettings();
        var metadata = new LinkedHashMap<String, Object>();
        metadata.put("project", project.getName());
        metadata.put("boq", scope.bill().name());
        metadata.put("boqId", scope.bill().id().toString());
        metadata.put("revision", label);
        metadata.put("status", frozen || revision.status() == RevisionStatus.ISSUED ? "issued" : "working");
        metadata.put("generatedAt", Optional.ofNullable(run.run().getFinishedAt()).orElse(run.run().getCreatedAt()).toString());
        metadata.put("modelName", run.run().getModels() == null ? "" : run.run().getModels().stream()
                .map(RunModelsInner::getFileName).filter(Objects::nonNull).reduce((before, after) -> before + ", " + after).orElse(""));
        String group = groupBy == null ? primary(run) : groupBy;
        if (group != null) metadata.put("groupBy", group);
        metadata.put("classifications", run.run().getClassifications() == null ? List.of() : run.run().getClassifications());
        metadata.put("positionNumbers", positions(currentId, group));
        metadata.put("locale", project.getLocale());
        if (settings.getNumberFormat() != null) metadata.put("numberFormat", settings.getNumberFormat());
        if (limits.enabled(project.getOrgId(), "exportWatermark")) metadata.put("watermark", true);
        if (issued != null) {
            metadata.put("issuedAt", issued.toString());
            metadata.put("issuedBy", boqs.user(actor).getName());
        }
        if (note != null && !note.isBlank()) metadata.put("issueNote", note.strip());
        OffsetDateTime time = issued == null ? OffsetDateTime.now(java.time.ZoneOffset.UTC) : issued;
        String file = safe(project.getCode() == null ? project.getName() : project.getCode()) + "_" + safe(scope.bill().name())
                + "_Rev" + safe(label) + "_" + time.toLocalDate() + ".xlsx";
        return enqueue(project, actor, revision.id(), frozen ? "issued_boq_xlsx" : "boq_xlsx", "run", currentId,
                file, Map.of("resultKey", run.resultKey(), "meta", metadata));
    }

    public Scheduled enqueue(Project project, UUID actor, UUID revision, String kind, String subjectType,
                             UUID subject, String file, Map<String, ?> input) {
        UUID id = Ids.newId();
        UUID job = jobs.enqueue("export_xlsx", project.getOrgId(), project.getId(), actor, "export", id,
                ObjectStorage.orgPrefix(project.getOrgId()) + "exports/" + id + "/", input, 3);
        database.update("""
                INSERT INTO exports (id, org_id, project_id, revision_id, kind, subject_type, subject_id, file_name, job_id, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, id, project.getOrgId(), project.getId(), revision, kind, subjectType, subject, file, job, actor);
        record(project.getOrgId(), project.getId(), actor, "export.created", id);
        return new Scheduled(id, job);
    }

    public List<Export> list(UUID revision, UUID actor) {
        boqs.revision(revision, actor);
        return database.query("SELECT * FROM exports WHERE revision_id = ? AND storage_key IS NOT NULL ORDER BY created_at DESC",
                this::row, revision).stream().map(Entry::view).toList();
    }

    public Export get(UUID id, UUID actor) {
        return visible(id, actor).view();
    }

    @Transactional
    public URI download(UUID id, UUID actor) {
        var row = visible(id, actor);
        if (row.key() == null) throw BoqAccess.missing("export");
        if (row.view().getKind().equals("issued_boq_xlsx")) record(row.org(), row.project(), actor, "export.downloaded", id);
        return storage.downloadAttachment(row.key(), XLSX, row.view().getFileName());
    }

    Map<String, String> positions(UUID run, String group) {
        var rows = database.query("""
                SELECT line_key, line->'codes'->CAST(? AS text)->>'code' AS code FROM run_lines
                WHERE run_id = ? AND NOT coalesce((line->>'excluded')::boolean, false) ORDER BY sort_index
                """, (row, index) -> new Numbered(row.getString("line_key"), row.getString("code")), group, run);
        var counts = new HashMap<String, Integer>();
        var positions = new LinkedHashMap<String, String>();
        String separator = ".";
        if (group != null) separator = database.query("""
                SELECT v.doc->'codeList'->>'separator' AS separator FROM runs r
                CROSS JOIN LATERAL jsonb_array_elements_text(r.snapshot_versions->'classificationVersionIds') chosen(id)
                JOIN preset_versions v ON v.id = chosen.id::uuid
                WHERE r.id = ? AND v.doc->'codeList'->>'id' = ?
                """, (row, index) -> Optional.ofNullable(row.getString("separator")).filter(value -> !value.isBlank()).orElse("."),
                run, group).stream().findFirst().orElse(".");
        int index = 0;
        for (Numbered line : rows) {
            String code = line.code() == null ? "0" : line.code();
            positions.put(line.key(), group == null ? Integer.toString(++index) : code + separator + counts.merge(code, 1, Integer::sum));
        }
        return positions;
    }

    private static String primary(RunCatalog.Entry run) {
        var systems = run.run().getClassifications();
        return systems == null || systems.isEmpty() ? null : systems.getFirst().getId();
    }

    private Entry visible(UUID id, UUID actor) {
        var row = database.query("SELECT * FROM exports WHERE id = ?", this::row, id)
                .stream().findFirst().orElseThrow(() -> BoqAccess.missing("export"));
        projects.require(row.project(), actor);
        return row;
    }

    private Entry row(java.sql.ResultSet row, int ignored) throws java.sql.SQLException {
        var view = new Export(row.getObject("id", UUID.class), row.getString("kind"), row.getString("file_name"),
                row.getObject("created_at", OffsetDateTime.class)).subjectType(row.getString("subject_type"))
                .subjectId(row.getString("subject_id")).sizeBytes(row.getObject("size_bytes") == null ? null
                        : Math.toIntExact(row.getLong("size_bytes"))).jobId(row.getObject("job_id", UUID.class))
                .createdBy(boqs.user(row.getObject("created_by", UUID.class)));
        return new Entry(view, row.getObject("org_id", UUID.class), row.getObject("project_id", UUID.class), row.getString("storage_key"));
    }

    private void record(UUID org, UUID project, UUID actor, String action, UUID id) {
        audit.record(new RequestContext(actor, null, org, null), AuditWriter.ActorKind.USER, project,
                action, "export", id, json.object(Map.of()));
    }

    private static String safe(String value) {
        String clean = value.strip().replaceAll("[^\\p{L}\\p{N}_.-]+", "_");
        return clean.isEmpty() ? "boq" : clean.substring(0, Math.min(clean.length(), 64));
    }

    public record Scheduled(UUID export, UUID job) {}
    private record Entry(Export view, UUID org, UUID project, String key) {}
    private record Numbered(String key, String code) {}
}
