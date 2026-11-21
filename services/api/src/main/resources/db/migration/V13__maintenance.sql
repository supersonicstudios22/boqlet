ALTER TABLE runs ADD COLUMN indexed_at timestamptz;
UPDATE runs SET indexed_at = coalesce(finished_at, created_at) WHERE result_key IS NOT NULL;
CREATE INDEX runs_pruning ON runs(indexed_at) WHERE indexed_at IS NOT NULL AND result_key IS NOT NULL;

CREATE TABLE org_milestone_history (
    org_id uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
    setup_at timestamptz,
    model_at timestamptz,
    boq_at timestamptz,
    saved_at timestamptz,
    shared_at timestamptz
);
INSERT INTO org_milestone_history SELECT * FROM admin_org_milestones;
CREATE OR REPLACE VIEW admin_org_milestones AS
SELECT org_id, setup_at, model_at, boq_at, saved_at, shared_at FROM org_milestone_history;

CREATE FUNCTION record_org_milestone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO org_milestone_history (org_id, setup_at, model_at, boq_at, saved_at, shared_at)
    SELECT NEW.org_id,
        CASE WHEN NEW.action IN ('org.setup_done','setup.completed') THEN NEW.created_at END,
        CASE WHEN NEW.action = 'model_version.ready' THEN NEW.created_at END,
        CASE WHEN NEW.action = 'run.completed' THEN NEW.created_at END,
        CASE WHEN NEW.action = 'version.saved' THEN NEW.created_at END,
        CASE WHEN NEW.action IN ('export.created','share_link.created') THEN NEW.created_at END
    WHERE EXISTS (SELECT 1 FROM orgs WHERE id = NEW.org_id)
    ON CONFLICT (org_id) DO UPDATE SET
        setup_at = least(org_milestone_history.setup_at, EXCLUDED.setup_at),
        model_at = least(org_milestone_history.model_at, EXCLUDED.model_at),
        boq_at = least(org_milestone_history.boq_at, EXCLUDED.boq_at),
        saved_at = least(org_milestone_history.saved_at, EXCLUDED.saved_at),
        shared_at = least(org_milestone_history.shared_at, EXCLUDED.shared_at);
    RETURN NEW;
END
$$;
CREATE TRIGGER audit_record_org_milestone AFTER INSERT ON audit_events FOR EACH ROW
    WHEN (NEW.org_id IS NOT NULL AND NEW.action IN (
        'org.setup_done','setup.completed','model_version.ready','run.completed','version.saved','export.created','share_link.created'))
    EXECUTE FUNCTION record_org_milestone();

CREATE TABLE limit_notifications (
    org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    limit_name text NOT NULL,
    kind text NOT NULL,
    period date NOT NULL,
    PRIMARY KEY (org_id, limit_name, kind, period)
);
