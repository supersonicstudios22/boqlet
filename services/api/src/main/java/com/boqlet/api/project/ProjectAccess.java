package com.boqlet.api.project;

import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.ApiException;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.contract.model.Project;
import com.boqlet.contract.model.ProjectDefaults;
import com.boqlet.contract.model.ProjectLocation;
import com.boqlet.contract.model.ProjectRole;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import static com.boqlet.contract.model.ProjectRole.*;

@Service
public class ProjectAccess {
    private static final String READ = """
            SELECT p.*, CASE WHEN m.role IN ('owner', 'admin') THEN 'lead' ELSE pm.role END AS effective_role,
                   coalesce((SELECT max(a.created_at) FROM audit_events a WHERE a.project_id = p.id), p.updated_at) AS activity
            FROM projects p JOIN orgs o ON o.id = p.org_id
            JOIN memberships m ON m.org_id = p.org_id AND m.user_id = ?
            LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = m.user_id
            WHERE o.status <> 'deleting' AND (m.role IN ('owner', 'admin') OR pm.role IS NOT NULL)
            """;

    /**
     * What an archived project still allows (permissions.md, P54): reading, unarchiving it (`archive`, Q53) and
     * revoking its share links (`revokeShares`, Q42). Promoting a name answer is an org action and stays allowed too.
     */
    private static final Set<String> ARCHIVED_ACTIONS = Set.of("view", "seeAudit", "archive", "revokeShares");
    private static final Set<ProjectRole> EDITING = Set.of(LEAD, ESTIMATOR);
    private static final Set<ProjectRole> APPROVAL = Set.of(LEAD, APPROVER);
    private static final Map<String, Set<ProjectRole>> ACTIONS = Map.ofEntries(
            Map.entry("view", Set.of(values())), Map.entry("edit", Set.of(LEAD)), Map.entry("archive", Set.of(LEAD)),
            Map.entry("manageMembers", Set.of(LEAD)), Map.entry("editModels", EDITING), Map.entry("editBoqs", EDITING),
            Map.entry("answerQuestions", EDITING), Map.entry("editLines", EDITING), Map.entry("editPresets", EDITING),
            Map.entry("saveVersion", EDITING), Map.entry("approve", APPROVAL), Map.entry("confirm", APPROVAL),
            Map.entry("reopen", Set.of(LEAD)), Map.entry("share", Set.of(LEAD, ESTIMATOR, APPROVER)),
            Map.entry("revokeShares", APPROVAL), Map.entry("seeAudit", APPROVAL));

    private final JdbcTemplate database;
    private final StoredJson json;
    private final OrgAccess orgs;
    private final com.boqlet.api.billing.EntitlementService entitlements;

    ProjectAccess(JdbcTemplate database, StoredJson json, OrgAccess orgs, com.boqlet.api.billing.EntitlementService entitlements) {
        this.database = database;
        this.json = json;
        this.orgs = orgs;
        this.entitlements = entitlements;
    }

    record Listed(Project project, OffsetDateTime activity) {}

    public Project require(UUID project, UUID actor) {
        Project found = database.query(READ + " AND p.id = ?", this::map, actor, project).stream()
                .findFirst().orElseThrow(ProjectAccess::missing).project();
        com.boqlet.api.http.LogContext.org(found.getOrgId());
        return withApproval(found, approvalOn(found.getOrgId()));
    }

    public Project lock(UUID project, UUID actor, String action) {
        Project visible = require(project, actor);
        orgs.lock(visible.getOrgId(), actor);
        database.queryForObject("SELECT id FROM projects WHERE id = ? FOR NO KEY UPDATE", UUID.class, project);
        Project locked = require(project, actor);
        role(locked, action);
        if (locked.getStatus() == Project.StatusEnum.ARCHIVED && !ARCHIVED_ACTIONS.contains(action)) {
            throw error(HttpStatus.CONFLICT, "project_archived", "The project is archived and read-only.");
        }
        return locked;
    }

