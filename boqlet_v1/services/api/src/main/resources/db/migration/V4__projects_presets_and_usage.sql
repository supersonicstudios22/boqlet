CREATE TABLE projects (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name text NOT NULL,
    code text,
    client text,
    location jsonb,
    currency text NOT NULL,
    unit_system text NOT NULL CHECK (unit_system IN ('metric', 'imperial')),
    locale text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    sample boolean NOT NULL DEFAULT false,
    defaults jsonb NOT NULL DEFAULT '{}',
    project_dictionary_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, id)
);
CREATE INDEX projects_by_org_status ON projects (org_id, status);

CREATE TABLE project_members (
    org_id uuid NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL CHECK (role IN ('lead', 'estimator', 'approver', 'viewer')),
    added_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
    FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id) ON DELETE CASCADE
);
CREATE INDEX project_members_by_org_user ON project_members (org_id, user_id);

CREATE TABLE presets (
    id uuid PRIMARY KEY,
    org_id uuid REFERENCES orgs(id) ON DELETE CASCADE,
    project_id uuid,
    layer text NOT NULL CHECK (layer IN ('system', 'org', 'project')),
    kind text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    based_on text,
    starred boolean NOT NULL DEFAULT false,
    latest_published_version_id uuid,
    draft_version_id uuid,
    archived boolean NOT NULL DEFAULT false,
    unavailable_reason text,
    updated_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (org_id, project_id, kind, slug),
    FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE,
    CHECK ((layer = 'system' AND org_id IS NULL AND project_id IS NULL)
        OR (layer = 'org' AND org_id IS NOT NULL AND project_id IS NULL)
        OR (layer = 'project' AND org_id IS NOT NULL AND project_id IS NOT NULL))
);

CREATE TABLE preset_versions (
    id uuid PRIMARY KEY,
    preset_id uuid NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
    number integer,
    status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
    doc jsonb,
    doc_key text,
    extends_version_id uuid REFERENCES preset_versions(id),
    problems jsonb NOT NULL DEFAULT '[]',
    change_note text,
    etag integer NOT NULL DEFAULT 1,
    published_by uuid REFERENCES users(id),
    published_at timestamptz,
    updated_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (preset_id, number)
);
CREATE INDEX preset_versions_by_preset ON preset_versions (preset_id, status);

ALTER TABLE projects ADD FOREIGN KEY (project_dictionary_id) REFERENCES presets(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE presets ADD FOREIGN KEY (latest_published_version_id) REFERENCES preset_versions(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE presets ADD FOREIGN KEY (draft_version_id) REFERENCES preset_versions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE usage_events (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    project_id uuid,
    job_id uuid NOT NULL UNIQUE,
    kind text NOT NULL CHECK (kind IN ('parse', 'run', 'preview')),
    started_at timestamptz NOT NULL,
    duration_ms bigint NOT NULL CHECK (duration_ms >= 0),
    model_bytes bigint CHECK (model_bytes >= 0),
    element_count bigint CHECK (element_count >= 0),
    outcome text NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE
);
CREATE INDEX usage_events_by_org_at ON usage_events (org_id, at);
