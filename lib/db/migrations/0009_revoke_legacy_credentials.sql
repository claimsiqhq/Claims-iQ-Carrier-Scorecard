BEGIN;

ALTER TABLE sessions
  ALTER COLUMN auth_version SET DEFAULT 0;

DELETE FROM sessions;

ALTER TABLE sessions
  ALTER COLUMN auth_version SET NOT NULL;

ALTER TABLE password_reset_tokens
  ADD COLUMN auth_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT ck_password_reset_tokens_auth_version
  CHECK (auth_version >= 0);

UPDATE password_reset_tokens
SET revoked_at = now()
WHERE used_at IS NULL
  AND revoked_at IS NULL;

COMMIT;
