CREATE TABLE idempotency_keys (
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    key text NOT NULL,
    response_status integer,
    response jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, endpoint, key),
    CHECK (length(key) BETWEEN 1 AND 255),
    CHECK (response_status IS NULL OR response_status BETWEEN 200 AND 599)
);

CREATE INDEX idempotency_keys_created_at ON idempotency_keys (created_at);

CREATE TABLE audit_events (
    id uuid PRIMARY KEY,
    org_id uuid,
    project_id uuid,
    actor_id uuid,
    actor_kind text NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    request_id text,
    ip inet,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (actor_kind IN ('user', 'system', 'platform_admin'))
);

CREATE INDEX audit_events_org_created_at ON audit_events (org_id, created_at DESC);
CREATE INDEX audit_events_project_created_at ON audit_events (project_id, created_at DESC);
