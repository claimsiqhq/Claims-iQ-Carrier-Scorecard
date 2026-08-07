BEGIN;

CREATE OR REPLACE FUNCTION prevent_last_organization_owner_removal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.role = 'owner'
     AND (
       TG_OP = 'DELETE'
       OR NEW.role IS DISTINCT FROM 'owner'
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     ) THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(OLD.organization_id::text, 0)
    );

    IF NOT EXISTS (
      SELECT 1
      FROM organization_memberships
      WHERE organization_id = OLD.organization_id
        AND id <> OLD.id
        AND role = 'owner'
    ) THEN
      RAISE EXCEPTION 'The last organization owner cannot be removed'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER trg_organization_memberships_owner_guard
BEFORE UPDATE OR DELETE ON organization_memberships
FOR EACH ROW
EXECUTE FUNCTION prevent_last_organization_owner_removal();

COMMIT;
