CREATE TABLE models (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name text NOT NULL,
    discipline text NOT NULL,
    scope jsonb,
    latest_version_id uuid,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX models_by_project ON models (project_id);

CREATE TABLE jobs (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    project_id uuid,
    type text NOT NULL,
    pool text NOT NULL DEFAULT 'default',
    priority integer NOT NULL DEFAULT 5,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    input jsonb NOT NULL,
    output_prefix text NOT NULL,
    progress jsonb,
    output jsonb,
    error jsonb,
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    cancel_requested boolean NOT NULL DEFAULT false,
    transport text NOT NULL DEFAULT 'http',
    worker_id uuid,
    heartbeat_at timestamptz,
    available_at timestamptz NOT NULL DEFAULT now(),
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    started_at timestamptz,
    finished_at timestamptz,
    contract_version text NOT NULL DEFAULT '1',
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE
);
CREATE INDEX jobs_pending ON jobs (transport, priority, available_at, created_at) WHERE status = 'queued';
CREATE INDEX jobs_subject ON jobs (subject_type, subject_id);

CREATE TABLE model_versions (
    id uuid PRIMARY KEY,
    model_id uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    number integer NOT NULL,
    file_name text NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    source_key text NOT NULL,
    upload_key text NOT NULL,
    multipart_id text,
    sha256 text,
    identical_to_number integer,
    status text NOT NULL DEFAULT 'awaiting_upload' CHECK (status IN ('awaiting_upload','queued','processing','ready','failed')),
    parse_job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
    summary jsonb,
    artifacts jsonb,
    error jsonb,
    note text,
    uploaded_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (model_id, number)
);
CREATE INDEX model_versions_by_org_hash ON model_versions (org_id, sha256) WHERE status = 'ready';
ALTER TABLE models ADD FOREIGN KEY (latest_version_id) REFERENCES model_versions(id) DEFERRABLE INITIALLY DEFERRED;
