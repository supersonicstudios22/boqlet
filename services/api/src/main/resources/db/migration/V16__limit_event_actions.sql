-- A limit event's action is now the refused operation (createProject, inviteMember, ...), as the
-- mock and the admin console show it (F19); every row is a refusal. The orgs table counts them all.
-- Compatible with the previous image, which writes 'refused'.
CREATE OR REPLACE VIEW admin_org_rows AS
SELECT o.id, o.name, o.slug, o.settings->>'country' AS country, o.status, o.tags, o.created_at,
    s.plan_id, s.status AS subscription_status, s.trial_ends_at,
    p.entitlements || s.overrides AS entitlements,
    owner.email AS owner_email, owner.signed_up, o.created_at AS org_at,
    greatest(o.updated_at, (SELECT max(a.created_at) FROM audit_events a WHERE a.org_id = o.id)) AS activity_at,
    (SELECT count(*) FROM memberships m WHERE m.org_id = o.id) +
        (SELECT count(*) FROM org_invitations i WHERE i.org_id = o.id AND i.status = 'pending' AND i.expires_at > now()) AS seats,
    (SELECT count(*) FROM projects r WHERE r.org_id = o.id AND r.status = 'active' AND NOT r.sample) AS active_projects,
    (SELECT round(coalesce(sum(u.duration_ms), 0) / 60000.0, 2)
      FROM usage_events u WHERE u.org_id = o.id AND u.at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AND u.at < (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC') AS processing_minutes,
    (SELECT count(*) FROM limit_events l WHERE l.org_id = o.id AND l.at >= now() - interval '30 days') AS limit_hits,
    x.setup_at, x.model_at, x.boq_at, x.saved_at, x.shared_at
FROM orgs o JOIN subscriptions s ON s.org_id = o.id JOIN plans p ON p.id = s.plan_id
LEFT JOIN admin_org_milestones x ON x.org_id = o.id
LEFT JOIN LATERAL (
    SELECT u.email, u.created_at AS signed_up FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.org_id = o.id AND m.role = 'owner' ORDER BY m.created_at, m.user_id LIMIT 1
) owner ON true
WHERE o.status <> 'deleting';
