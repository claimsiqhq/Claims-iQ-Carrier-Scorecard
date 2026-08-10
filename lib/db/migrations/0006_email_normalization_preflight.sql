BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    WHERE email IS NULL
      OR btrim(email) = ''
  ) THEN
    RAISE EXCEPTION 'Cannot normalize users.email because blank values exist'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM users
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot normalize users.email because case/whitespace collisions exist'
      USING ERRCODE = '23505';
  END IF;
END
$$;

COMMIT;
