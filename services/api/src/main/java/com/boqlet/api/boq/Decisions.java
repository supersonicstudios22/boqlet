package com.boqlet.api.boq;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.library.Library;
import com.boqlet.api.library.PresetCatalog;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class Decisions {
    /** The contract's `maxLength` of a text answer (`DecisionInput.answer` is a scalar of any type, TF-174). */
    private static final int MAX_ANSWER = 4000;
    private static final Set<String> KINDS = Set.of("unknown_name", "missing_data", "unmatched", "double_claim", "unclassified",
            "classification_conflict", "contradiction", "overlap", "orphan_override");
    private final JdbcTemplate database;
    private final StoredJson json;
    private final ProjectAccess projects;
    private final OrgAccess orgs;
    private final Library library;
    private final PresetCatalog presets;
    private final BoqAccess access;
    private final Boqs boqs;
    private final AuditWriter audit;

    Decisions(JdbcTemplate database, StoredJson json, ProjectAccess projects, OrgAccess orgs, Library library,
              PresetCatalog presets, BoqAccess access, Boqs boqs, AuditWriter audit) {
        this.database = database;
        this.json = json;
        this.projects = projects;
        this.orgs = orgs;
        this.library = library;
        this.presets = presets;
        this.access = access;
        this.boqs = boqs;
        this.audit = audit;
    }

    record Saved(UUID id, UUID project, String key, String kind, JsonNode answer, String note, JsonNode question,
                 UUID actor, OffsetDateTime decidedAt, UUID promoted) {}

    public List<Decision> list(UUID project, UUID actor, String kind) {
        projects.require(project, actor);
        return active(project).stream().filter(row -> kind == null || row.kind().equals(kind)).map(this::view).toList();
    }

    @Transactional
    public UpsertDecisions200Response save(UUID project, UUID actor, UpsertDecisionsRequest request, boolean dryRun) {
        var scope = dryRun ? projects.require(project, actor) : projects.lock(project, actor, "answerQuestions");
        projects.role(scope, "answerQuestions");
        if (scope.getStatus() == Project.StatusEnum.ARCHIVED) throw BoqAccess.failure(HttpStatus.CONFLICT,
                "project_archived", "The project is archived and read-only.");
        if (request.getDecisions().isEmpty()) throw invalid("invalid_body", "Send at least one decision.");
        var prior = new HashMap<String, Saved>();
        active(project).forEach(row -> prior.put(row.key(), row));
        var seen = new HashSet<String>();
        var updated = new LinkedHashSet<String>();
        var rows = new ArrayList<Saved>();
        var additions = new ArrayList<Saved>();
        OffsetDateTime at = OffsetDateTime.now(ZoneOffset.UTC);
        for (var input : request.getDecisions()) {
            // `answer: null` is an answer (dismiss: leave it, F05 §3); only a missing answer is refused.
            var provided = input.getAnswer();
            String key = input.getQuestionId();
            if (key.isBlank() || !seen.add(key) || !KINDS.contains(input.getKind()) || provided == null || !provided.isPresent()) {
                throw invalid("invalid_body", "Provide a unique question, a supported kind and an answer.");
            }
            Saved existing = prior.get(key);
            JsonNode stored = question(project, key);
            if (stored == null && existing != null) stored = existing.question();
            JsonNode answer = json.tree(provided.get());
            check(key, input.getKind(), answer, stored, project, actor);
            String note = input.getNote() == null || input.getNote().isBlank() ? null : input.getNote().strip();
            boolean answerChanged = existing == null || !same(existing.answer(), answer);
            if (answerChanged) updated.add(key);
            if (!answerChanged && Objects.equals(existing.note(), note)) {
                rows.add(existing);
            } else {
                var addition = new Saved(Ids.newId(), project, key, input.getKind(), answer, note, stored, actor, at, null);
                rows.add(addition);
                additions.add(addition);
            }
        }
        var affected = affected(project, updated);
        if (!dryRun) {
            var dictionary = new ArrayList<ObjectNode>();
            for (Saved addition : additions) {
                database.update("UPDATE decisions SET superseded_at = ? WHERE project_id = ? AND question_id = ? AND superseded_at IS NULL",
                        at, project, addition.key());
                database.update("""
                        INSERT INTO decisions (id, project_id, question_id, kind, answer, question, note, decided_by, decided_at)
                        VALUES (?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?, ?, ?)
                        """, addition.id(), project, addition.key(), addition.kind(), addition.answer().toString(),
                        addition.question() == null ? null : addition.question().toString(), addition.note(), actor, at);
                event(scope, actor, "decision.set", addition, Map.of());
                if (!Boolean.FALSE.equals(request.getAddToProjectDictionary()) && promotable(addition)) {
                    dictionary.add(entry(addition, access.user(actor).getName(), at));
                }
            }
            if (!dictionary.isEmpty() && scope.getProjectDictionaryId() != null) {
                library.publishDictionaryEntries(scope.getProjectDictionaryId(), actor, dictionary, "Project decisions");
            }
            withdraw(affected, actor);
        }
        if (!dryRun) affected.forEach(revision -> revision.setStatus(RevisionStatus.DRAFT));
        return new UpsertDecisions200Response(rows.stream().map(this::view).toList(), affected);
    }

    @Transactional
    public void clear(UUID id, UUID actor) {
        var row = require(id);
        var project = projects.lock(row.project(), actor, "answerQuestions");
        if (database.update("UPDATE decisions SET superseded_at = now() WHERE id = ? AND superseded_at IS NULL", id) != 1) {
            throw BoqAccess.missing("decision");
        }
        withdraw(affected(row.project(), Set.of(row.key())), actor);
        event(project, actor, "decision.cleared", row, Map.of());
    }

    @Transactional
    public PresetVersion promote(UUID id, UUID actor, UUID target) {
        var row = require(id);
        Project project = projects.require(row.project(), actor);
        orgs.lock(project.getOrgId(), actor, OrgRole.OWNER, OrgRole.ADMIN, OrgRole.LIBRARY_EDITOR);
        row = require(id);
        if (!promotable(row)) throw BoqAccess.failure(HttpStatus.CONFLICT, "not_promotable", "Only a name answer can be promoted.");
        var head = presets.head(target);
        if (!project.getOrgId().equals(head.org()) || head.layer() != PresetLayer.ORG || head.kind() != PresetKind.DICTIONARY || head.archived()) {
            throw invalid("invalid_preset", "Choose a company dictionary from this organisation.");
        }
        var version = library.publishDictionaryEntries(target, actor,
                List.of(entry(row, access.user(actor).getName(), OffsetDateTime.now(ZoneOffset.UTC))), "Promoted project decision");
        database.update("UPDATE decisions SET promoted_to_preset_version_id = ? WHERE id = ?", version.getId(), id);
        event(project, actor, "decision.promoted", row, Map.of("presetVersionId", version.getId()));
        return version;
    }

    List<QuestionWithDecision> questions(RunCatalog.Entry run) {
        var current = new HashMap<String, Saved>();
        active(run.project()).forEach(row -> current.put(row.key(), row));
        var original = new HashMap<String, JsonNode>();
        var rows = new LinkedHashMap<String, ObjectNode>();
        database.query("SELECT question::text FROM run_questions WHERE run_id = ? ORDER BY sort_index", row -> {
            var question = json.read(row.getString(1), ObjectNode.class);
            rows.put(question.path("id").asText(), question);
        }, run.run().getId());
        for (JsonNode applied : run.snapshot().path("decisions")) {
            var key = applied.path("questionId").asText();
            original.put(key, applied.get("answer"));
            if (applied.path("question").isObject()) rows.putIfAbsent(key, json.object(applied.path("question")));
        }
        var ordered = new ArrayList<>(rows.values());
        ordered.sort(Comparator.<ObjectNode, Boolean>comparing(row -> current.containsKey(row.path("id").asText()))
                .thenComparing(row -> !row.path("blocking").asBoolean()).thenComparing(row -> row.path("kind").asText())
                .thenComparingInt(row -> -row.path("occurrences").asInt()).thenComparing(row -> row.path("id").asText()));
        return ordered.stream().map(row -> {
            String key = row.path("id").asText();
            Saved now = current.get(key);
            if (now != null) row.set("decision", json.object(view(now)));
            row.put("answeredAfterRun", !same(original.get(key), now == null ? null : now.answer()));
            return json.read(row.toString(), QuestionWithDecision.class);
        }).toList();
    }

    private List<Saved> active(UUID project) {
        return database.query("""
                SELECT * FROM decisions WHERE project_id = ? AND superseded_at IS NULL ORDER BY decided_at DESC, id DESC
                """, this::row, project);
    }

    private Saved require(UUID id) {
        return database.query("SELECT * FROM decisions WHERE id = ? AND superseded_at IS NULL", this::row, id)
                .stream().findFirst().orElseThrow(() -> BoqAccess.missing("decision"));
    }

    private Saved row(ResultSet row, int index) throws SQLException {
        return new Saved(row.getObject("id", UUID.class), row.getObject("project_id", UUID.class), row.getString("question_id"),
                row.getString("kind"), json.read(row.getString("answer"), JsonNode.class), row.getString("note"),
                json.read(row.getString("question"), JsonNode.class), row.getObject("decided_by", UUID.class),
                row.getObject("decided_at", OffsetDateTime.class), row.getObject("promoted_to_preset_version_id", UUID.class));
    }

    private Decision view(Saved row) {
        var value = json.object(Map.of("id", row.id(), "projectId", row.project(), "questionId", row.key(),
                "kind", row.kind(), "answer", row.answer(), "decidedAt", row.decidedAt()));
        if (row.note() != null) value.put("note", row.note());
        value.put("summary", row.question() == null ? row.key() : row.question().path("message").asText(row.key()));
        if (row.question() != null) value.set("answerType", row.question().get("answer"));
        if (row.promoted() != null) value.put("promotedToPresetVersionId", row.promoted().toString());
        var actor = access.user(row.actor());
        if (actor != null) value.set("decidedBy", json.object(actor));
        boolean used = Boolean.TRUE.equals(database.queryForObject("""
                SELECT EXISTS (
                    SELECT 1 FROM boqs b JOIN boq_revisions r ON r.id = b.current_revision_id
                    JOIN runs n ON n.id = r.current_run_id
                    WHERE b.project_id = ? AND NOT b.archived AND EXISTS (
                        SELECT 1 FROM jsonb_array_elements(n.input_snapshot->'decisions') d
                        WHERE d->>'questionId' = ? AND d->'answer' = CAST(? AS jsonb)))
                """, Boolean.class, row.project(), row.key(), row.answer().toString()));
        value.put("usedByLatestRuns", used);
        return json.read(value.toString(), Decision.class);
    }

    private JsonNode question(UUID project, String key) {
        return database.query("""
                SELECT q.question::text FROM run_questions q JOIN runs n ON n.id = q.run_id
                JOIN boq_revisions r ON r.id = n.revision_id JOIN boqs b ON b.id = r.boq_id
                WHERE b.project_id = ? AND q.question_id = ? ORDER BY n.created_at DESC LIMIT 1
                """, (row, index) -> json.read(row.getString(1), JsonNode.class), project, key)
                .stream().findFirst().orElse(null);
    }

    private List<RevisionRef> affected(UUID project, Set<String> keys) {
        if (keys.isEmpty()) return List.of();
        var candidates = database.query("""
                SELECT b.id, b.name, r.id AS revision_id, r.label, r.status, r.current_run_id FROM boq_revisions r
                JOIN boqs b ON b.id = r.boq_id WHERE b.project_id = ? AND b.status = 'working' AND NOT b.archived
                    AND r.id = b.current_revision_id AND r.status IN ('in_review', 'approved') ORDER BY r.id
                """, (row, index) -> new Candidate(new RevisionRef(row.getObject("id", UUID.class), row.getString("name"),
                    row.getObject("revision_id", UUID.class), row.getString("label"), RevisionStatus.fromValue(row.getString("status"))),
                    row.getObject("current_run_id", UUID.class)), project);
        return candidates.stream().filter(item -> item.run() != null && keys.stream().anyMatch(key ->
                Boolean.TRUE.equals(database.queryForObject("""
                        SELECT EXISTS(SELECT 1 FROM run_questions WHERE run_id = ? AND question_id = ?)
                           OR EXISTS(SELECT 1 FROM runs n, jsonb_array_elements(n.input_snapshot->'decisions') d
                                     WHERE n.id = ? AND d->>'questionId' = ?)
                        """, Boolean.class, item.run(), key, item.run(), key)))).map(Candidate::revision).toList();
    }

    private void withdraw(List<RevisionRef> revisions, UUID actor) {
        for (var revision : revisions) boqs.withdrawIfReview(access.revision(revision.getRevisionId(), actor), actor, "decision_changed");
    }

    private void check(String key, String kind, JsonNode answer, JsonNode question, UUID project, UUID actor) {
        if (!(answer.isNull() || answer.isNumber() || answer.isBoolean() || answer.isTextual())) {
            throw badAnswer(key, "Choose a scalar answer.");
        }
        if (answer.isTextual() && answer.asText().length() > MAX_ANSWER) {
            throw invalid("invalid_body", "An answer has at most " + MAX_ANSWER + " characters.");
        }
        if (answer.isNumber() && answer.decimalValue().signum() < 0) throw badAnswer(key, "Enter zero or more.");
        if (question == null) return;
        if (!kind.equals(question.path("kind").asText())) throw invalid("invalid_body", "The question has a different kind.");
        if (answer.isNull()) return;
        JsonNode control = question.path("answer");
        switch (control.path("kind").asText()) {
            case "number" -> {
                if (!answer.isNumber() && !answer.asText().equals("flag")) throw badAnswer(key, "Enter a number or flag the line.");
            }
            case "choice" -> {
                boolean valid = false;
                for (JsonNode option : control.path("options")) if (option.path("value").equals(answer)) valid = true;
                if (!valid) throw badAnswer(key, "Choose one of the available options.");
            }
            default -> {
                if (!answer.isTextual() || answer.asText().isBlank()) throw badAnswer(key, "Choose a non-empty answer.");
            }
        }
    }

    private static boolean same(JsonNode a, JsonNode b) {
        if (a != null && b != null && a.isNumber() && b.isNumber()) return a.decimalValue().compareTo(b.decimalValue()) == 0;
        return Objects.equals(a, b);
    }

    private boolean promotable(Saved row) {
        return row.kind().equals("unknown_name") && row.answer().isTextual() && row.key().startsWith("name:")
                && row.key().indexOf(':', 5) > 5;
    }

    private ObjectNode entry(Saved row, String actor, OffsetDateTime at) {
        int separator = row.key().indexOf(':', 5);
        String field = row.key().substring(5, separator);
        String raw = row.key().substring(separator + 1);
        var value = json.object(Map.of("id", "answer:" + field + ":" + raw, "field", field, "match", Map.of("exact", raw),
                "caseSensitive", true, "term", row.answer().asText(), "source", "user", "createdBy", actor, "createdAt", at.toLocalDate().toString()));
        if (row.note() != null) value.put("note", row.note());
        return value;
    }

    private void event(Project project, UUID actor, String action, Saved decision, Map<String, ?> data) {
        var details = json.object(data).put("questionId", decision.key()).put("kind", decision.kind());
        audit.record(new RequestContext(actor, null, project.getOrgId(), null), AuditWriter.ActorKind.USER,
                project.getId(), action, "decision", decision.id(), details);
    }

    private static ApiException invalid(String code, String message) {
        return BoqAccess.failure(HttpStatus.BAD_REQUEST, code, message);
    }

    private static ApiException badAnswer(String id, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "invalid_answer", message, Map.of("questionId", id));
    }

    private record Candidate(RevisionRef revision, UUID run) {}
}
