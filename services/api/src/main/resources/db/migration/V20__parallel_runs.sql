-- F04 edge cases (TF-094): a Generate after the inputs changed starts a new run beside the one still running
-- on the old inputs; the newest finished becomes current. Several active runs per revision are allowed.
DROP INDEX run_one_active_per_revision;
CREATE INDEX runs_active_by_revision ON runs(revision_id) WHERE status IN ('queued','running');
