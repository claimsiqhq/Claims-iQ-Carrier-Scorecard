BEGIN;

CREATE TABLE organization_settings (
  organization_id uuid PRIMARY KEY
    REFERENCES organizations(id)
    ON DELETE CASCADE,
  in_app_notifications_enabled boolean NOT NULL DEFAULT true,
  email_notifications_enabled boolean NOT NULL DEFAULT false,
  retention_days integer,
  purge_mode text NOT NULL DEFAULT 'manual',
  updated_by_user_id varchar
    REFERENCES users(id)
    ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_organization_settings_retention
    CHECK (retention_days IS NULL OR retention_days BETWEEN 30 AND 3650),
  CONSTRAINT chk_organization_settings_purge_mode
    CHECK (purge_mode IN ('manual', 'scheduled'))
);

INSERT INTO organization_settings (organization_id)
SELECT id
FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

ALTER TABLE organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_settings FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE organization_settings FROM anon, authenticated;

COMMIT;
