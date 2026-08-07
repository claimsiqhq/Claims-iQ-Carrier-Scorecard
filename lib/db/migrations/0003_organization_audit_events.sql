BEGIN;

CREATE TABLE organization_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES organizations(id)
    ON DELETE CASCADE,
  actor_user_id varchar
    REFERENCES users(id)
    ON DELETE SET NULL,
  event_type text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_organization_audit_events_org_created
  ON organization_audit_events (organization_id, created_at DESC);

ALTER TABLE organization_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_audit_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE organization_audit_events FROM anon, authenticated;

COMMIT;
