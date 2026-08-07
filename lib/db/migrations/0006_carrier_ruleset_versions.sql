BEGIN;

CREATE TYPE carrier_ruleset_version_state AS ENUM (
  'draft',
  'published',
  'archived'
);

CREATE TABLE carrier_ruleset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_key text NOT NULL
    REFERENCES carrier_rulesets(carrier_key)
    ON DELETE CASCADE,
  version_number integer NOT NULL,
  version_label text NOT NULL,
  status carrier_ruleset_version_state NOT NULL DEFAULT 'draft',
  display_name text NOT NULL,
  logo_url text,
  ruleset jsonb NOT NULL,
  validation jsonb NOT NULL DEFAULT '{"errors":[],"warnings":[]}'::jsonb,
  change_summary text,
  source_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id varchar
    REFERENCES users(id)
    ON DELETE SET NULL,
  approved_by_user_id varchar
    REFERENCES users(id)
    ON DELETE SET NULL,
  supersedes_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT uq_carrier_ruleset_versions_number
    UNIQUE (carrier_key, version_number),
  CONSTRAINT fk_carrier_ruleset_versions_supersedes
    FOREIGN KEY (supersedes_version_id)
    REFERENCES carrier_ruleset_versions(id)
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX uq_carrier_ruleset_versions_published
  ON carrier_ruleset_versions (carrier_key)
  WHERE status = 'published';

CREATE INDEX idx_carrier_ruleset_versions_key_created
  ON carrier_ruleset_versions (carrier_key, created_at DESC);

INSERT INTO carrier_ruleset_versions (
  carrier_key,
  version_number,
  version_label,
  status,
  display_name,
  logo_url,
  ruleset,
  published_at,
  created_at
)
SELECT
  carrier_key,
  1,
  coalesce(nullif(ruleset->>'version', ''), '1.0'),
  CASE
    WHEN active THEN 'published'::carrier_ruleset_version_state
    ELSE 'draft'::carrier_ruleset_version_state
  END,
  display_name,
  logo_url,
  ruleset,
  CASE WHEN active THEN coalesce(updated_at, created_at, now()) ELSE NULL END,
  coalesce(created_at, now())
FROM carrier_rulesets;

CREATE OR REPLACE FUNCTION protect_carrier_ruleset_version_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Published carrier ruleset history is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('published', 'archived') THEN
    IF OLD.status = 'archived'
       OR NEW.status NOT IN ('published', 'archived')
       OR NEW.carrier_key IS DISTINCT FROM OLD.carrier_key
       OR NEW.version_number IS DISTINCT FROM OLD.version_number
       OR NEW.version_label IS DISTINCT FROM OLD.version_label
       OR NEW.display_name IS DISTINCT FROM OLD.display_name
       OR NEW.logo_url IS DISTINCT FROM OLD.logo_url
       OR NEW.ruleset IS DISTINCT FROM OLD.ruleset
       OR NEW.validation IS DISTINCT FROM OLD.validation
       OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
       OR NEW.source_references IS DISTINCT FROM OLD.source_references
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.supersedes_version_id IS DISTINCT FROM OLD.supersedes_version_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
    THEN
      RAISE EXCEPTION 'Published carrier ruleset history is immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER trg_carrier_ruleset_versions_history_guard
BEFORE UPDATE OR DELETE ON carrier_ruleset_versions
FOR EACH ROW
EXECUTE FUNCTION protect_carrier_ruleset_version_history();

ALTER TABLE carrier_ruleset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_ruleset_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE carrier_ruleset_versions FROM anon, authenticated;

COMMIT;
