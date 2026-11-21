CREATE TABLE native_credentials (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    password_hash text NOT NULL
);

CREATE TABLE native_setup_links (
    email text PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('setup', 'reset'))
);

CREATE TABLE native_auth_limits (
    bucket text NOT NULL,
    window_start timestamptz NOT NULL,
    attempts integer NOT NULL,
    PRIMARY KEY (bucket, window_start)
);

CREATE UNIQUE INDEX sessions_native_secret ON sessions (provider_session)
    WHERE provider_session LIKE 'native:%';
