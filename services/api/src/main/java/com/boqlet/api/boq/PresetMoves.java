package com.boqlet.api.boq;

import com.boqlet.api.library.PresetCatalog;
import com.boqlet.api.project.ProjectAccess;
import com.boqlet.api.project.Projects;
import com.boqlet.contract.model.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Review A-44 (DEC-44): "Move working BoQs to the latest" from a preset's Where used. Each working BoQ the caller
 * can see whose working version uses an older published version of the preset gets the latest one through the
 * same path as an edit of its inputs (pending, not regenerated); saved versions never move (BR-07). Versions in
 * review, BoQs the caller can't edit and archived projects are skipped and listed, never moved silently.
 */
@Service
public class PresetMoves {
    private static final String USES_OLDER = """
             EXISTS (SELECT 1 FROM preset_versions v WHERE v.preset_id = ? AND v.id <> ? AND v.status = 'published' AND (
                v.id::text IN (%1$s->>'ruleSetVersionId', %1$s->>'federationVersionId', %1$s->>'resolutionVersionId')
                OR coalesce(%1$s->'classificationVersionIds', '[]') @> jsonb_build_array(v.id::text)
                OR coalesce(%1$s->'dictionaryVersionIds', '[]') @> jsonb_build_array(v.id::text)))
            """;
    private static final String VISIBLE = """
            JOIN orgs o ON o.id = pr.org_id AND o.status <> 'deleting'
            JOIN memberships m ON m.org_id = pr.org_id AND m.user_id = ?
            LEFT JOIN project_members pm ON pm.project_id = pr.id AND pm.user_id = m.user_id
            """;

    private final JdbcTemplate database;
    private final Boqs boqs;
    private final BoqAccess access;
    private final ProjectAccess projectAccess;
    private final Projects projects;

    PresetMoves(JdbcTemplate database, Boqs boqs, BoqAccess access, ProjectAccess projectAccess, Projects projects) {
        this.database = database;
        this.boqs = boqs;
        this.access = access;
        this.projectAccess = projectAccess;
        this.projects = projects;
    }

