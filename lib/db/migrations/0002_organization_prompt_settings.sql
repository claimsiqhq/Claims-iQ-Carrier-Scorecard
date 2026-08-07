BEGIN;

ALTER TABLE prompt_settings
  ADD COLUMN organization_id uuid;

UPDATE prompt_settings
SET organization_id = (
  SELECT id
  FROM organizations
  WHERE is_default = true
  ORDER BY created_at
  LIMIT 1
)
WHERE organization_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM prompt_settings
    WHERE organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Prompt settings could not be assigned to the default organization';
  END IF;
END $$;

ALTER TABLE prompt_settings
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT fk_prompt_settings_organization
    FOREIGN KEY (organization_id)
    REFERENCES organizations(id)
    ON DELETE CASCADE;

ALTER TABLE prompt_settings
  DROP CONSTRAINT IF EXISTS prompt_settings_key_unique;

ALTER TABLE prompt_settings
  ADD CONSTRAINT uq_prompt_settings_org_key
    UNIQUE (organization_id, key);

CREATE INDEX idx_prompt_settings_organization
  ON prompt_settings (organization_id, updated_at DESC);

ALTER TABLE prompt_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_settings FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE prompt_settings FROM anon, authenticated;

COMMIT;
