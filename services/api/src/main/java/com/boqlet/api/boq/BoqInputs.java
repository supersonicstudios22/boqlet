package com.boqlet.api.boq;

import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.library.PresetCatalog;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.*;
import org.openapitools.jackson.nullable.JsonNullable;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class BoqInputs {
    private final JdbcTemplate database;
    private final StoredJson json;
    private final PresetCatalog catalog;
    private final EntitlementService limits;
    private final com.boqlet.api.worker.WorkerClient worker;

    BoqInputs(JdbcTemplate database, StoredJson json, PresetCatalog catalog, EntitlementService limits,
              com.boqlet.api.worker.WorkerClient worker) {
        this.worker = worker;
        this.database = database;
        this.json = json;
        this.catalog = catalog;
        this.limits = limits;
    }

    RevisionInputs defaults(Project project) {
        var defaults = project.getDefaults();
        var models = database.query("""
                SELECT m.id, m.latest_version_id, m.discipline, m.scope::text AS scope
                FROM models m WHERE m.project_id = ? AND NOT m.archived AND m.latest_version_id IS NOT NULL
                ORDER BY m.created_at, m.id
                """, (row, index) -> {
            var input = new RevisionModelInput(row.getObject("id", UUID.class),
                    row.getObject("latest_version_id", UUID.class), row.getString("discipline"));
            if (row.getString("scope") != null) input.setScope(json.read(row.getString("scope"), Map.class));
            return input;
        }, project.getId());
        UUID ruleSet = defaults.getRuleSetVersionId().orElse(null);
        if (ruleSet == null) ruleSet = catalog.system(PresetKind.RULE_SET, "as-modelled").id();
        return new RevisionInputs(models, ruleSet,
                defaults.getClassificationVersionIds() == null ? List.of() : defaults.getClassificationVersionIds(),
                defaults.getDictionaryVersionIds() == null ? List.of() : defaults.getDictionaryVersionIds())
                .federationVersionId(defaults.getFederationVersionId().orElse(null)).resolutionVersionId(null);
    }

    RevisionInputs merge(RevisionInputs current, RevisionInputsPartial patch) {
        if (patch == null) return current;
        var base = json.object(current);
        var changes = json.object(patch);
        changes.fields().forEachRemaining(field -> {
            if (!field.getValue().isNull() || Set.of("federationVersionId", "resolutionVersionId").contains(field.getKey())) {
                base.set(field.getKey(), field.getValue());
            }
        });
        return json.read(base.toString(), RevisionInputs.class);
    }

    void validate(Project project, UUID actor, RevisionInputs input) {
        limits.checkSize(project.getOrgId(), actor, "maxModelsPerBoq", BigDecimal.valueOf(input.getModels().size()));
        var modelIds = new HashSet<UUID>();
        for (RevisionModelInput model : input.getModels()) {
            if (!modelIds.add(model.getModelId())) throw invalid("A model can be selected only once.");
            if (!Boolean.TRUE.equals(database.queryForObject("""
                    SELECT EXISTS (
                        SELECT 1 FROM model_versions v JOIN models m ON m.id = v.model_id
                        WHERE v.id = ? AND m.id = ? AND m.project_id = ? AND NOT m.archived AND v.deleted_at IS NULL)
                    """, Boolean.class, model.getModelVersionId(), model.getModelId(), project.getId()))) {
                throw invalid("A selected model version is unavailable in this project.");
            }
            model.setNewerVersionAvailable(JsonNullable.undefined());
        }
        if (input.getRuleSetVersionId() == null) throw invalid("Select a rule set.");
        require(project, input.getRuleSetVersionId(), PresetKind.RULE_SET);
        requireList(project, input.getClassificationVersionIds(), PresetKind.CLASSIFICATION);
        requireList(project, input.getDictionaryVersionIds(), PresetKind.DICTIONARY);
        for (UUID id : input.getDictionaryVersionIds()) {
            if (catalog.version(id).preset().equals(project.getProjectDictionaryId())) {
                throw invalid("The project dictionary is included automatically.");
            }
        }
        require(project, input.getFederationVersionId().orElse(null), PresetKind.FEDERATION);
        require(project, input.getResolutionVersionId().orElse(null), PresetKind.RESOLUTION);
    }

    ObjectNode snapshot(Project project, UUID boq, RevisionInputs inputs) {
        var snapshot = json.object(Map.of("inputs", inputs, "decisions", decisions(project.getId()),
                "overrides", overrides(boq, false), "manualItems", manualItems(boq, false)));
        if (project.getProjectDictionaryId() != null) {
            UUID dictionary = catalog.head(project.getProjectDictionaryId()).published();
            if (dictionary != null) snapshot.put("projectDictionaryVersionId", dictionary.toString());
        }
        return snapshot;
    }

    List<String> changes(ObjectNode before, ObjectNode after) {
        return changes(before, after, null);
    }

    /**
     * What changed between a run's snapshot and the current state. With `asked` (the question ids the run
     * asked), only what can alter that run counts (BR-23, backend.md "Pending changes", TF-029): decisions
     * for those questions or for the ones it applied, and project-dictionary entries other than the
     * answers to questions the run didn't ask. A decision about another BoQ's question is not pending.
     */
    List<String> changes(ObjectNode before, ObjectNode after, Set<String> asked) {
        var out = new ArrayList<String>();
        Set<String> relevant = null;
        if (asked != null) {
            relevant = new HashSet<>(asked);
            relevant.addAll(answers(before).keySet());
        }
        var oldInputs = before.path("inputs");
        var inputs = after.path("inputs");
        if (!modelsById(oldInputs.path("models")).equals(modelsById(inputs.path("models")))) out.add("inputs.models");
        if (!equal(oldInputs, inputs, "ruleSetVersionId")) out.add("inputs.ruleSet");
        if (!equal(oldInputs, inputs, "classificationVersionIds")) out.add("inputs.classifications");
        if (!equal(oldInputs, inputs, "dictionaryVersionIds") || !equal(before, after, "projectDictionaryVersionId")
                && (relevant == null || projectDictionaryChanged(before, after, relevant))) {
            out.add("inputs.dictionaries");
        }
        if (!equal(oldInputs, inputs, "federationVersionId")) out.add("inputs.federation");
        if (!equal(oldInputs, inputs, "resolutionVersionId")) out.add("inputs.resolution");
        if (!answers(before, relevant).equals(answers(after, relevant))) out.add("decisions");
        if (!equal(before, after, "overrides") || !equal(before, after, "manualItems")) out.add("adjustments");
        return out;
    }

    List<ObjectNode> decisions(UUID project) {
        return database.query("""
                SELECT question_id, kind, answer::text, question::text, note FROM decisions WHERE project_id = ? AND superseded_at IS NULL
                ORDER BY question_id
                """, (row, index) -> {
            var decision = json.object(Map.of("questionId", row.getString("question_id"), "kind", row.getString("kind")));
            decision.set("answer", json.read(row.getString("answer"), JsonNode.class));
            if (row.getString("question") != null) decision.set("question", json.read(row.getString("question"), JsonNode.class));
            if (row.getString("note") != null) decision.put("note", row.getString("note"));
            return decision;
        }, project);
    }

    List<ObjectNode> overrides(UUID boq, boolean metadata) {
        return database.query("""
                SELECT e.*, u.name AS author FROM line_overrides e
                LEFT JOIN users u ON u.id = e.created_by AND u.deleted_at IS NULL
                WHERE e.boq_id = ? ORDER BY e.line_key
                """, (row, index) -> adjustment(row, "edit", metadata), boq);
    }

    List<ObjectNode> manualItems(UUID boq, boolean metadata) {
        return database.query("""
                SELECT e.*, u.name AS author FROM manual_items e
                LEFT JOIN users u ON u.id = e.created_by AND u.deleted_at IS NULL
                WHERE e.boq_id = ? ORDER BY e.item->'item'->>'id', e.id
                """, (row, index) -> adjustment(row, "item", metadata), boq);
    }

    private ObjectNode adjustment(java.sql.ResultSet row, String column, boolean metadata) throws java.sql.SQLException {
        var data = json.read(row.getString(column), ObjectNode.class);
        if (metadata) {
            data.put("id", row.getString("id")).put("boqId", row.getString("boq_id"))
                    .put("createdAt", row.getObject("created_at", java.time.OffsetDateTime.class).toString());
            if (row.getString("author") != null) {
                data.set("createdBy", json.object(Map.of("id", row.getString("created_by"), "name", row.getString("author"))));
            }
        }
        return data;
    }

    /** A model's scope in a revision's inputs is checked by the engine like the model's own (TF-074): a typo is refused. */
    void scopes(RevisionInputs input) {
        for (RevisionModelInput model : input.getModels()) scope(model.getScope());
    }

    private void scope(Map<String, Object> scope) {
        if (scope == null || scope.isEmpty()) return;
        var checked = worker.rpc("check", Map.of("kind", "model-scope", "doc", scope), CheckResponse.class);
        if (!Boolean.TRUE.equals(checked.getOk())) {
            throw new com.boqlet.api.http.ApiException(HttpStatus.BAD_REQUEST, "invalid_scope", "A model's scope is not valid.",
                    Map.of("problems", checked.getProblems()));
        }
    }

    /** A revision's inputs answer `invalid_inputs` (F04 §2), like every other input problem of a revision. */
    private void require(Project project, UUID version, PresetKind kind) {
        if (version == null) return;
        try {
            catalog.selected(project.getOrgId(), project.getId(), version, kind);
        } catch (com.boqlet.api.http.ApiException unavailable) {
            if (unavailable.status() != org.springframework.http.HttpStatus.BAD_REQUEST) throw unavailable;
            throw invalid("A selected preset isn't a published " + kind.getValue().replace('_', ' ') + " available in this project.");
        }
    }

    private void requireList(Project project, List<UUID> ids, PresetKind kind) {
        if (ids == null || ids.stream().anyMatch(Objects::isNull) || new HashSet<>(ids).size() != ids.size()) {
            throw invalid("A preset selection is incomplete or repeated.");
        }
        ids.forEach(id -> require(project, id, kind));
    }

    private static Map<String, JsonNode> modelsById(JsonNode models) {
        var byId = new HashMap<String, JsonNode>();
        for (JsonNode model : models) byId.put(model.path("modelId").asText(), model);
        return byId;
    }

    private static Map<String, JsonNode> answers(JsonNode snapshot) {
        return answers(snapshot, null);
    }

    private static Map<String, JsonNode> answers(JsonNode snapshot, Set<String> relevant) {
        var answers = new TreeMap<String, JsonNode>();
        for (JsonNode decision : snapshot.path("decisions")) {
            String id = decision.path("questionId").asText();
            if (relevant == null || relevant.contains(id)) answers.put(id, decision.get("answer"));
        }
        return answers;
    }

    /** The project dictionary's entries differ beyond answers (`answer:<field>:<raw>`) to questions the run didn't ask. */
    private boolean projectDictionaryChanged(JsonNode before, JsonNode after, Set<String> relevant) {
        var old = entries(before.path("projectDictionaryVersionId"));
        var now = entries(after.path("projectDictionaryVersionId"));
        var ids = new HashSet<>(old.keySet());
        ids.addAll(now.keySet());
        for (String id : ids) {
            if (Objects.equals(old.get(id), now.get(id))) continue;
            if (!id.startsWith("answer:") || relevant.contains("name:" + id.substring("answer:".length()))) return true;
        }
        return false;
    }

    private Map<String, JsonNode> entries(JsonNode version) {
        var out = new HashMap<String, JsonNode>();
        if (!version.isTextual()) return out;
        for (JsonNode entry : catalog.version(UUID.fromString(version.asText())).doc().path("entries")) {
            out.put(entry.path("id").asText(), entry);
        }
        return out;
    }

    private static boolean equal(JsonNode before, JsonNode after, String property) {
        var first = before.get(property);
        var second = after.get(property);
        return Objects.equals(first == null || first.isNull() ? null : first, second == null || second.isNull() ? null : second);
    }

    static com.boqlet.api.http.ApiException invalid(String message) {
        return BoqAccess.failure(HttpStatus.BAD_REQUEST, "invalid_inputs", message);
    }
}
