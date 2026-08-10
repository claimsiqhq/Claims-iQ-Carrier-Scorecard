BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    WHERE email IS NOT NULL
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot normalize users.email because case/whitespace collisions exist'
      USING ERRCODE = '23505';
  END IF;
END
$$;

UPDATE users
SET email = lower(btrim(email))
WHERE email IS NOT NULL
  AND email IS DISTINCT FROM lower(btrim(email));

DROP INDEX IF EXISTS uq_users_email_normalized;

CREATE UNIQUE INDEX uq_users_email_normalized
  ON users (lower(btrim(email)))
  WHERE email IS NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT ck_users_email_normalized
  CHECK (
    email IS NULL
    OR (email = lower(btrim(email)) AND email <> '')
  ),
  ADD COLUMN auth_version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT ck_users_auth_version
  CHECK (auth_version > 0);

ALTER TABLE sessions
  ADD COLUMN auth_version integer;

UPDATE sessions
SET user_id = sess #>> '{user,id}'
WHERE user_id IS NULL
  AND nullif(sess #>> '{user,id}', '') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM users
    WHERE users.id = sessions.sess #>> '{user,id}'
  );

DELETE FROM sessions
WHERE user_id IS NULL;

UPDATE sessions
SET auth_version = users.auth_version
FROM users
WHERE users.id = sessions.user_id
  AND sessions.auth_version IS NULL;

COMMIT;
