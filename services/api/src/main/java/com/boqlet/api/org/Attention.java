package com.boqlet.api.org;

import com.boqlet.api.db.StoredJson;
import com.boqlet.contract.model.AttentionItem;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

@Service
class Attention {
    private final NamedParameterJdbcTemplate database;
    private final OrgAccess access;
    private final StoredJson json;

    Attention(NamedParameterJdbcTemplate database, OrgAccess access, StoredJson json) {
        this.database = database;
        this.access = access;
        this.json = json;
    }

    List<AttentionItem> list(UUID org, UUID user) {
        access.require(org, user);
        return database.query("""
                WITH projects_visible AS (
                    SELECT p.id, p.name, '/' || o.slug || '/projects/' || p.id AS url
                    FROM projects p JOIN orgs o ON o.id = p.org_id
                    JOIN memberships m ON m.org_id = p.org_id AND m.user_id = :user
                    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = m.user_id
                    WHERE p.org_id = :org AND p.status = 'active'
                        AND (m.role IN ('owner','admin') OR pm.user_id IS NOT NULL)
                ), active_revisions AS (
                    SELECT p.id AS project, p.name AS project_name, b.name AS boq, b.created_by,
                        p.url || '/boqs/' || b.id AS url, r.* FROM projects_visible p
                    JOIN boqs b ON b.project_id = p.id AND NOT b.archived
                    JOIN boq_revisions r ON r.id = b.current_revision_id
                )
                SELECT * FROM (
                    SELECT 'review_requested' AS kind, r.project, r.project_name, 'Review ' || r.boq || ' ' || r.label AS title,
                        jsonb_build_object('boq', r.boq, 'revision', r.label) AS params, r.url || '?tab=review' AS url, r.submitted_at AS at
                    FROM active_revisions r WHERE status = 'in_review' AND :user = ANY(r.reviewers) AND r.submitted_by <> :user
                    UNION ALL
                    SELECT 'changes_requested', r.project, r.project_name, 'Changes requested on ' || r.boq || ' ' || r.label,
                        jsonb_build_object('boq', r.boq, 'revision', r.label), r.url || '?tab=review', c.created_at
                    FROM active_revisions r JOIN LATERAL (
                        SELECT outcome, created_at FROM review_comments c WHERE c.revision_id = r.id AND c.outcome IS NOT NULL
                        ORDER BY c.created_at DESC LIMIT 1
                    ) c ON c.outcome = 'changes_requested' WHERE status = 'draft' AND r.submitted_by = :user
                    UNION ALL
                    SELECT 'needs_input', r.project, r.project_name, r.boq || ' needs answers',
                        jsonb_build_object('boq', r.boq), r.url || '?tab=questions', n.finished_at
                    FROM active_revisions r JOIN runs n ON n.id = r.current_run_id
                    WHERE n.status = 'needs_input' AND n.created_by = :user AND EXISTS(
                        SELECT 1 FROM run_questions q WHERE q.run_id = n.id AND (q.question->>'blocking')::boolean
                        AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.project_id = r.project
                            AND d.question_id = q.question_id AND d.superseded_at IS NULL))
                    UNION ALL
                    SELECT 'new_model_version', r.project, r.project_name, m.name || ' v' || latest.number || ' for ' || r.boq,
                        jsonb_build_object('boq', r.boq, 'model', m.name, 'version', latest.number), r.url || '?tab=setup',
                        latest.uploaded_at FROM active_revisions r
                    CROSS JOIN LATERAL jsonb_array_elements(r.inputs->'models') chosen
                    JOIN models m ON m.id = (chosen->>'modelId')::uuid AND NOT m.archived
                    JOIN model_versions old ON old.id = (chosen->>'modelVersionId')::uuid
                    JOIN model_versions latest ON latest.id = m.latest_version_id AND latest.number > old.number
                    WHERE r.created_by = :user AND r.status <> 'issued'
                    UNION ALL
                    SELECT 'job_failed', p.id, p.name, 'A ' || j.type || ' job failed',
                        jsonb_strip_nulls(jsonb_build_object('type', j.type, 'code', j.error->>'code')),
                        p.url, j.finished_at FROM projects_visible p JOIN jobs j ON j.project_id = p.id
                    WHERE j.created_by = :user AND j.status = 'failed' AND j.finished_at >= now() - interval '7 days'
                ) attention ORDER BY at DESC NULLS LAST, project, kind
                """, Map.of("org", org, "user", user), (row, index) -> new AttentionItem(row.getString("kind"),
                    row.getObject("project", UUID.class), row.getString("project_name"), row.getString("title"), row.getString("url"))
                .params(json.read(row.getString("params"), Map.class)).at(row.getObject("at", OffsetDateTime.class)));
    }
}
