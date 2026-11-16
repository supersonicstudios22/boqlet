package com.boqlet.api.project;

import com.boqlet.api.audit.AuditReader;
import com.boqlet.api.identity.Login;
import com.boqlet.contract.api.ProjectsApi;
import com.boqlet.contract.model.*;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
class ProjectController implements ProjectsApi {
    private final Projects projects;
    private final ProjectAccess access;
    private final AuditReader audit;

    ProjectController(Projects projects, ProjectAccess access, AuditReader audit) {
        this.projects = projects;
        this.access = access;
        this.audit = audit;
    }

    @Override
    public ResponseEntity<List<ProjectListItem>> listProjects(UUID org, String status, String query) {
        return ResponseEntity.ok(projects.list(org, actor(), status, query));
    }

    @Override
    public ResponseEntity<Project> createProject(UUID org, ProjectCreate request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(projects.create(org, actor(), request));
    }

    @Override
    public ResponseEntity<Project> getProject(UUID project) {
        return ResponseEntity.ok(access.require(project, actor()));
    }

    @Override
    public ResponseEntity<Project> updateProject(UUID project, ProjectUpdate request) {
        return ResponseEntity.ok(projects.update(project, actor(), request));
    }

    @Override
    public ResponseEntity<Project> archiveProject(UUID project) {
        return ResponseEntity.ok(projects.status(project, actor(), Project.StatusEnum.ARCHIVED));
    }

    @Override
    public ResponseEntity<Project> unarchiveProject(UUID project) {
        return ResponseEntity.ok(projects.status(project, actor(), Project.StatusEnum.ACTIVE));
    }

    @Override
    public ResponseEntity<List<ProjectMember>> listProjectMembers(UUID project) {
        return ResponseEntity.ok(projects.members(project, actor()));
    }

    @Override
    public ResponseEntity<ProjectMember> addProjectMember(UUID project, AddProjectMemberRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(projects.addMember(project, actor(), request.getUserId(), request.getRole()));
    }

    @Override
    public ResponseEntity<ProjectMember> updateProjectMember(UUID project, UUID user, UpdateProjectMemberRequest request) {
        return ResponseEntity.ok(projects.updateMember(project, actor(), user, request.getRole()));
    }

    @Override
    public ResponseEntity<Void> removeProjectMember(UUID project, UUID user) {
        projects.removeMember(project, actor(), user);
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<AuditPage> listProjectAudit(UUID project, String cursor, Integer limit, String actorId,
                                                     String action, String entityType, OffsetDateTime from,
                                                     OffsetDateTime to) {
        Project visible = access.require(project, actor());
        access.role(visible, "seeAudit");
        return ResponseEntity.ok(audit.page(visible.getOrgId(), project, cursor, limit, actorId, action, entityType, from, to));
    }

    private static UUID actor() {
        return Login.current().userId();
    }
}
