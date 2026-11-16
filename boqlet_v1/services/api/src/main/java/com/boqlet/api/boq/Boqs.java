package com.boqlet.api.boq;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.api.realtime.Notifications;
import com.boqlet.contract.model.*;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class Boqs {
    private final JdbcTemplate database;
    private final StoredJson json;
    private final BoqAccess access;
    private final ProjectAccess projects;
    private final BoqInputs inputs;
    private final RunCatalog runs;
    private final BoqExports exports;
    private final AuditWriter audit;
    private final Notifications notifications;

    Boqs(JdbcTemplate database, StoredJson json, BoqAccess access, ProjectAccess projects, BoqInputs inputs,
         RunCatalog runs, BoqExports exports, AuditWriter audit, Notifications notifications) {
        this.database = database;
        this.json = json;
        this.access = access;
        this.projects = projects;
        this.inputs = inputs;
        this.runs = runs;
        this.exports = exports;
        this.audit = audit;
        this.notifications = notifications;
    }

    @Transactional
    public Boq create(UUID project, UUID actor, CreateBoqRequest request) {
        var scope = projects.lock(project, actor, "editBoqs");
        var parameters = inputs.merge(inputs.defaults(scope), request.getInputs());
        inputs.validate(scope, actor, parameters);
        UUID boq = Ids.newId();
        UUID revision = Ids.newId();
        database.update("INSERT INTO boqs (id, project_id, name, description, current_revision_id, created_by) VALUES (?, ?, ?, ?, ?, ?)",
                boq, project, text(request.getName(), "A BoQ name is required."), request.getDescription(), revision, actor);
        insertRevision(boq, revision, 1, parameters, null, null);
        var created = access.bill(boq, actor);
        event(created, actor, "boq.created", "boq", boq, Map.of());
        return access.view(created, actor);
    }

    @Transactional
    public Boq update(UUID boq, UUID actor, UpdateBoqRequest request) {
        var scope = access.lockBill(boq, actor, "editBoqs");
        access.checkOpen(scope, true);
        database.update("""
                UPDATE boqs SET name = coalesce(?, name), description = coalesce(?, description), updated_at = now()
                WHERE id = ?
                """, request.getName() == null ? null : text(request.getName(), "A BoQ name is required."), request.getDescription(), boq);
        event(scope, actor, "boq.updated", "boq", boq, Map.of());
        return access.view(access.bill(boq, actor), actor);
    }

    @Transactional
    public Boq archive(UUID boq, UUID actor) {
        var scope = access.lockBill(boq, actor, "editBoqs");
        if (!scope.bill().archived()) {
            database.update("UPDATE boqs SET archived = true, updated_at = now() WHERE id = ?", boq);
            event(scope, actor, "boq.archived", "boq", boq, Map.of());
        }
        return access.view(access.bill(boq, actor), actor);
    }

    @Transactional
    public BoqRevision updateInputs(UUID revision, UUID actor, RevisionInputsPartial patch) {
        var scope = access.lockRevision(revision, actor, "editBoqs");
        live(scope);
        var input = inputs.merge(scope.revision().inputs(), patch);
        inputs.validate(scope.project(), actor, input);
        if (!input.equals(scope.revision().inputs())) {
            database.update("UPDATE boq_revisions SET inputs = CAST(? AS jsonb), updated_at = now() WHERE id = ?",
                    json.object(input).toString(), revision);
            withdrawIfReview(scope, actor, "edited");
            event(scope, actor, "revision.inputs_updated", "revision", revision, Map.of());
        }
        return revision(revision, actor);
    }

    @Transactional
    public BoqRevision issue(UUID id, UUID actor, IssueRevisionRequest request) {
        var existing = access.revision(id, actor);
        boolean approval = access.approval(existing.project(), actor);
        var scope = access.lockRevision(id, actor, approval ? "approve" : "saveVersion");
        live(scope);
        if (approval) {
            if (scope.revision().status() != RevisionStatus.APPROVED) throw conflict("not_approved", "Approve this version before saving.");
            fourEyes(scope, actor);
        } else {
            if (scope.revision().status() != RevisionStatus.DRAFT) throw conflict("revision_in_review", "This version is in review.");
            confirmManual(request.getNotModelledConfirmed());
        }
        save(scope, actor, request.getLabel(), request.getNote(), true);
        return revision(id, actor);
    }

    @Transactional
    public BoqRevision submit(UUID id, UUID actor, SubmitRevisionRequest request) {
        var scope = access.lockRevision(id, actor, "saveVersion");
        live(scope);
        if (!access.approval(scope.project(), actor)) throw conflict("approval_off", "Approval is disabled for this organisation.");
        if (scope.revision().status() != RevisionStatus.DRAFT) throw conflict("invalid_transition", "This version is in review already.");
        confirmManual(request.getNotModelledConfirmed());
        var reviewers = new LinkedHashSet<>(request.getReviewerIds());
        if (reviewers.isEmpty() || reviewers.stream().anyMatch(Objects::isNull)) {
            throw BoqAccess.failure(HttpStatus.BAD_REQUEST, "invalid_body", "Choose reviewers.");
        }
        for (UUID reviewer : reviewers) {
            try {
                var role = projects.require(scope.project().getId(), reviewer).getMyRole();
                if (role == ProjectRole.LEAD || role == ProjectRole.APPROVER) continue;
            } catch (ApiException error) {
                if (error.status() != HttpStatus.NOT_FOUND) throw error;
            }
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_reviewer", "Choose project leads or approvers.", Map.of("userId", reviewer));
        }
        ready(scope);
        String membership = "{" + reviewers.stream().map(UUID::toString).reduce((first, second) -> first + "," + second).orElse("") + "}";
        database.update("""
                UPDATE boq_revisions SET status = 'in_review', reviewers = CAST(? AS uuid[]), submitted_by = ?, submitted_at = now(),
                    approved_by = NULL, approved_at = NULL, updated_at = now() WHERE id = ?
                """, membership, actor, id);
        if (request.getMessage() != null && !request.getMessage().isBlank()) {
            addComment(id, actor, request.getMessage().strip(), null, null);
        }
        event(scope, actor, "revision.submitted", "revision", id, Map.of("reviewers", reviewers.size()));
        for (UUID reviewer : reviewers) if (!reviewer.equals(actor)) notify(scope, reviewer, "revision.review_requested", "reviews", "review");
        return revision(id, actor);
    }

    @Transactional
    public BoqRevision review(UUID id, UUID actor, String comment, boolean approve) {
        var scope = access.lockRevision(id, actor, "approve");
        live(scope);
        if (scope.revision().status() != RevisionStatus.IN_REVIEW) throw conflict("invalid_transition", "This version is not in review.");
        if (approve) {
            fourEyes(scope, actor);
            ready(scope);
            database.update("""
                    UPDATE boq_revisions SET status = 'approved', approved_by = ?, approved_at = now(), updated_at = now() WHERE id = ?
                    """, actor, id);
            addComment(id, actor, comment == null ? "" : comment.strip(), null, "approved");
        } else {
            addComment(id, actor, text(comment, "Say what should change."), null, "changes_requested");
            database.update("""
                    UPDATE boq_revisions SET status = 'draft', approved_by = NULL, approved_at = NULL, updated_at = now() WHERE id = ?
                    """, id);
        }
        event(scope, actor, approve ? "revision.approved" : "revision.changes_requested", "revision", id, Map.of());
        if (scope.revision().submitter() != null && !scope.revision().submitter().equals(actor)) {
            notify(scope, scope.revision().submitter(), approve ? "revision.approved" : "revision.changes_requested", "reviews", "review");
        }
        return revision(id, actor);
    }

    @Transactional
    public BoqRevision withdraw(UUID id, UUID actor) {
        var scope = access.lockRevision(id, actor, "view");
        live(scope);
        if (!BoqAccess.allowed(access.viewRevision(scope, actor).getPermissions(), "withdraw")) {
            throw conflict("invalid_transition", "The review cannot be withdrawn.");
        }
        withdrawIfReview(scope, actor, "withdrawn");
        return revision(id, actor);
    }

    @Transactional
    public ReviewComment comment(UUID id, UUID actor, AddReviewCommentRequest request) {
        var scope = access.lockRevision(id, actor, "view");
        live(scope);
        if (scope.revision().status() != RevisionStatus.IN_REVIEW) throw conflict("invalid_transition", "This version is not in review.");
        if (!BoqAccess.allowed(access.viewRevision(scope, actor).getPermissions(), "comment")) {
            throw BoqAccess.failure(HttpStatus.FORBIDDEN, "forbidden", "Your role cannot comment on this review.");
        }
        UUID comment = addComment(id, actor, text(request.getText(), "The comment is empty."), request.getLineKey(), null);
        return access.comments(id, null).stream().filter(value -> value.getId().equals(comment)).findFirst().orElseThrow();
    }

    @Transactional
    public Boq confirm(UUID id, UUID actor, ConfirmBoqRequest request) {
        var scope = access.lockBill(id, actor, "confirm");
        boolean approval = access.approval(scope.project(), actor);
        if (!approval && scope.project().getMyRole() != ProjectRole.LEAD) {
            throw BoqAccess.failure(HttpStatus.FORBIDDEN, "forbidden", "Only a project lead can confirm this BoQ.");
        }
        if (scope.bill().status() == Boq.StatusEnum.CONFIRMED) throw conflict("invalid_transition", "The BoQ is already confirmed.");
        live(scope);
        if (scope.revision().status() == RevisionStatus.IN_REVIEW) throw conflict("revision_in_review", "Finish or withdraw the review first.");
        var previous = scope.bill().latest() == null ? null : access.readVersion(scope.bill().latest());
        boolean changed = previous == null || !Objects.equals(previous.run(), scope.revision().run()) || !access.pending(scope).isEmpty();
        UUID saved = scope.bill().latest();
        if (changed) {
            if (approval) throw conflict("not_saved", "Approve and save this version before confirming the BoQ.");
            confirmManual(request == null ? null : request.getNotModelledConfirmed());
            save(scope, actor, request.getLabel(), request.getNote(), false);
            saved = scope.revision().id();
        }
        database.update("""
                UPDATE boqs SET status = 'confirmed', current_revision_id = ?, confirmed_by = ?, confirmed_at = now(),
                    updated_at = now() WHERE id = ?
                """, saved, actor, id);
        event(scope, actor, "boq.confirmed", "boq", id, Map.of("revisionId", saved));
        notifyMembers(scope, actor, "boq.confirmed", "versions", null);
        return access.view(access.bill(id, actor), actor);
    }

    @Transactional
    public Boq reopen(UUID id, UUID actor, String reason) {
        var scope = access.lockBill(id, actor, "reopen");
        if (scope.bill().archived()) throw conflict("boq_archived", "The BoQ is archived.");
        if (scope.bill().status() != Boq.StatusEnum.CONFIRMED) throw conflict("invalid_transition", "Only a confirmed BoQ can be reopened.");
        String why = text(reason, "Say why the BoQ is reopened.");
        UUID working = database.query("""
                SELECT id FROM boq_revisions WHERE boq_id = ? AND status <> 'issued'
                """, (row, index) -> row.getObject("id", UUID.class), id).stream().findFirst().orElse(null);
        if (working == null) {
            working = Ids.newId();
            insertRevision(id, working, scope.revision().number() + 1, scope.revision().inputs(), scope.revision().run(), scope.revision().id());
        }
        database.update("""
                UPDATE boqs SET status = 'working', current_revision_id = ?, confirmed_by = NULL, confirmed_at = NULL,
                    updated_at = now() WHERE id = ?
                """, working, id);
        event(scope, actor, "boq.reopened", "boq", id, Map.of("reason", why));
        notifyMembers(scope, actor, "boq.reopened", "versions", null);
        return access.view(access.bill(id, actor), actor);
    }

    void withdrawIfReview(BoqAccess.Scope scope, UUID actor, String reason) {
        int update = database.update("""
                UPDATE boq_revisions SET status = 'draft', approved_by = NULL, approved_at = NULL,
                    submitted_by = NULL, submitted_at = NULL, reviewers = '{}', updated_at = now()
                WHERE id = ? AND status IN ('in_review', 'approved')
                """, scope.revision().id());
        if (update > 0) {
            event(scope, actor, "revision.review_withdrawn", "revision", scope.revision().id(), Map.of("reason", reason));
            for (UUID reviewer : scope.revision().reviewers()) {
                if (!actor.equals(reviewer)) notify(scope, reviewer, "revision.review_withdrawn", null, "review");
            }
        }
    }

    private BoqRevision revision(UUID id, UUID actor) {
        return access.viewRevision(access.revision(id, actor), actor);
    }

    private RunCatalog.Entry ready(BoqAccess.Scope scope) {
        var revision = scope.revision();
        if (revision.run() == null) throw notReady("no_run", "Generate the BoQ before saving.", List.of());
        var run = runs.require(revision.run());
        if (run.resultKey() == null || Boolean.TRUE.equals(database.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM runs WHERE revision_id = ? AND status IN ('queued','running'))
                """, Boolean.class, revision.id()))) {
            throw notReady("run_not_finished", "Wait for the run to finish.", List.of());
        }
        var pending = access.pending(scope);
        if (!pending.isEmpty()) throw notReady("pending", "Generate again with the current inputs and adjustments.", pending);
        return run;
    }

    private void save(BoqAccess.Scope scope, UUID actor, String proposed, String note, boolean openNext) {
        var rev = scope.revision();
        var run = ready(scope);
        String label = proposed == null || proposed.isBlank() ? label(rev.number()) : proposed.strip();
        UUID id = scope.bill().id();
        if (Boolean.TRUE.equals(database.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM boq_revisions WHERE boq_id = ? AND id <> ? AND label = ?)
                """, Boolean.class, id, rev.id(), label))) {
            throw new ApiException(HttpStatus.CONFLICT, "label_taken", "That version label is already used.", Map.of("label", label));
        }
        OffsetDateTime at = OffsetDateTime.now(ZoneOffset.UTC);
        UUID export = exports.schedule(scope, run, actor, null, true, label, note, at).export();
        var frozen = json.object(Map.of("runId", run.run().getId(), "exportIds", List.of(export),
                "adjustments", Map.of("overrides", inputs.overrides(id, true), "manualItems", inputs.manualItems(id, true))));
        database.update("""
                UPDATE boq_revisions SET status = 'issued', label = ?, issued_by = ?, issued_at = ?, issue_note = ?,
                    open_questions_at_save = ?, frozen = CAST(? AS jsonb), updated_at = now() WHERE id = ?
                """, label, actor, at, note, Optional.ofNullable(run.run().getStats().getBlockingQuestions()).orElse(0), frozen.toString(), rev.id());
        UUID current = rev.id();
        if (openNext) {
            current = Ids.newId();
            insertRevision(id, current, rev.number() + 1, rev.inputs(), run.run().getId(), rev.id());
        }
        database.update("UPDATE boqs SET latest_issued_revision_id = ?, current_revision_id = ?, updated_at = now() WHERE id = ?",
                rev.id(), current, id);
        event(scope, actor, "version.saved", "revision", rev.id(),
                Map.of("label", label, "runId", run.run().getId(), "boqId", scope.bill().id(), "revisionId", rev.id()));
        notifyMembers(scope, actor, "version.saved", null, "versions");
    }

    private void insertRevision(UUID boq, UUID id, int number, RevisionInputs input, UUID run, UUID parent) {
        while (Boolean.TRUE.equals(database.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM boq_revisions WHERE boq_id = ? AND label = ?)
                """, Boolean.class, boq, label(number)))) number++;
        database.update("""
                INSERT INTO boq_revisions (id, boq_id, number, label, inputs, current_run_id, based_on_revision_id)
                VALUES (?, ?, ?, ?, CAST(? AS jsonb), ?, ?)
                """, id, boq, number, label(number), json.object(input).toString(), run, parent);
    }

    private UUID addComment(UUID revision, UUID actor, String text, String line, String outcome) {
        UUID id = Ids.newId();
        database.update("INSERT INTO review_comments (id, revision_id, author_id, text, line_key, outcome) VALUES (?, ?, ?, ?, ?, ?)",
                id, revision, actor, text, line, outcome);
        return id;
    }

    private void live(BoqAccess.Scope scope) {
        access.checkOpen(scope, true);
        if (!scope.revision().id().equals(scope.bill().current())) throw conflict("revision_locked", "This version is read-only.");
    }

    private void fourEyes(BoqAccess.Scope scope, UUID actor) {
        if (access.fourEyes(scope, actor)) {
            throw BoqAccess.failure(HttpStatus.FORBIDDEN, "four_eyes", "A different reviewer must approve or save this version.");
        }
    }

    private void event(BoqAccess.Scope scope, UUID actor, String action, String type, UUID entity, Map<String, ?> details) {
        audit.record(new RequestContext(actor, null, scope.project().getOrgId(), null), AuditWriter.ActorKind.USER,
                scope.project().getId(), action, type, entity, json.object(details));
    }

    private void notifyMembers(BoqAccess.Scope scope, UUID actor, String kind, String category, String tab) {
        for (UUID member : notifications.projectAudience(scope.project().getOrgId(), scope.project().getId(), actor)) {
            notify(scope, member, kind, category, tab);
        }
    }

    private void notify(BoqAccess.Scope scope, UUID recipient, String kind, String category, String tab) {
        UUID org = scope.project().getOrgId();
        UUID project = scope.project().getId();
        UUID boq = scope.bill().id();
        String url = notifications.projectUrl(org, project) + "/boqs/" + boq + (tab == null ? "" : "?tab=" + tab);
        notifications.send(recipient, org, project, kind, category,
                Map.of("boq", scope.bill().name(), "revision", scope.revision().label(), "label", scope.revision().label()),
                url, kind.startsWith("revision.") ? "revision" : "boq",
                kind.startsWith("revision.") ? scope.revision().id() : boq);
    }

    private static ApiException conflict(String code, String message) {
        return BoqAccess.failure(HttpStatus.CONFLICT, code, message);
    }

    private static ApiException notReady(String reason, String message, List<String> pending) {
        return new ApiException(HttpStatus.CONFLICT, "not_ready", message,
                pending.isEmpty() ? Map.of("reason", reason) : Map.of("reason", reason, "pendingChanges", pending));
    }

    private static void confirmManual(Boolean value) {
        if (!Boolean.TRUE.equals(value)) throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_body",
                "Confirm that the work outside the models has been included.", Map.of("field", "notModelledConfirmed"));
    }

    private static String text(String input, String message) {
        if (input == null || input.isBlank()) throw BoqAccess.failure(HttpStatus.BAD_REQUEST, "invalid_body", message);
        return input.strip();
    }

    static String label(int number) {
        var label = new StringBuilder();
        for (int remaining = number; remaining > 0; remaining = (remaining - 1) / 26) {
            label.append((char) ('A' + (remaining - 1) % 26));
        }
        return label.reverse().toString();
    }
}