    @Transactional
    public MovePresetToLatest200Response move(PresetCatalog.Head head, UUID actor, boolean projectDefaults) {
        UUID latest = head.published();
        if (latest == null) throw BoqAccess.failure(HttpStatus.CONFLICT, "no_published_version", "The preset has no published version.");
        var older = new HashSet<>(database.queryForList(
                "SELECT id FROM preset_versions WHERE preset_id = ? AND status = 'published' AND id <> ?", UUID.class, head.id(), latest));
        var result = new MovePresetToLatest200Response(latest, new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
        var rows = database.queryForList("""
                SELECT b.id AS boq_id, b.name AS boq_name, pr.id AS project_id, pr.name AS project_name, pr.status AS project_status,
                    r.id AS revision_id, r.status AS revision_status
                FROM boqs b JOIN boq_revisions r ON r.id = b.current_revision_id JOIN projects pr ON pr.id = b.project_id
                """ + VISIBLE + """
                WHERE (m.role IN ('owner','admin') OR pm.role IS NOT NULL) AND NOT b.archived AND b.status = 'working'
                    AND r.status <> 'issued' AND """ + " " + USES_OLDER.formatted("r.inputs") + """
                ORDER BY lower(pr.name), lower(b.name), b.id
                """, actor, head.id(), latest);
        for (var row : rows) {
            UUID project = (UUID) row.get("project_id");
            String projectName = (String) row.get("project_name");
            UUID boq = (UUID) row.get("boq_id");
            String boqName = (String) row.get("boq_name");
            String reason = null;
            if ("archived".equals(row.get("project_status"))) reason = "project_archived";
            else if (!"draft".equals(row.get("revision_status"))) reason = "in_review";
            else if (!Boolean.TRUE.equals(projectAccess.require(project, actor).getPermissions().get("editBoqs"))) reason = "no_permission";
            if (reason != null) {
                result.getSkipped().add(new MovePresetToLatest200ResponseSkippedInner(project, projectName,
                        MovePresetToLatest200ResponseSkippedInner.ReasonEnum.fromValue(reason)).boqId(boq).boqName(boqName));
                continue;
            }
            UUID revision = (UUID) row.get("revision_id");
            boqs.updateInputs(revision, actor, patch(access.readVersion(revision).inputs(), older, latest));
            result.getMoved().add(new MovePresetToLatest200ResponseMovedInner(boq, boqName, project, projectName, revision));
        }
        if (projectDefaults) {
            var listed = database.queryForList("""
                    SELECT DISTINCT pr.id AS project_id, pr.name AS project_name, pr.status AS project_status, lower(pr.name) AS sort
                    FROM projects pr
                    """ + VISIBLE + """
                    WHERE (m.role IN ('owner','admin') OR pm.role IS NOT NULL) AND """ + " " + USES_OLDER.formatted("pr.defaults") + """
                    ORDER BY sort, pr.id
                    """, actor, head.id(), latest);
            for (var row : listed) {
                UUID project = (UUID) row.get("project_id");
                String name = (String) row.get("project_name");
                var visible = projectAccess.require(project, actor);
                String reason = "archived".equals(row.get("project_status")) ? "project_archived"
                        : Boolean.TRUE.equals(visible.getPermissions().get("edit")) ? null : "no_permission";
                if (reason != null) {
                    result.getSkipped().add(new MovePresetToLatest200ResponseSkippedInner(project, name,
                            MovePresetToLatest200ResponseSkippedInner.ReasonEnum.fromValue(reason)));
                    continue;
                }
                projects.update(project, actor, new ProjectUpdate().defaults(defaults(visible.getDefaults(), older, latest)));
                result.getProjects().add(new MovePresetToLatest200ResponseProjectsInner(project, name));
            }
        }
        return result;
    }

    /** Only the inputs that use an older version change (an edit of those inputs, as the Setup tab makes). */
    private static RevisionInputsPartial patch(RevisionInputs inputs, Set<UUID> older, UUID latest) {
        var patch = new RevisionInputsPartial();
        if (older.contains(inputs.getRuleSetVersionId())) patch.ruleSetVersionId(latest);
        if (inputs.getClassificationVersionIds().stream().anyMatch(older::contains)) {
            patch.classificationVersionIds(replaced(inputs.getClassificationVersionIds(), older, latest));
        }
        if (inputs.getDictionaryVersionIds().stream().anyMatch(older::contains)) {
            patch.dictionaryVersionIds(replaced(inputs.getDictionaryVersionIds(), older, latest));
        }
        if (older.contains(inputs.getFederationVersionId().orElse(null))) patch.federationVersionId(latest);
        if (older.contains(inputs.getResolutionVersionId().orElse(null))) patch.resolutionVersionId(latest);
        return patch;
    }

    private static ProjectDefaults defaults(ProjectDefaults current, Set<UUID> older, UUID latest) {
        var next = new ProjectDefaults()
                .ruleSetVersionId(current.getRuleSetVersionId().orElse(null))
                .classificationVersionIds(current.getClassificationVersionIds() == null ? List.of() : current.getClassificationVersionIds())
                .dictionaryVersionIds(current.getDictionaryVersionIds() == null ? List.of() : current.getDictionaryVersionIds())
                .federationVersionId(current.getFederationVersionId().orElse(null));
        if (older.contains(next.getRuleSetVersionId().orElse(null))) next.ruleSetVersionId(latest);
        next.classificationVersionIds(replaced(next.getClassificationVersionIds(), older, latest));
        next.dictionaryVersionIds(replaced(next.getDictionaryVersionIds(), older, latest));
        if (older.contains(next.getFederationVersionId().orElse(null))) next.federationVersionId(latest);
        return next;
    }

    private static List<UUID> replaced(List<UUID> ids, Set<UUID> older, UUID latest) {
        var out = new LinkedHashSet<UUID>();
        ids.forEach(id -> out.add(older.contains(id) ? latest : id));
        return new ArrayList<>(out);
    }
}
