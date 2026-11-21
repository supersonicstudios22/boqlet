ALTER TABLE jobs ADD COLUMN metered boolean NOT NULL DEFAULT true;

CREATE TABLE sample_projects (
    project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    model_version_id uuid NOT NULL REFERENCES model_versions(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES users(id),
    run_id uuid REFERENCES runs(id) ON DELETE CASCADE,
    attempts integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now()
);
