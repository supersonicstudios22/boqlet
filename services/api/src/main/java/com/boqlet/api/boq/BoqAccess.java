package com.boqlet.api.boq;

import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.contract.model.*;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class BoqAccess {
    private static final Set<String> EDITS = Set.of("editBoqs", "answerQuestions", "editLines", "saveVersion");
    private final JdbcTemplate database;
    private final StoredJson json;
    private final ProjectAccess projects;
    private final OrgAccess orgs;
    private final EntitlementService billing;
    private final RunCatalog runs;
    private final BoqInputs inputs;

    BoqAccess(JdbcTemplate database, StoredJson json, ProjectAccess projects, OrgAccess orgs,
              EntitlementService billing, RunCatalog runs, BoqInputs inputs) {
        this.database = database;
        this.json = json;
        this.projects = projects;
        this.orgs = orgs;
        this.billing = billing;
        this.runs = runs;
        this.inputs = inputs;
    }

    public record Bill(UUID id, UUID project, String name, String description, Boq.StatusEnum status, boolean archived,
                       UUID current, UUID latest, UUID confirmedBy, OffsetDateTime confirmedAt,
                       OffsetDateTime createdAt, OffsetDateTime updatedAt) {}
    public record Version(UUID id, UUID bill, int number, String label, RevisionStatus status, RevisionInputs inputs,
                          UUID run, UUID basedOn, List<UUID> reviewers, UUID submitter, OffsetDateTime submitted,
                          UUID approver, OffsetDateTime approved, UUID issuer, OffsetDateTime issued,
                          String issueNote, Integer openQuestions, BoqRevisionFrozen frozen) {}
    public record Scope(Bill bill, Version revision, Project project) {}

    public Scope bill(UUID id, UUID actor) {
        Bill bill = readBill(id);
        return new Scope(bill, readVersion(bill.current()), projects.require(bill.project(), actor));
    }

    public Scope revision(UUID id, UUID actor) {
        Version revision = readVersion(id);
        Bill bill = readBill(revision.bill());
        return new Scope(bill, revision, projects.require(bill.project(), actor));
    }

    public Scope lockBill(UUID id, UUID actor, String action) {
        Scope scope = bill(id, actor);
        projects.lock(scope.project().getId(), actor, action);
        database.queryForObject("SELECT id FROM boqs WHERE id = ? FOR UPDATE", UUID.class, id);
        return bill(id, actor);
    }

    public Scope lockRevision(UUID id, UUID actor, String action) {
        Scope scope = revision(id, actor);
        projects.lock(scope.project().getId(), actor, action);
        database.queryForObject("SELECT id FROM boqs WHERE id = ? FOR UPDATE", UUID.class, scope.bill().id());
        return revision(id, actor);
    }

    public void checkOpen(Scope scope, boolean allowReview) {
        if (scope.bill().archived()) throw failure(HttpStatus.CONFLICT, "boq_archived", "The BoQ is archived.");
        if (scope.bill().status() == Boq.StatusEnum.CONFIRMED) {
            throw failure(HttpStatus.CONFLICT, "boq_confirmed", "Reopen the confirmed BoQ before editing.");
        }
        if (scope.revision().status() == RevisionStatus.ISSUED) {
            throw failure(HttpStatus.CONFLICT, "revision_locked", "This version is saved and read-only.");
        }
        if (!allowReview && scope.revision().status() != RevisionStatus.DRAFT) {
            throw failure(HttpStatus.CONFLICT, "revision_in_review", "Withdraw the review before editing.");
        }
    }

    boolean approval(Project project, UUID actor) {
        return Boolean.TRUE.equals(orgs.require(project.getOrgId(), actor).org().getSettings().getApprovalRequired())
                && billing.enabled(project.getOrgId(), "approvalWorkflow");
    }

    boolean fourEyes(Scope scope, UUID actor) {
        return actor.equals(scope.revision().submitter()) && approval(scope.project(), actor)
                && Boolean.TRUE.equals(orgs.require(scope.project().getOrgId(), actor).org().getSettings().getFourEyes());
    }

    List<Boq> list(UUID project, UUID actor) {
        Project visible = projects.require(project, actor);
        return database.query("SELECT * FROM boqs WHERE project_id = ? AND NOT archived ORDER BY created_at, id",
                this::billRow, project).stream().map(bill -> view(new Scope(bill, readVersion(bill.current()), visible), actor)).toList();
    }

    List<BoqRevision> versions(UUID boq, UUID actor) {
        var scope = bill(boq, actor);
        // Newest first. While the BoQ is confirmed its working version is closed: kept, not listed (F09 §5–6).
        boolean confirmed = scope.bill().status() == Boq.StatusEnum.CONFIRMED;
        return database.query("SELECT * FROM boq_revisions WHERE boq_id = ?" + (confirmed ? " AND status = 'issued'" : "")
                        + " ORDER BY number DESC", this::versionRow, boq)
                .stream().map(revision -> viewRevision(new Scope(scope.bill(), revision, scope.project()), actor)).toList();
    }

    public Boq view(Scope scope, UUID actor) {
        Bill bill = scope.bill();
        BoqRevision revision = viewRevision(scope, actor);
        boolean newer = revision.getInputs().getModels().stream().anyMatch(m -> m.getNewerVersionAvailable().orElse(null) != null);
        return new Boq(bill.id(), bill.project(), bill.name(), revision, bill.archived())
                .description(bill.description()).status(bill.status()).confirmedBy(user(bill.confirmedBy()))
                .confirmedAt(bill.confirmedAt()).latestIssuedRevisionId(bill.latest()).newModelVersionsAvailable(newer)
                .createdAt(bill.createdAt()).updatedAt(bill.updatedAt());
    }

    public BoqRevision viewRevision(Scope scope, UUID actor) {
        Version version = scope.revision();
        var input = version.inputs();
        if (version.status() != RevisionStatus.ISSUED) {
            for (var model : input.getModels()) {
                Integer next = database.queryForObject("""
                        SELECT CASE WHEN latest.number > chosen.number THEN latest.number ELSE NULL END
                        FROM model_versions chosen JOIN models m ON m.id = chosen.model_id
                        LEFT JOIN model_versions latest ON latest.id = m.latest_version_id WHERE chosen.id = ?
                        """, Integer.class, model.getModelVersionId());
                model.newerVersionAvailable(next);
            }
        }
        var current = version.run() == null ? null : runs.require(version.run()).run();
        var base = version.basedOn() == null ? null : readVersion(version.basedOn());
        return new BoqRevision(version.id(), version.bill(), version.number(), version.label(), version.status(),
                input, pending(scope), permissions(scope, actor))
                .currentRun(current).basedOnRevisionId(version.basedOn()).basedOnRunId(base == null ? null : base.run())
                .reviewers(version.reviewers().stream().map(this::user).filter(Objects::nonNull).toList())
                .reviewComments(comments(version.id(), null)).submittedBy(user(version.submitter())).submittedAt(version.submitted())
                .approvedBy(user(version.approver())).approvedAt(version.approved()).issuedBy(user(version.issuer())).issuedAt(version.issued())
                .issueNote(version.issueNote()).openQuestionsAtSave(version.openQuestions()).frozen(version.frozen());
    }

    List<String> pending(Scope scope) {
        var r = scope.revision();
        if (r.run() == null || r.status() == RevisionStatus.ISSUED) return List.of();
        return inputs.changes(runs.require(r.run()).snapshot(), inputs.snapshot(scope.project(), scope.bill().id(), clean(r.inputs())));
    }

    private RevisionInputs clean(RevisionInputs input) {
        var copy = json.read(json.object(input).toString(), RevisionInputs.class);
        for (var model : copy.getModels()) model.setNewerVersionAvailable(org.openapitools.jackson.nullable.JsonNullable.undefined());
        return copy;
    }

    private Map<String, Boolean> permissions(Scope scope, UUID actor) {
        var base = scope.project().getPermissions();
        var out = new LinkedHashMap<>(base);
        var rev = scope.revision();
        boolean live = !scope.bill().archived() && scope.bill().status() == Boq.StatusEnum.WORKING
                && rev.id().equals(scope.bill().current());
        boolean draft = rev.status() == RevisionStatus.DRAFT;
        boolean inReview = rev.status() == RevisionStatus.IN_REVIEW;
        boolean approved = rev.status() == RevisionStatus.APPROVED;
        if (!(live && draft)) EDITS.forEach(key -> out.put(key, false));
        boolean requiresApproval = approval(scope.project(), actor);
        boolean four = fourEyes(scope, actor);
        boolean estimator = allowed(base, "saveVersion");
        boolean approver = allowed(base, "approve");
        out.put("saveVersion", live && draft && estimator && !requiresApproval);
        out.put("submit", live && draft && estimator && requiresApproval);
        out.put("approve", live && inReview && approver && requiresApproval && !four);
        out.put("saveApproved", live && approved && approver && requiresApproval && !four);
        out.put("withdraw", live && (inReview || approved) && (estimator || approver || actor.equals(rev.submitter())));
        out.put("comment", live && inReview && (estimator || approver || rev.reviewers().contains(actor)));
        out.put("confirm", live && !inReview && allowed(base, "confirm")
                && (scope.project().getMyRole() == ProjectRole.LEAD || requiresApproval));
        out.put("reopen", scope.bill().status() == Boq.StatusEnum.CONFIRMED && !scope.bill().archived() && allowed(base, "reopen"));
        return out;
    }

    List<ReviewComment> comments(UUID revision, String lineKey) {
        String sql = """
                SELECT c.*, u.name AS author FROM review_comments c JOIN users u ON u.id = c.author_id
                WHERE c.revision_id = ?
                """;
        return database.query(sql + (lineKey == null ? "" : " AND c.line_key = ?") + " ORDER BY c.created_at, c.id",
                (row, index) -> {
                    var comment = new ReviewComment(row.getObject("id", UUID.class),
                            new UserRef(row.getObject("author_id", UUID.class), row.getString("author")),
                            row.getObject("created_at", OffsetDateTime.class), row.getString("text")).lineKey(row.getString("line_key"));
                    if (row.getString("outcome") != null) comment.setOutcome(ReviewComment.OutcomeEnum.fromValue(row.getString("outcome")));
                    return comment;
                }, lineKey == null ? new Object[]{revision} : new Object[]{revision, lineKey});
    }

    UserRef user(UUID id) {
        if (id == null) return null;
        return database.query("SELECT name, email FROM users WHERE id = ? AND deleted_at IS NULL",
                (row, index) -> new UserRef(id, row.getString("name")).email(row.getString("email")), id)
                .stream().findFirst().orElse(null);
    }

    Version readVersion(UUID id) {
        return database.query("SELECT * FROM boq_revisions WHERE id = ?", this::versionRow, id)
                .stream().findFirst().orElseThrow(() -> missing("revision"));
    }

    private Bill readBill(UUID id) {
        return database.query("SELECT * FROM boqs WHERE id = ?", this::billRow, id)
                .stream().findFirst().orElseThrow(() -> missing("BoQ"));
    }

    private Bill billRow(ResultSet row, int ignored) throws SQLException {
        return new Bill(row.getObject("id", UUID.class), row.getObject("project_id", UUID.class), row.getString("name"),
                row.getString("description"), Boq.StatusEnum.fromValue(row.getString("status")), row.getBoolean("archived"),
                row.getObject("current_revision_id", UUID.class), row.getObject("latest_issued_revision_id", UUID.class),
                row.getObject("confirmed_by", UUID.class), row.getObject("confirmed_at", OffsetDateTime.class),
                row.getObject("created_at", OffsetDateTime.class), row.getObject("updated_at", OffsetDateTime.class));
    }

    private Version versionRow(ResultSet row, int ignored) throws SQLException {
        var reviewers = row.getArray("reviewers");
        var reviewIds = Arrays.stream((Object[]) reviewers.getArray()).map(it -> UUID.fromString(it.toString())).toList();
        reviewers.free();
        return new Version(row.getObject("id", UUID.class), row.getObject("boq_id", UUID.class), row.getInt("number"),
                row.getString("label"), RevisionStatus.fromValue(row.getString("status")),
                json.read(row.getString("inputs"), RevisionInputs.class), row.getObject("current_run_id", UUID.class),
                row.getObject("based_on_revision_id", UUID.class), reviewIds, row.getObject("submitted_by", UUID.class),
                row.getObject("submitted_at", OffsetDateTime.class), row.getObject("approved_by", UUID.class),
                row.getObject("approved_at", OffsetDateTime.class), row.getObject("issued_by", UUID.class),
                row.getObject("issued_at", OffsetDateTime.class), row.getString("issue_note"),
                row.getObject("open_questions_at_save", Integer.class), json.read(row.getString("frozen"), BoqRevisionFrozen.class));
    }

    static boolean allowed(Map<String, Boolean> permissions, String key) {
        return Boolean.TRUE.equals(permissions.get(key));
    }

    public static ApiException missing(String resource) {
        return failure(HttpStatus.NOT_FOUND, "not_found", "The " + resource + " was not found.");
    }

    public static ApiException failure(HttpStatus status, String code, String message) {
        return new ApiException(status, code, message, Map.of());
    }
}
