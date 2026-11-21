CREATE TABLE users (
    id uuid PRIMARY KEY,
    auth_subject text NOT NULL UNIQUE,
    email text NOT NULL,
    name text NOT NULL,
    locale text NOT NULL DEFAULT 'en',
    platform_role text CHECK (platform_role = 'admin'),
    notification_preferences jsonb NOT NULL DEFAULT '{}',
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email ON users (lower(email));

CREATE TABLE orgs (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    settings jsonb NOT NULL DEFAULT '{}',
    setup jsonb,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleting')),
    tags text[] NOT NULL DEFAULT '{}',
    deleting_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
    org_id uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id),
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'library_editor', 'member')),
    last_active_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user ON memberships (user_id);

CREATE TABLE org_invitations (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    email text NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'library_editor', 'member')),
    token_hash text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
    expires_at timestamptz NOT NULL,
    invited_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX org_invitations_org ON org_invitations (org_id);
CREATE INDEX org_invitations_pending_email ON org_invitations (lower(email)) WHERE status = 'pending';

CREATE TABLE sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id),
    provider_session text NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'ended', 'replaced', 'expired')),
    device_label text NOT NULL,
    place text,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    replaced_by_session_id uuid REFERENCES sessions (id),
    ended_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sessions_one_active_per_user ON sessions (user_id) WHERE status = 'active';
CREATE INDEX sessions_user_created_at ON sessions (user_id, created_at DESC);
