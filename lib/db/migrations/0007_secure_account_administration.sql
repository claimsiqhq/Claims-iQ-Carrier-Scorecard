BEGIN;

ALTER TABLE users
  ADD COLUMN password_changed_at timestamptz,
  ADD COLUMN email_verified_at timestamptz;

CREATE UNIQUE INDEX uq_users_email_normalized
  ON users (lower(email))
  WHERE email IS NOT NULL;

ALTER TABLE sessions
  ADD COLUMN user_id varchar
    REFERENCES users(id)
    ON DELETE CASCADE;

UPDATE sessions
SET user_id = sess #>> '{user,id}'
WHERE user_id IS NULL
  AND nullif(sess #>> '{user,id}', '') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM users
    WHERE users.id = sessions.sess #>> '{user,id}'
  );

CREATE INDEX idx_sessions_user_id
  ON sessions (user_id);

CREATE TABLE organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES organizations(id)
    ON DELETE CASCADE,
  email text NOT NULL,
  role organization_role NOT NULL DEFAULT 'viewer',
  token_hash varchar(64) NOT NULL,
  invited_by_user_id varchar
    REFERENCES users(id)
    ON DELETE SET NULL,
  accepted_by_user_id varchar
    REFERENCES users(id)
    ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz,
  send_count integer NOT NULL DEFAULT 1,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_organization_invitations_token_hash UNIQUE (token_hash),
  CONSTRAINT ck_organization_invitations_normalized_email
    CHECK (email = lower(btrim(email)) AND email <> ''),
  CONSTRAINT ck_organization_invitations_send_count
    CHECK (send_count > 0),
  CONSTRAINT ck_organization_invitations_expiry
    CHECK (expires_at > created_at),
  CONSTRAINT ck_organization_invitations_terminal_state
    CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE UNIQUE INDEX uq_organization_invitations_pending_email
  ON organization_invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_organization_invitations_org_created
  ON organization_invitations (organization_id, created_at DESC);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL,
  requested_by_user_id varchar
    REFERENCES users(id)
    ON DELETE SET NULL,
  requested_for_organization_id uuid
    REFERENCES organizations(id)
    ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_password_reset_tokens_token_hash UNIQUE (token_hash),
  CONSTRAINT ck_password_reset_tokens_expiry
    CHECK (expires_at > created_at),
  CONSTRAINT ck_password_reset_tokens_terminal_state
    CHECK (used_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX idx_password_reset_tokens_user_created
  ON password_reset_tokens (user_id, created_at DESC);

CREATE UNIQUE INDEX uq_password_reset_tokens_active_user
  ON password_reset_tokens (user_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE organization_invitations FROM anon, authenticated;
REVOKE ALL ON TABLE password_reset_tokens FROM anon, authenticated;

COMMIT;
