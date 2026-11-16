package com.boqlet.api.boq;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.library.PresetCatalog;
import com.boqlet.api.model.Models;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.api.storage.ObjectStorage;
import com.boqlet.api.worker.Jobs;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class Runs {
    private final JdbcTemplate database;
    private final StoredJson json;
    private final BoqAccess access;
    private final RunCatalog catalog;
    private final ProjectAccess projects;
    private final PresetCatalog presets;
    private final Models models;
    private final BoqInputs inputs;
    private final Jobs jobs;
    private final AuditWriter audit;
    private final ObjectStorage storage;

    Runs(JdbcTemplate database, StoredJson json, BoqAccess access, RunCatalog catalog, ProjectAccess projects, PresetCatalog presets,
         Models models, BoqInputs inputs, Jobs jobs, AuditWriter audit, ObjectStorage storage) {
        this.database = database;
        this.json = json;
        this.access = access;
        this.catalog = catalog;
        this.projects = projects;
        this.presets = presets;
        this.models = models;
        this.inputs = inputs;
        this.jobs = jobs;
        this.audit = audit;
        this.storage = storage;
    }

    @Transactional
    public GenerateRun202Response generate(UUID revision, UUID actor) {
        var scope = access.lockRevision(revision, actor, "editBoqs");
        access.checkOpen(scope, false);
        var revisionInputs = scope.revision().inputs();
        if (revisionInputs.getModels().isEmpty()) {
            throw BoqAccess.failure(HttpStatus.CONFLICT, "no_models", "Choose at least one model for this BoQ.");
        }
        UUID existing = database.query("SELECT id FROM runs WHERE revision_id = ? AND status IN ('queued','running')",
                (row, index) -> row.getObject("id", UUID.class), revision).stream().findFirst().orElse(null);
        if (existing != null) {
            Run run = catalog.require(existing).run();
            return new GenerateRun202Response(run, jobs.get(run.getJobId(), actor));
        }
        Project project = scope.project();
        inputs.validate(project, actor, revisionInputs);
        var snapshot = inputs.snapshot(project, scope.bill().id(), revisionInputs);
        var versions = new ArrayList<Map<String, Object>>();
        var workerModels = new ArrayList<Map<String, Object>>();
        for (var chosen : revisionInputs.getModels()) {
            var model = models.workerModel(chosen.getModelVersionId(), actor);
            var item = new LinkedHashMap<>(model.input());
            item.put("discipline", chosen.getDiscipline());
            item.put("scope", chosen.getScope() == null ? Map.of() : chosen.getScope());
            workerModels.add(item);
            versions.add(Map.of("modelId", chosen.getModelId(), "modelVersionId", chosen.getModelVersionId(),
                    "discipline", chosen.getDiscipline(), "traceId", chosen.getModelVersionId().toString()));
        }
        UUID org = project.getOrgId();
        UUID projectId = project.getId();
        var dictionary = presets.dictionaries(org, projectId, revisionInputs.getDictionaryVersionIds(), project.getProjectDictionaryId());
        var classifications = revisionInputs.getClassificationVersionIds().stream()
                .map(id -> presets.selected(org, projectId, id, PresetKind.CLASSIFICATION)).toList();
        var systems = classifications.stream().map(version -> Map.of(
                "id", version.doc().path("codeList").path("id").asText(), "name", version.doc().path("codeList").path("name").asText())).toList();
        var versionsDoc = Map.of("ruleSetVersionId", revisionInputs.getRuleSetVersionId(), "models", versions,
                "dictionaryVersionIds", dictionary.stream().map(PresetCatalog.Version::id).toList(),
                "classificationVersionIds", revisionInputs.getClassificationVersionIds());
        var ruleSet = presets.selected(org, projectId, revisionInputs.getRuleSetVersionId(), PresetKind.RULE_SET);
        UUID federation = revisionInputs.getFederationVersionId().orElse(null);
        UUID resolution = revisionInputs.getResolutionVersionId().orElse(null);
        var jobInput = new LinkedHashMap<String, Object>();
        jobInput.put("models", workerModels);
        jobInput.put("ruleSet", presets.rules(ruleSet).payload());
        jobInput.put("classifications", classifications.stream().map(PresetCatalog.Version::doc).toList());
        jobInput.put("dictionaries", dictionary.stream().map(PresetCatalog.Version::doc).toList());
        jobInput.put("federation", (federation == null ? presets.system(PresetKind.FEDERATION, "federation-default")
                : presets.selected(org, projectId, federation, PresetKind.FEDERATION)).doc());
        jobInput.put("resolution", (resolution == null ? presets.system(PresetKind.RESOLUTION, "resolution-default")
                : presets.selected(org, projectId, resolution, PresetKind.RESOLUTION)).doc());
        jobInput.put("decisions", decisions(snapshot));
        jobInput.put("manualItems", manualItems(snapshot));
        jobInput.put("unitSystem", project.getUnitSystem().getValue());
        UUID run = Ids.newId();
        jobInput.put("runId", run);
        UUID job = jobs.enqueue("run", org, projectId, actor, "run", run,
                ObjectStorage.orgPrefix(org) + "runs/" + run + "/", jobInput, 0);
        database.update("""
                INSERT INTO runs (id, revision_id, org_id, job_id, snapshot_versions, input_snapshot, classifications, created_by)
                VALUES (?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), CAST(? AS jsonb), ?)
                """, run, revision, org, job, json.object(versionsDoc).toString(), snapshot.toString(),
                json.object(Map.of("systems", systems)).path("systems").toString(), actor);
        audit.record(new RequestContext(actor, null, org, null), AuditWriter.ActorKind.USER, projectId,
                "run.created", "run", run, json.object(Map.of("revisionId", revision)));
        return new GenerateRun202Response(catalog.require(run).run(), jobs.get(job, actor));
    }

    public RunCatalog.Entry visible(UUID id, UUID actor) {
        var run = catalog.require(id);
        projects.require(run.project(), actor);
        return run;
    }

    List<Run> list(UUID revision, UUID actor) {
        access.revision(revision, actor);
        return catalog.revisions(revision).stream().map(RunCatalog.Entry::run).toList();
    }

    URI result(UUID id, UUID actor) {
        var run = visible(id, actor);
        if (run.resultKey() == null) throw BoqAccess.missing("run result");
        return storage.download(run.resultKey(), "private, no-store", "application/gzip");
    }

    private List<ObjectNode> decisions(ObjectNode snapshot) {
        var result = new ArrayList<ObjectNode>();
        for (JsonNode row : snapshot.path("decisions")) {
            var decision = json.object(Map.of("questionId", row.path("questionId").asText(), "scope", "project"));
            decision.set("answer", row.get("answer"));
            if (row.has("note")) decision.set("note", row.get("note"));
            result.add(decision);
        }
        for (JsonNode row : snapshot.path("overrides")) {
            var override = json.object(row);
            String lineKey = override.path("lineKey").asText();
            override.remove(List.of("lineKey", "sortAfter"));
            if (!override.isEmpty()) result.add(json.object(Map.of("questionId", "override:" + lineKey,
                    "scope", "project", "answer", override)));
        }
        return result;
    }

    private List<ObjectNode> manualItems(ObjectNode snapshot) {
        var result = new ArrayList<ObjectNode>();
        for (JsonNode row : snapshot.path("manualItems")) {
            var item = json.object(row.path("item"));
            if (row.has("codes")) item.set("codes", row.get("codes"));
            result.add(item);
        }
        return result;
    }
}
