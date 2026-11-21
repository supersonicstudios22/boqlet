CREATE TABLE provider_session_revocations (
    provider_session text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0
);

CREATE FUNCTION queue_provider_session_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO provider_session_revocations (provider_session) VALUES (NEW.provider_session) ON CONFLICT DO NOTHING;
    RETURN NEW;
END
$$;
CREATE TRIGGER sessions_revoke_provider AFTER UPDATE ON sessions FOR EACH ROW
    WHEN (OLD.status = 'active' AND NEW.status <> 'active') EXECUTE FUNCTION queue_provider_session_revocation();

CREATE INDEX sessions_by_provider_id ON sessions (user_id, provider_session);
