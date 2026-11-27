package com.boqlet.api.boq;

import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.contract.model.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
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

    /** Writes the project role allows on an archived project (`archive`, `view`) still don't reach its BoQs (TF-012). */
    static void writable(Scope scope) {
        if (scope.project().getStatus() == Project.StatusEnum.ARCHIVED) {
            throw failure(HttpStatus.CONFLICT, "project_archived", "The project is archived and read-only.");
        }
    }

    boolean approval(Project project, UUID actor) {
        return approval(project, new Loads(actor));
    }

    private boolean approval(Project project, Loads loads) {
        return Boolean.TRUE.equals(loads.org(project.getOrgId()).org().getSettings().getApprovalRequired())
                && loads.feature(project.getOrgId(), "approvalWorkflow");
    }

    /**
     * Review A-46 (DEC-42): may the actor share a version that is not saved? Not when the org shares only saved
     * versions (`saved_versions_only`); with approval on, only the project's lead or an approver
     * (`approval_required_for_share`): the firm's check before something leaves the office holds for links too.
     */
    void requireShareWorking(Project project, UUID actor) {
        var refusal = shareWorkingRefusal(project, actor);
        if (refusal != null) throw refusal;
    }

    private ApiException shareWorkingRefusal(Project project, UUID actor) {
        return shareWorkingRefusal(project, new Loads(actor));
    }

    private ApiException shareWorkingRefusal(Project project, Loads loads) {
        var settings = loads.org(project.getOrgId()).org().getSettings();
        if (Boolean.TRUE.equals(settings.getShareOnlySavedVersions())) {
            return failure(HttpStatus.FORBIDDEN, "saved_versions_only", "This organisation shares only saved versions.");
        }
        if (approval(project, loads) && project.getMyRole() != ProjectRole.LEAD && project.getMyRole() != ProjectRole.APPROVER) {
            return new ApiException(HttpStatus.FORBIDDEN, "approval_required_for_share",
                    "With approval required, only the project's lead or an approver shares a version that isn't saved.",
                    Map.of("required", "approver"));
        }
        return null;
    }

    boolean fourEyes(Scope scope, UUID actor) {
        return fourEyes(scope, new Loads(actor));
    }

    private boolean fourEyes(Scope scope, Loads loads) {
        return loads.actor.equals(scope.revision().submitter()) && approval(scope.project(), loads)
                && Boolean.TRUE.equals(loads.org(scope.project().getOrgId()).org().getSettings().getFourEyes());
    }

    List<Boq> list(UUID project, UUID actor) {
        Project visible = projects.require(project, actor);
        var bills = database.query("SELECT * FROM boqs WHERE project_id = ? AND NOT archived ORDER BY created_at, id",
                this::billRow, project);
        // Review B-20: everything the views read, for every BoQ at once, so the list costs a fixed number of queries.
        var loads = new Loads(actor);
        loads.versions(bills.stream().map(Bill::current).toList());
        var scopes = bills.stream().map(bill -> new Scope(bill, loads.version(bill.current()), visible)).toList();
        loads.prefetch(visible, scopes);
        return scopes.stream().map(scope -> view(scope, loads)).toList();
    }

    List<BoqRevision> versions(UUID boq, UUID actor) {
        var scope = bill(boq, actor);
        // Newest first. While the BoQ is confirmed its working version is closed: kept, not listed (F09 §5–6).
        boolean confirmed = scope.bill().status() == Boq.StatusEnum.CONFIRMED;
        var loads = new Loads(actor);
        var scopes = database.query("SELECT * FROM boq_revisions WHERE boq_id = ?" + (confirmed ? " AND status = 'issued'" : "")
                        + " ORDER BY number DESC", this::versionRow, boq)
                .stream().map(revision -> new Scope(scope.bill(), revision, scope.project())).toList();
        loads.prefetch(scope.project(), scopes);
        return scopes.stream().map(s -> viewRevision(s, loads)).toList();
    }

    public Boq view(Scope scope, UUID actor) {
        return view(scope, new Loads(actor));
    }

    private Boq view(Scope scope, Loads loads) {
        Bill bill = scope.bill();
        BoqRevision revision = viewRevision(scope, loads);
        boolean newer = revision.getInputs().getModels().stream().anyMatch(m -> m.getNewerVersionAvailable().orElse(null) != null);
        boolean newerPresets = revision.getPresetInputs().stream().anyMatch(p -> p.getNewerVersionAvailable().orElse(null) != null);
        return new Boq(bill.id(), bill.project(), bill.name(), revision, bill.archived())
                .description(bill.description()).status(bill.status()).confirmedBy(loads.user(bill.confirmedBy()))
                .confirmedAt(bill.confirmedAt()).latestIssuedRevisionId(bill.latest()).newModelVersionsAvailable(newer)
                .newPresetVersionsAvailable(newerPresets)
                .createdAt(bill.createdAt()).updatedAt(bill.updatedAt());
    }

    public BoqRevision viewRevision(Scope scope, UUID actor) {
        return viewRevision(scope, new Loads(actor));
    }

    private BoqRevision viewRevision(Scope scope, Loads loads) {
        Version version = scope.revision();
        var input = version.inputs();
        if (version.status() != RevisionStatus.ISSUED) {
            for (var model : input.getModels()) model.newerVersionAvailable(loads.newerModel(model.getModelVersionId()));
        }
        var current = version.run() == null ? null : loads.run(version.run()).run();
        var base = version.basedOn() == null ? null : loads.version(version.basedOn());
        return new BoqRevision(version.id(), version.bill(), version.number(), version.label(), version.status(),
                input, pending(scope, loads), permissions(scope, loads))
                .presetInputs(loads.presets(input, version.status() != RevisionStatus.ISSUED))
                .currentRun(current).basedOnRevisionId(version.basedOn()).basedOnRunId(base == null ? null : base.run())
                .reviewers(version.reviewers().stream().map(loads::user).filter(Objects::nonNull).toList())
                .reviewComments(loads.comments(version.id())).submittedBy(loads.user(version.submitter())).submittedAt(version.submitted())
                .approvedBy(loads.user(version.approver())).approvedAt(version.approved()).issuedBy(loads.user(version.issuer())).issuedAt(version.issued())
                .issueNote(version.issueNote()).openQuestionsAtSave(version.openQuestions()).frozen(version.frozen());
    }

    List<String> pending(Scope scope) {
        return pending(scope, new Loads(null));
    }

    private List<String> pending(Scope scope, Loads loads) {
        var r = scope.revision();
        if (r.run() == null || r.status() == RevisionStatus.ISSUED) return List.of();
        var now = inputs.snapshot(clean(r.inputs()), loads.decisions(scope.project().getId()), loads.overrides(scope.bill().id()),
                loads.manualItems(scope.bill().id()), loads.projectDictionary(scope.project()));
        return inputs.changes(loads.run(r.run()).snapshot(), now, loads.asked(r.run()));
    }

    private Integer newerModelVersion(UUID modelVersion) {
        return database.queryForObject("""
                SELECT CASE WHEN latest.number > chosen.number THEN latest.number ELSE NULL END
                FROM model_versions chosen JOIN models m ON m.id = chosen.model_id
                LEFT JOIN model_versions latest ON latest.id = m.latest_version_id WHERE chosen.id = ?
                """, Integer.class, modelVersion);
    }

    /**
     * What the BoQ and revision views read, each read once per call (review B-20). A list loads it for all its BoQs or
     * versions first ({@link #prefetch}), so it costs a fixed number of queries however many it holds; a single view
     * reads what it needs as it did, once each. A lookup the prefetch did not cover (or a not-found) takes the single query.
     */
    final class Loads {
        final UUID actor;
        private final Map<UUID, Version> versions = new HashMap<>();
        private final Map<UUID, Optional<Integer>> newer = new HashMap<>();
        private final Map<UUID, RunCatalog.Entry> runEntries = new HashMap<>();
        private final Map<UUID, Set<String>> asked = new HashMap<>();
        private final Map<UUID, List<ObjectNode>> decisions = new HashMap<>();
        private final Map<UUID, List<ObjectNode>> overrides = new HashMap<>();
        private final Map<UUID, List<ObjectNode>> manual = new HashMap<>();
        private final Map<UUID, Optional<UUID>> dictionaries = new HashMap<>();
        private final Map<Boolean, Map<UUID, PresetInputInfo>> presets = new HashMap<>(Map.of(true, new HashMap<>(), false, new HashMap<>()));
        private final Map<UUID, Optional<UserRef>> users = new HashMap<>();
        private final Map<UUID, List<ReviewComment>> comments = new HashMap<>();
        private final Map<UUID, OrgAccess.MemberOrg> members = new HashMap<>();
        private final Map<String, Boolean> features = new HashMap<>();

        Loads(UUID actor) {
            this.actor = actor;
        }

        Version version(UUID id) {
            var known = versions.get(id);
            if (known != null) return known;
            var read = readVersion(id);
            versions.put(id, read);
            return read;
        }

        Integer newerModel(UUID modelVersion) {
            if (!newer.containsKey(modelVersion)) newer.put(modelVersion, Optional.ofNullable(newerModelVersion(modelVersion)));
            return newer.get(modelVersion).orElse(null);
        }

        RunCatalog.Entry run(UUID id) {
            var known = runEntries.get(id);
            if (known != null) return known;
            var read = runs.require(id);
            runEntries.put(id, read);
            return read;
        }

        Set<String> asked(UUID run) {
            if (!asked.containsKey(run)) {
                asked.put(run, new HashSet<>(database.queryForList("SELECT question_id FROM run_questions WHERE run_id = ?", String.class, run)));
            }
            return asked.get(run);
        }

        List<ObjectNode> decisions(UUID project) {
            if (!decisions.containsKey(project)) decisions.put(project, inputs.decisions(project));
            return decisions.get(project);
        }

        List<ObjectNode> overrides(UUID boq) {
            if (!overrides.containsKey(boq)) overrides.put(boq, inputs.overrides(boq, false));
            return overrides.get(boq);
        }

        List<ObjectNode> manualItems(UUID boq) {
            if (!manual.containsKey(boq)) manual.put(boq, inputs.manualItems(boq, false));
            return manual.get(boq);
        }

        UUID projectDictionary(Project project) {
            if (!dictionaries.containsKey(project.getId())) dictionaries.put(project.getId(), Optional.ofNullable(inputs.projectDictionary(project)));
            return dictionaries.get(project.getId()).orElse(null);
        }

        List<PresetInputInfo> presets(RevisionInputs input, boolean showNewer) {
            var ids = BoqInputs.presetIds(input).stream().filter(Objects::nonNull).distinct().toList();
            var known = presets.get(showNewer);
            var missing = ids.stream().filter(id -> !known.containsKey(id)).toList();
            if (!missing.isEmpty()) for (var info : inputs.presetInfos(missing, showNewer)) known.put(info.getVersionId(), info);
            return ids.stream().map(known::get).filter(Objects::nonNull).toList();
        }

        UserRef user(UUID id) {
            if (id == null) return null;
            if (!users.containsKey(id)) users.put(id, Optional.ofNullable(BoqAccess.this.user(id)));
            return users.get(id).orElse(null);
        }

        List<ReviewComment> comments(UUID revision) {
            if (!comments.containsKey(revision)) comments.put(revision, BoqAccess.this.comments(revision, null));
            return comments.get(revision);
        }

        OrgAccess.MemberOrg org(UUID org) {
            var known = members.get(org);
            if (known != null) return known;
            var read = orgs.require(org, actor);
            members.put(org, read);
            return read;
        }

        boolean feature(UUID org, String key) {
            String k = org + "/" + key;
            if (!features.containsKey(k)) features.put(k, billing.enabled(org, key));
            return features.get(k);
        }

        /** Many revisions at once. */
        void versions(Collection<UUID> ids) {
            var wanted = ids.stream().filter(id -> id != null && !versions.containsKey(id)).distinct().toList();
            if (wanted.isEmpty()) return;
            for (var v : database.query("SELECT * FROM boq_revisions WHERE id = ANY(CAST(? AS uuid[]))", BoqAccess.this::versionRow,
                    BoqInputs.uuidArray(wanted))) versions.put(v.id(), v);
        }

        /** Everything the views of `scopes` (all in `project`) read, in a fixed number of queries. */
        void prefetch(Project project, List<Scope> scopes) {
            if (scopes.isEmpty()) return;
            versions(scopes.stream().map(scope -> scope.revision().basedOn()).toList());
            var open = scopes.stream().filter(scope -> scope.revision().status() != RevisionStatus.ISSUED).toList();
            var modelVersions = open.stream().flatMap(scope -> scope.revision().inputs().getModels().stream())
                    .map(RevisionModelInput::getModelVersionId).filter(id -> id != null && !newer.containsKey(id)).distinct().toList();
            if (!modelVersions.isEmpty()) {
                database.query("""
                        SELECT chosen.id, CASE WHEN latest.number > chosen.number THEN latest.number ELSE NULL END AS next
                        FROM model_versions chosen JOIN models m ON m.id = chosen.model_id
                        LEFT JOIN model_versions latest ON latest.id = m.latest_version_id WHERE chosen.id = ANY(CAST(? AS uuid[]))
                        """, (java.sql.ResultSet row) -> {
                    newer.put(row.getObject("id", UUID.class), Optional.ofNullable(row.getObject("next", Integer.class)));
                }, BoqInputs.uuidArray(modelVersions));
            }
            var runIds = scopes.stream().map(scope -> scope.revision().run()).filter(id -> id != null && !runEntries.containsKey(id))
                    .distinct().toList();
            runEntries.putAll(runs.requireAll(runIds));
            var pendingScopes = open.stream().filter(scope -> scope.revision().run() != null).toList();
            if (!pendingScopes.isEmpty()) {
                var pendingRuns = pendingScopes.stream().map(scope -> scope.revision().run()).filter(id -> !asked.containsKey(id)).distinct().toList();
                if (!pendingRuns.isEmpty()) {
                    for (UUID run : pendingRuns) asked.put(run, new HashSet<>());
                    database.query("SELECT run_id, question_id FROM run_questions WHERE run_id = ANY(CAST(? AS uuid[]))", (java.sql.ResultSet row) -> {
                        asked.get(row.getObject("run_id", UUID.class)).add(row.getString("question_id"));
                    }, BoqInputs.uuidArray(pendingRuns));
                }
                decisions(project.getId());
                projectDictionary(project);
                var bills = pendingScopes.stream().map(scope -> scope.bill().id()).distinct().filter(id -> !overrides.containsKey(id)).toList();
                overrides.putAll(inputs.overridesOf(bills));
                manual.putAll(inputs.manualItemsOf(bills));
            }
            for (boolean showNewer : List.of(true, false)) {
                var known = presets.get(showNewer);
                var ids = scopes.stream().filter(scope -> (scope.revision().status() != RevisionStatus.ISSUED) == showNewer)
                        .flatMap(scope -> BoqInputs.presetIds(scope.revision().inputs()).stream()).filter(Objects::nonNull).distinct()
                        .filter(id -> !known.containsKey(id)).toList();
                if (!ids.isEmpty()) for (var info : inputs.presetInfos(ids, showNewer)) known.put(info.getVersionId(), info);
            }
            var people = new HashSet<UUID>();
            for (var scope : scopes) {
                var r = scope.revision();
                people.add(scope.bill().confirmedBy());
                people.addAll(r.reviewers());
                people.add(r.submitter());
                people.add(r.approver());
                people.add(r.issuer());
            }
            people.remove(null);
            people.removeIf(users::containsKey);
            if (!people.isEmpty()) {
                for (UUID id : people) users.put(id, Optional.empty());
                database.query("SELECT id, name, email FROM users WHERE id = ANY(CAST(? AS uuid[])) AND deleted_at IS NULL", (java.sql.ResultSet row) -> {
                    UUID id = row.getObject("id", UUID.class);
                    users.put(id, Optional.of(new UserRef(id, row.getString("name")).email(row.getString("email"))));
                }, BoqInputs.uuidArray(people));
            }
            var revisions = scopes.stream().map(scope -> scope.revision().id()).filter(id -> !comments.containsKey(id)).distinct().toList();
            if (!revisions.isEmpty()) {
                for (UUID id : revisions) comments.put(id, new ArrayList<>());
                database.query(COMMENTS + " WHERE c.revision_id = ANY(CAST(? AS uuid[])) ORDER BY c.revision_id, c.created_at, c.id",
                        (java.sql.ResultSet row) -> {
                            comments.get(row.getObject("revision_id", UUID.class)).add(comment(row));
                        }, BoqInputs.uuidArray(revisions));
            }
            org(project.getOrgId());
            feature(project.getOrgId(), "approvalWorkflow");
        }
    }

    private RevisionInputs clean(RevisionInputs input) {
        var copy = json.read(json.object(input).toString(), RevisionInputs.class);
        for (var model : copy.getModels()) model.setNewerVersionAvailable(org.openapitools.jackson.nullable.JsonNullable.undefined());
        return copy;
    }

    private Map<String, Boolean> permissions(Scope scope, Loads loads) {
        UUID actor = loads.actor;
        var base = scope.project().getPermissions();
        var out = new LinkedHashMap<>(base);
        var rev = scope.revision();
        boolean live = !scope.bill().archived() && scope.bill().status() == Boq.StatusEnum.WORKING
                && rev.id().equals(scope.bill().current());
        boolean draft = rev.status() == RevisionStatus.DRAFT;
        boolean inReview = rev.status() == RevisionStatus.IN_REVIEW;
        boolean approved = rev.status() == RevisionStatus.APPROVED;
        if (!(live && draft)) EDITS.forEach(key -> out.put(key, false));
        boolean requiresApproval = approval(scope.project(), loads);
        boolean four = fourEyes(scope, loads);
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
        // An archived BoQ gets no new or edited share link (review A-39); revoking stays (`revokeShares`).
        if (scope.bill().archived()) out.put("share", false);
        out.put("shareWorking", allowed(out, "share") && shareWorkingRefusal(scope.project(), loads) == null);
        // An archived project is read-only (permissions.md, F02-AC4, TF-012): only view and seeAudit stay.
        if (scope.project().getStatus() == Project.StatusEnum.ARCHIVED) {
            out.replaceAll((key, value) -> value && (key.equals("view") || key.equals("seeAudit")));
        }
        return out;
    }

    private static final String COMMENTS = "SELECT c.*, u.name AS author FROM review_comments c JOIN users u ON u.id = c.author_id";

    List<ReviewComment> comments(UUID revision, String lineKey) {
        return database.query(COMMENTS + " WHERE c.revision_id = ?" + (lineKey == null ? "" : " AND c.line_key = ?")
                + " ORDER BY c.created_at, c.id", (row, index) -> comment(row), lineKey == null ? new Object[]{revision} : new Object[]{revision, lineKey});
    }

    private static ReviewComment comment(ResultSet row) throws SQLException {
        var comment = new ReviewComment(row.getObject("id", UUID.class),
                new UserRef(row.getObject("author_id", UUID.class), row.getString("author")),
                row.getObject("created_at", OffsetDateTime.class), row.getString("text")).lineKey(row.getString("line_key"));
        if (row.getString("outcome") != null) comment.setOutcome(ReviewComment.OutcomeEnum.fromValue(row.getString("outcome")));
        return comment;
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