    List<Listed> list(UUID org, UUID actor, String status, String query) {
        orgs.require(org, actor);
        String sql = READ + " AND p.org_id = ?";
        var params = new ArrayList<>(List.of((Object) actor, org));
        if (status != null) {
            sql += " AND p.status = ?";
            params.add(status);
        }
        if (query != null && !query.isBlank()) {
            sql += " AND (strpos(lower(p.name), ?) > 0 OR strpos(lower(p.code), ?) > 0 OR strpos(lower(p.client), ?) > 0)";
            String lower = query.toLowerCase(Locale.ROOT);
            params.addAll(List.of(lower, lower, lower));
        }
        boolean approval = approvalOn(org);
        var listed = database.query(sql + " ORDER BY activity DESC, p.id", this::map, params.toArray());
        listed.forEach(item -> withApproval(item.project(), approval));
        return listed;
    }

    /**
     * The keys `approve` and `confirm` follow the org's approval setting (permissions.md, TF-015): with approval
     * off nobody approves and only the lead confirms, as the BoQ's revision keys already say.
     */
    private static Project withApproval(Project project, boolean approval) {
        if (!approval) {
            project.getPermissions().put("approve", false);
            if (project.getMyRole() != LEAD) project.getPermissions().put("confirm", false);
        }
        return project;
    }

    /** Approval is on when the org asks for it and its plan has the workflow (as `BoqAccess.approval`). */
    private boolean approvalOn(UUID org) {
        return Boolean.TRUE.equals(database.queryForObject(
                "SELECT coalesce((settings->>'approvalRequired')::boolean, false) FROM orgs WHERE id = ?", Boolean.class, org))
                && entitlements.enabled(org, "approvalWorkflow");
    }

    public void role(Project project, String action) {
        var allowed = ACTIONS.get(action);
        if (!allowed.contains(project.getMyRole())) {
            // permissions.md "Errors": `{"required": "<role>"}`, the least project role that may (TF-013).
            String required = java.util.stream.Stream.of(VIEWER, ESTIMATOR, APPROVER, LEAD).filter(allowed::contains)
                    .findFirst().orElse(LEAD).getValue();
            throw new ApiException(HttpStatus.FORBIDDEN, "forbidden", "Your project role does not allow this.", Map.of("required", required));
        }
    }

    private Listed map(ResultSet row, int ignored) throws SQLException {
        var projectRole = ProjectRole.fromValue(row.getString("effective_role"));
        var status = Project.StatusEnum.fromValue(row.getString("status"));
        var permissions = new LinkedHashMap<String, Boolean>();
        ACTIONS.forEach((action, roles) -> permissions.put(action,
                roles.contains(projectRole) && (status == Project.StatusEnum.ACTIVE || ARCHIVED_ACTIONS.contains(action))));
        var project = new Project(row.getObject("id", UUID.class), row.getObject("org_id", UUID.class),
                row.getString("name"), row.getString("currency"), Project.UnitSystemEnum.fromValue(row.getString("unit_system")),
                row.getString("locale"), status, json.read(row.getString("defaults"), ProjectDefaults.class), permissions)
                .myRole(projectRole).code(row.getString("code")).client(row.getString("client"))
                .location(json.read(row.getString("location"), ProjectLocation.class)).sample(row.getBoolean("sample"))
                .projectDictionaryId(row.getObject("project_dictionary_id", UUID.class))
                .createdAt(row.getObject("created_at", OffsetDateTime.class))
                .updatedAt(row.getObject("updated_at", OffsetDateTime.class));
        return new Listed(project, row.getObject("activity", OffsetDateTime.class));
    }

    private static ApiException missing() {
        return error(HttpStatus.NOT_FOUND, "not_found", "The project was not found.");
    }

    static ApiException error(HttpStatus status, String code, String message) {
        return new ApiException(status, code, message, Map.of());
    }
}
