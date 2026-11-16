package com.boqlet.api.project;

import com.boqlet.api.audit.AuditWriter;
import com.boqlet.api.billing.EntitlementService;
import com.boqlet.api.db.Ids;
import com.boqlet.api.db.StoredJson;
import com.boqlet.api.http.RequestContext;
import com.boqlet.api.identity.IdentityService;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.contract.model.*;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class Projects {
    private final JdbcTemplate database;
    private final OrgAccess orgs;
    private final ProjectAccess access;
    private final ProjectPresets presets;
    private final EntitlementService limits;
    private final StoredJson json;
    private final AuditWriter audit;

    Projects(JdbcTemplate database, OrgAccess orgs, ProjectAccess access, ProjectPresets presets,
             EntitlementService limits, StoredJson json, AuditWriter audit) {
        this.database = database;
        this.orgs = orgs;
        this.access = access;
        this.presets = presets;
        this.limits = limits;
        this.json = json;
        this.audit = audit;
    }

    List<ProjectListItem> list(UUID org, UUID actor, String status, String query) {
        return access.list(org, actor, status, query).stream().map(row -> {
            var item = json.read(json.object(row.project()).toString(), ProjectListItem.class);
            return item.lastActivityAt(row.activity());
        }).toList();
    }

    @Transactional
    public Project create(UUID org, UUID actor, ProjectCreate request) {
        OrgSettings settings = orgs.lock(org, actor).org().getSettings();
        if (request.getSample() != null) {
            throw ProjectAccess.error(HttpStatus.NOT_IMPLEMENTED, "sample_unavailable",
                    "The sample project requires the model and BoQ backend.");
        }
        limits.checkCapacity(org, actor, "activeProjects", limits.activeProjects(org));
        UUID project = Ids.newId();
        UUID dictionary = Ids.newId();
        String name = name(request.getName());
        ProjectDefaults defaults = request.getDefaults() == null ? presets.defaults(org) : request.getDefaults();
        presets.validate(org, project, defaults);
        database.update("""
                INSERT INTO projects (id, org_id, name, code, client, location, currency, unit_system, locale,
                                      defaults, project_dictionary_id)
                VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?, CAST(? AS jsonb), ?)
                """, project, org, name, request.getCode(), request.getClient(), encode(request.getLocation()),
                first(request.getCurrency(), settings.getDefaultCurrency(), "EUR"),
                first(request.getUnitSystem() == null ? null : request.getUnitSystem().getValue(),
                        settings.getDefaultUnitSystem() == null ? null : settings.getDefaultUnitSystem().getValue(), "metric"),
                first(request.getLocale(), settings.getDefaultLocale(), "en"), encode(defaults), dictionary);
        presets.createDictionary(org, project, actor, dictionary, name);
        database.update("INSERT INTO project_members (org_id, project_id, user_id, role) VALUES (?, ?, ?, 'lead')", org, project, actor);
        record(org, project, actor, "project.created", "project", project, Map.of("name", name, "sample", false));
        return access.require(project, actor);
    }

    @Transactional
    public Project update(UUID project, UUID actor, ProjectUpdate request) {
        Project current = access.lock(project, actor, "edit");
        String name = request.getName() == null ? current.getName() : name(request.getName());
        if (request.getDefaults() != null) presets.validate(current.getOrgId(), project, request.getDefaults());
        database.update("""
                UPDATE projects SET name = ?, code = coalesce(?, code), client = coalesce(?, client),
                    location = coalesce(CAST(? AS jsonb), location), currency = coalesce(?, currency),
                    unit_system = coalesce(?, unit_system), locale = coalesce(?, locale),
                    defaults = coalesce(CAST(? AS jsonb), defaults), updated_at = now() WHERE id = ?
                """, name, request.getCode(), request.getClient(), encode(request.getLocation()), request.getCurrency(),
                request.getUnitSystem() == null ? null : request.getUnitSystem().getValue(), request.getLocale(),
                encode(request.getDefaults()), project);
        record(current.getOrgId(), project, actor, "project.updated", "project", project, Map.of());
        return access.require(project, actor);
    }

    @Transactional
    public Project status(UUID project, UUID actor, Project.StatusEnum status) {
        Project current = access.lock(project, actor, "archive");
        if (current.getStatus() == status) return current;
        UUID org = current.getOrgId();
        if (status == Project.StatusEnum.ACTIVE && !Boolean.TRUE.equals(current.getSample())) {
            limits.checkCapacity(org, actor, "activeProjects", limits.activeProjects(org));
        }
        database.update("UPDATE projects SET status = ?, updated_at = now() WHERE id = ?", status.getValue(), project);
        record(org, project, actor, status == Project.StatusEnum.ACTIVE ? "project.restored" : "project.archived",
                "project", project, Map.of());
        return access.require(project, actor);
    }

    List<ProjectMember> members(UUID project, UUID actor) {
        access.require(project, actor);
        return queryMembers(project, null);
    }

    @Transactional
    public ProjectMember addMember(UUID project, UUID actor, UUID user, ProjectRole role) {
        UUID org = access.lock(project, actor, "manageMembers").getOrgId();
        int joined = database.update("""
                INSERT INTO project_members (org_id, project_id, user_id, role, added_by)
                SELECT m.org_id, ?, m.user_id, ?, ? FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.org_id = ? AND m.user_id = ? AND u.deleted_at IS NULL
                ON CONFLICT DO NOTHING
                """, project, role.getValue(), actor, org, user);
        if (joined == 0) {
            if (queryMembers(project, user).isEmpty()) {
                throw ProjectAccess.error(HttpStatus.CONFLICT, "not_org_member", "Only organisation members can join a project.");
            }
            throw ProjectAccess.error(HttpStatus.CONFLICT, "already_member", "Already a project member.");
        }
        record(org, project, actor, "project.member_added", "user", user, Map.of("role", role.getValue()));
        return member(project, user);
    }

    @Transactional
    public ProjectMember updateMember(UUID project, UUID actor, UUID user, ProjectRole role) {
        UUID org = access.lock(project, actor, "manageMembers").getOrgId();
        ProjectRole previous = member(project, user).getRole();
        if (role != ProjectRole.LEAD) keepLead(project, previous);
        database.update("UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?",
                role.getValue(), project, user);
        record(org, project, actor, "project.member_role_changed", "user", user,
                Map.of("from", previous.getValue(), "to", role.getValue()));
        return member(project, user);
    }

    @Transactional
    public void removeMember(UUID project, UUID actor, UUID user) {
        UUID org = access.lock(project, actor, "manageMembers").getOrgId();
        keepLead(project, member(project, user).getRole());
        database.update("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", project, user);
        record(org, project, actor, "project.member_removed", "user", user, Map.of());
    }

    private List<ProjectMember> queryMembers(UUID project, UUID user) {
        String select = """
                SELECT u.*, m.role, m.added_by, by_user.name AS adder_name, by_user.email AS adder_email
                FROM project_members m JOIN users u ON u.id = m.user_id
                LEFT JOIN users by_user ON by_user.id = m.added_by AND by_user.deleted_at IS NULL
                WHERE m.project_id = ? AND u.deleted_at IS NULL
                """;
        return database.query(select + (user == null ? " ORDER BY u.name, u.id" : " AND m.user_id = ?"), (row, index) -> {
            var member = new ProjectMember(IdentityService.mapUser(row, index), ProjectRole.fromValue(row.getString("role")));
            if (row.getString("adder_name") != null) member.setAddedBy(
                    new UserRef(row.getObject("added_by", UUID.class), row.getString("adder_name")).email(row.getString("adder_email")));
            return member;
        }, user == null ? new Object[]{project} : new Object[]{project, user});
    }

    private ProjectMember member(UUID project, UUID user) {
        return queryMembers(project, user).stream().findFirst().orElseThrow(() ->
                ProjectAccess.error(HttpStatus.NOT_FOUND, "not_found", "The project member was not found."));
    }

    private void keepLead(UUID project, ProjectRole role) {
        if (role == ProjectRole.LEAD && database.queryForObject(
                "SELECT count(*) FROM project_members WHERE project_id = ? AND role = 'lead'", Long.class, project) <= 1) {
            throw ProjectAccess.error(HttpStatus.CONFLICT, "last_lead", "A project needs at least one lead.");
        }
    }

    private void record(UUID org, UUID project, UUID actor, String action, String type, UUID subject, Map<String, ?> data) {
        audit.record(new RequestContext(actor, null, org, null), AuditWriter.ActorKind.USER,
                project, action, type, subject, json.object(data));
    }

    private String encode(Object value) {
        return value == null ? null : json.object(value).toString();
    }

    private static String name(String value) {
        if (value.isBlank()) throw ProjectAccess.error(HttpStatus.BAD_REQUEST, "invalid_body", "The name can't be empty.");
        return value.strip();
    }

    private static String first(String requested, String configured, String fallback) {
        return requested != null ? requested : configured != null ? configured : fallback;
    }
}
