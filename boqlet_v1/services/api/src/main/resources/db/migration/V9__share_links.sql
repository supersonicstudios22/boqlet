CREATE TABLE share_links (
    id uuid PRIMARY KEY,
    boq_id uuid NOT NULL REFERENCES boqs(id) ON DELETE CASCADE,
    mode text NOT NULL CHECK (mode IN ('pinned', 'latest_issued')),
    run_id uuid REFERENCES runs(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    options jsonb NOT NULL,
    label text,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    revoked_at timestamptz,
    views integer NOT NULL DEFAULT 0,
    last_viewed_at timestamptz,
    CHECK ((mode = 'pinned') = (run_id IS NOT NULL))
);
CREATE INDEX share_links_boq ON share_links (boq_id, created_at DESC);
