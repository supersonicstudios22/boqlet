package com.boqlet.api.library;

import com.boqlet.api.db.Ids;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.model.Models;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.api.storage.ObjectStorage;
import com.boqlet.api.worker.Jobs;
import com.boqlet.contract.model.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class LibraryPreview {
    private final Library library;
    private final PresetCatalog catalog;
    private final Models models;
    private final ProjectAccess projects;
    private final Jobs jobs;

    LibraryPreview(Library library, PresetCatalog catalog, Models models, ProjectAccess projects, Jobs jobs) {
        this.library = library;
        this.catalog = catalog;
        this.models = models;
        this.projects = projects;
        this.jobs = jobs;
    }

    @Transactional
    public Job preview(UUID presetId, UUID actor, PreviewPresetRequest request) {
        var head = library.visible(presetId, actor);
        if (request.getModelVersionIds().isEmpty()) throw invalid("no_models", "Pick at least one model.");
        var selected = request.getModelVersionIds().stream().map(id -> models.workerModel(id, actor)).toList();
        var project = projects.lock(selected.getFirst().project(), actor, "editPresets");
        UUID org = project.getOrgId();
        if (selected.stream().anyMatch(model -> !model.project().equals(project.getId()))
                || (head.org() != null && !head.org().equals(org))
                || (head.project() != null && !head.project().equals(project.getId()))) {
            throw invalid("invalid_inputs", "Select models from the same project as the preview.");
        }
        UUID sourceId = request.getPresetVersionId();
        if (sourceId == null) sourceId = request.getDraft() && head.draft() != null ? head.draft() : head.published();
        if (sourceId == null) throw new ApiException(HttpStatus.CONFLICT, "no_draft", "This preset has no version to preview.", Map.of());
        var source = catalog.version(sourceId);
        if (!source.preset().equals(presetId) || head.unavailable() != null) throw PresetCatalog.missing();

        var defaults = project.getDefaults();
        var alternate = request.getOtherInputs();
        UUID ruleId = alternate != null && alternate.getRuleSetVersionId() != null
                ? alternate.getRuleSetVersionId() : defaults.getRuleSetVersionId().orElse(null);
        if (ruleId == null && head.kind() != PresetKind.RULE_SET) throw invalid("no_rule_set", "Choose a rule set first.");
        var rules = head.kind() == PresetKind.RULE_SET ? source : input(org, project.getId(), ruleId, PresetKind.RULE_SET, actor);
        List<UUID> classIds = alternate != null && alternate.getClassificationVersionIds() != null
                ? alternate.getClassificationVersionIds() : defaults.getClassificationVersionIds();
        var classifications = choose(org, project.getId(), classIds, PresetKind.CLASSIFICATION, head, source, actor);
        List<UUID> dictionaryIds = alternate != null && alternate.getDictionaryVersionIds() != null
                ? alternate.getDictionaryVersionIds() : defaults.getDictionaryVersionIds();
        var dictionaries = new ArrayList<PresetCatalog.Version>();
        if (dictionaryIds != null) dictionaryIds.forEach(id -> dictionaries.add(input(org, project.getId(), id, PresetKind.DICTIONARY, actor)));
        // The project dictionary's published version comes last, as in a run, unless its draft is selected.
        for (var version : catalog.dictionaries(org, project.getId(), List.of(), project.getProjectDictionaryId())) {
            if (dictionaries.stream().noneMatch(chosen -> chosen.id().equals(version.id()) || chosen.preset().equals(version.preset()))) {
                dictionaries.add(version);
            }
        }
        if (head.kind() == PresetKind.DICTIONARY) replace(dictionaries, source);
        var payload = new LinkedHashMap<String, Object>();
        payload.put("models", selected.stream().map(Models.WorkerModel::input).toList());
        payload.put("ruleSet", catalog.rules(rules).payload());
        payload.put("classifications", docs(classifications));
        payload.put("dictionaries", docs(dictionaries));
        UUID federation = alternate != null && alternate.getFederationVersionId().isPresent()
                ? alternate.getFederationVersionId().get() : defaults.getFederationVersionId().orElse(null);
        payload.put("federation", federation == null ? catalog.system(PresetKind.FEDERATION, "federation-default").doc()
                : input(org, project.getId(), federation, PresetKind.FEDERATION, actor).doc());
        UUID resolution = alternate == null ? null : alternate.getResolutionVersionId().orElse(null);
        payload.put("resolution", resolution == null ? catalog.system(PresetKind.RESOLUTION, "resolution-default").doc()
                : input(org, project.getId(), resolution, PresetKind.RESOLUTION, actor).doc());
        if (head.kind() == PresetKind.FEDERATION) payload.put("federation", source.doc());
        if (head.kind() == PresetKind.RESOLUTION) payload.put("resolution", source.doc());

        var report = new LinkedHashMap<String, Object>();
        report.put("presetVersionId", source.id());
        UUID baseline = head.published() == null ? source.parent() : head.published();
        if (Boolean.TRUE.equals(request.getCompareWithPublished()) && baseline != null && !sourceId.equals(baseline)
                && Set.of(PresetKind.RULE_SET, PresetKind.CLASSIFICATION, PresetKind.DICTIONARY).contains(head.kind())) {
            var before = catalog.version(baseline);
            var compare = new LinkedHashMap<String, Object>(Map.of("versionId", before.id(), "versionNumber", before.number()));
            if (!before.preset().equals(presetId)) compare.put("presetName", catalog.head(before.preset()).name());
            payload.put("compareWith", switch (head.kind()) {
                case RULE_SET -> Map.of("ruleSet", catalog.rules(before).payload());
                case CLASSIFICATION -> Map.of("classifications", replacement(classifications, before));
                case DICTIONARY -> Map.of("dictionaries", replacement(dictionaries, before));
                default -> throw new IllegalStateException("Unsupported preset comparison.");
            });
            report.put("compare", compare);
        }
        payload.put("previewReport", report);
        UUID job = jobs.enqueue("preview", org, project.getId(), actor, "preset", presetId,
                ObjectStorage.orgPrefix(org) + "previews/" + Ids.newId() + "/", payload, 1);
        return jobs.get(job, actor);
    }

    /** A published version available here, or the actor's own draft (TF-133); else `400 invalid_preset`. */
    private PresetCatalog.Version input(UUID org, UUID project, UUID id, PresetKind kind, UUID actor) {
        var version = catalog.version(id);
        return library.ownDraft(version, kind, org, project, actor) ? version : catalog.selected(org, project, id, kind);
    }

    private List<PresetCatalog.Version> choose(UUID org, UUID project, List<UUID> ids, PresetKind kind,
                                               PresetCatalog.Head head, PresetCatalog.Version source, UUID actor) {
        var versions = new ArrayList<PresetCatalog.Version>();
        if (ids != null) ids.forEach(id -> versions.add(input(org, project, id, kind, actor)));
        if (head.kind() == kind) replace(versions, source);
        return versions;
    }

    private static List<?> replacement(List<PresetCatalog.Version> current, PresetCatalog.Version substitute) {
        var versions = new ArrayList<>(current);
        replace(versions, substitute);
        return docs(versions);
    }

    private static void replace(List<PresetCatalog.Version> versions, PresetCatalog.Version substitute) {
        for (int i = 0; i < versions.size(); i++) {
            if (versions.get(i).preset().equals(substitute.preset())) {
                versions.set(i, substitute);
                return;
            }
        }
        versions.add(substitute);
    }

    private static List<?> docs(List<PresetCatalog.Version> versions) {
        return versions.stream().map(PresetCatalog.Version::doc).toList();
    }

    private static ApiException invalid(String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, code, message, Map.of());
    }
}
