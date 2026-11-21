package com.boqlet.api.boq;

import com.boqlet.api.db.Ids;
import com.boqlet.api.storage.ObjectStorage;
import com.boqlet.api.worker.Jobs;
import com.boqlet.contract.model.EditsImportReport;
import com.boqlet.contract.model.Job;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
class ImportEdits {
    private final BoqAccess access;
    private final RunCatalog runs;
    private final Jobs jobs;
    private final ObjectStorage storage;
    private final ArtifactReader artifacts;
    private final JdbcTemplate database;

    ImportEdits(BoqAccess access, RunCatalog runs, Jobs jobs, ObjectStorage storage,
                ArtifactReader artifacts, JdbcTemplate database) {
        this.access = access;
        this.runs = runs;
        this.jobs = jobs;
        this.storage = storage;
        this.artifacts = artifacts;
        this.database = database;
    }

    @Transactional
    public Job upload(UUID revision, UUID actor, MultipartFile file) {
        var scope = access.lockRevision(revision, actor, "editLines");
        access.checkOpen(scope, false);
        if (scope.revision().run() == null) throw BoqAccess.failure(HttpStatus.CONFLICT, "no_run", "Generate a BoQ before importing.");
        var run = runs.require(scope.revision().run());
        if (run.resultKey() == null) throw BoqAccess.failure(HttpStatus.CONFLICT, "no_run", "Generate a BoQ before importing.");
        if (file.isEmpty()) throw BoqAccess.failure(HttpStatus.BAD_REQUEST, "invalid_file", "The workbook is empty.");
        String prefix = ObjectStorage.orgPrefix(run.org()) + "imports/" + Ids.newId() + "/";
        String key = prefix + "source.xlsx";
        try {
            storage.put(key, BoqExports.XLSX, file.getBytes());
        } catch (IOException error) {
            throw BoqAccess.failure(HttpStatus.BAD_REQUEST, "invalid_file", "The workbook could not be uploaded.");
        }
        UUID job = jobs.enqueue("import_boq_edits", run.org(), run.project(), actor, "revision", revision, prefix,
                Map.of("fileKey", key, "resultKey", run.resultKey(), "boqId", scope.bill().id()), 3);
        return jobs.get(job, actor);
    }

    EditsImportReport report(UUID job, UUID actor) {
        jobs.get(job, actor);
        String key = database.query("SELECT report_key FROM edits_import_reports WHERE job_id = ?",
                (row, index) -> row.getString(1), job).stream().findFirst().orElseThrow(() -> BoqAccess.missing("edit report"));
        var report = artifacts.read(key, EditsImportReport.class);
        // The generated model starts `codes` as an empty map; a proposal that moves nothing has none (as the engine wrote it).
        for (var proposal : report.getOverrides()) {
            var edit = proposal.getEdit();
            if (edit != null && edit.getCodes() != null && edit.getCodes().isEmpty()) edit.setCodes(null);
        }
        return report;
    }
}
