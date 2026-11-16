CREATE TABLE boqs (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'working' CHECK (status IN ('working','confirmed')),
    confirmed_by uuid REFERENCES users(id),
    confirmed_at timestamptz,
    current_revision_id uuid NOT NULL,
    latest_issued_revision_id uuid,
    archived boolean NOT NULL DEFAULT false,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX boqs_by_project ON boqs(project_id);

CREATE TABLE boq_revisions (
    id uuid PRIMARY KEY,
    boq_id uuid NOT NULL REFERENCES boqs(id) ON DELETE CASCADE,
    number integer NOT NULL CHECK (number > 0),
    label text NOT NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','issued')),
    inputs jsonb NOT NULL,
    based_on_revision_id uuid REFERENCES boq_revisions(id),
    current_run_id uuid,
    reviewers uuid[] NOT NULL DEFAULT '{}',
    submitted_by uuid REFERENCES users(id),
    submitted_at timestamptz,
    approved_by uuid REFERENCES users(id),
    approved_at timestamptz,
    issued_by uuid REFERENCES users(id),
    issued_at timestamptz,
    issue_note text,
    open_questions_at_save integer,
    frozen jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(boq_id, number)
);
CREATE UNIQUE INDEX boq_one_working_revision ON boq_revisions (boq_id) WHERE status <> 'issued';
ALTER TABLE boqs ADD FOREIGN KEY (current_revision_id) REFERENCES boq_revisions(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE boqs ADD FOREIGN KEY (latest_issued_revision_id) REFERENCES boq_revisions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE review_comments (
    id uuid PRIMARY KEY,
    revision_id uuid NOT NULL REFERENCES boq_revisions(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES users(id),
    text text NOT NULL,
    line_key text,
    outcome text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_comments_revision ON review_comments(revision_id, created_at);

CREATE TABLE decisions (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    question_id text NOT NULL,
    kind text NOT NULL,
    answer jsonb NOT NULL,
    question jsonb,
    note text,
    decided_by uuid NOT NULL REFERENCES users(id),
    decided_at timestamptz NOT NULL DEFAULT now(),
    superseded_at timestamptz,
    promoted_to_preset_version_id uuid REFERENCES preset_versions(id)
);
CREATE UNIQUE INDEX decision_one_active ON decisions(project_id, question_id) WHERE superseded_at IS NULL;

CREATE TABLE line_overrides (
    id uuid PRIMARY KEY,
    boq_id uuid NOT NULL REFERENCES boqs(id) ON DELETE CASCADE,
    line_key text NOT NULL,
    edit jsonb NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(boq_id, line_key)
);

CREATE TABLE manual_items (
    id uuid PRIMARY KEY,
    boq_id uuid NOT NULL REFERENCES boqs(id) ON DELETE CASCADE,
    item jsonb NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX manual_items_by_boq ON manual_items(boq_id);
CREATE UNIQUE INDEX manual_item_unique_engine_id ON manual_items(boq_id, (item->'item'->>'id'));

CREATE TABLE boq_presence (
    boq_id uuid NOT NULL REFERENCES boqs(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    line_key text,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (boq_id, user_id)
);

CREATE TABLE runs (
    id uuid PRIMARY KEY,
    revision_id uuid NOT NULL REFERENCES boq_revisions(id) ON DELETE CASCADE,
    org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    job_id uuid NOT NULL REFERENCES jobs(id),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','complete','needs_input','failed','cancelled')),
    snapshot_versions jsonb NOT NULL,
    input_snapshot jsonb NOT NULL,
    result_key text,
    xlsx_key text,
    stats jsonb,
    models jsonb,
    building jsonb,
    classifications jsonb NOT NULL,
    error jsonb,
    engine_version text,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);
CREATE INDEX runs_by_revision ON runs(revision_id, created_at DESC);
CREATE UNIQUE INDEX run_one_active_per_revision ON runs(revision_id) WHERE status IN ('queued','running');
ALTER TABLE boq_revisions ADD FOREIGN KEY (current_run_id) REFERENCES runs(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE run_lines (
    run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    sort_index integer NOT NULL,
    line_key text NOT NULL,
    line jsonb NOT NULL,
    PRIMARY KEY(run_id, line_key),
    UNIQUE(run_id, sort_index)
);
CREATE TABLE run_line_elements (
    run_id uuid NOT NULL,
    line_key text NOT NULL,
    guid text NOT NULL,
    model_version_id uuid,
    FOREIGN KEY(run_id, line_key) REFERENCES run_lines(run_id, line_key) ON DELETE CASCADE
);
CREATE INDEX run_line_elements_by_guid ON run_line_elements(run_id, guid);
CREATE INDEX run_line_elements_by_model ON run_line_elements(run_id, model_version_id, line_key);
CREATE INDEX run_line_elements_by_line ON run_line_elements(run_id, line_key);

CREATE TABLE run_questions (
    run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    question_id text NOT NULL,
    sort_index integer NOT NULL,
    question jsonb NOT NULL,
    PRIMARY KEY(run_id, question_id)
);
CREATE TABLE run_warnings (
    run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    seq integer NOT NULL,
    warning jsonb NOT NULL,
    PRIMARY KEY(run_id, seq)
);
CREATE TABLE run_log_entries (
    run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    seq integer NOT NULL,
    entry jsonb NOT NULL,
    PRIMARY KEY(run_id, seq)
);
CREATE INDEX run_log_by_line ON run_log_entries (run_id, (entry->>'lineKey'));

CREATE TABLE exports (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision_id uuid REFERENCES boq_revisions(id) ON DELETE CASCADE,
    kind text NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    file_name text NOT NULL,
    storage_key text,
    size_bytes bigint,
    job_id uuid REFERENCES jobs(id),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exports_by_revision ON exports(revision_id, created_at DESC);

CREATE TABLE run_diffs (
    id uuid PRIMARY KEY,
    from_run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    to_run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    job_id uuid NOT NULL REFERENCES jobs(id),
    diff_key text,
    summary jsonb,
    questions jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(from_run_id, to_run_id)
);
CREATE TABLE diff_lines (
    diff_id uuid NOT NULL REFERENCES run_diffs(id) ON DELETE CASCADE,
    seq integer NOT NULL,
    row_data jsonb NOT NULL,
    PRIMARY KEY (diff_id, seq)
);
CREATE TABLE diff_elements (
    diff_id uuid NOT NULL REFERENCES run_diffs(id) ON DELETE CASCADE,
    seq integer NOT NULL,
    row_data jsonb NOT NULL,
    PRIMARY KEY (diff_id, seq)
);

CREATE TABLE edits_import_reports (
    job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    report_key text NOT NULL
);
