CREATE TABLE plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    entitlements jsonb NOT NULL,
    public boolean NOT NULL DEFAULT true,
    default_plan boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX plans_one_default ON plans (default_plan) WHERE default_plan;

INSERT INTO plans (id, name, entitlements, public, default_plan) VALUES
    ('free', 'Free', '{"seats":2,"activeProjects":1,"maxModelVersionMb":50,"maxModelsPerBoq":2,"processingMinutesPerMonth":60,"libraryOrgPresets":1,"shareLinks":true,"approvalWorkflow":false,"exportWatermark":true,"auditLogRetentionDays":30}', true, true),
    ('professional', 'Professional', '{"seats":5,"activeProjects":10,"maxModelVersionMb":300,"maxModelsPerBoq":6,"processingMinutesPerMonth":1000,"shareLinks":true,"approvalWorkflow":true,"exportWatermark":false,"auditLogRetentionDays":365}', true, false),
    ('team', 'Team', '{"seats":25,"activeProjects":50,"maxModelVersionMb":300,"maxModelsPerBoq":12,"processingMinutesPerMonth":5000,"shareLinks":true,"approvalWorkflow":true,"exportWatermark":false,"auditLogRetentionDays":365}', true, false),
    ('enterprise', 'Enterprise', '{"shareLinks":true,"approvalWorkflow":true,"exportWatermark":false}', true, false);

CREATE TABLE subscriptions (
    org_id uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
    plan_id text NOT NULL REFERENCES plans(id),
    status text NOT NULL DEFAULT 'active',
    provider text NOT NULL DEFAULT 'manual',
    trial_ends_at timestamptz,
    current_period_end timestamptz,
    overrides jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO subscriptions (org_id, plan_id)
SELECT orgs.id, plans.id FROM orgs CROSS JOIN plans WHERE plans.default_plan;

ALTER TABLE org_invitations ADD COLUMN delivery_nonce uuid;

CREATE TABLE email_outbox (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    kind text NOT NULL,
    entity_id uuid NOT NULL,
    recipient text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}',
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    canceled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_outbox_pending ON email_outbox (next_attempt_at, id)
WHERE sent_at IS NULL AND canceled_at IS NULL;

CREATE TABLE limit_events (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id),
    limit_name text NOT NULL,
    current_value numeric NOT NULL,
    max_value numeric NOT NULL,
    action text NOT NULL,
    at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX limit_events_by_org ON limit_events (org_id, at DESC);
