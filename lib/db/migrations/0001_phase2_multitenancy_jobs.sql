-- Phase 2: tenant isolation, durable processing, and append-only audit provenance.
-- This migration is intentionally forward-only. It adds nullable tenant keys first,
-- performs a deterministic backfill, and only then tightens nullability.

DO $$ BEGIN
  CREATE TYPE organization_role AS ENUM ('owner', 'admin', 'auditor', 'reviewer', 'member', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE system_workflow_state AS ENUM ('uploaded', 'processing', 'ready', 'error', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE ai_workflow_state AS ENUM ('not_started', 'queued', 'running', 'succeeded', 'degraded', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE human_review_state AS ENUM ('unassigned', 'pending', 'in_review', 'approved', 'changes_requested');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE finding_disposition AS ENUM ('open', 'accepted', 'dismissed', 'remediated', 'overridden');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE audit_run_state AS ENUM ('succeeded', 'degraded', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE processing_job_type AS ENUM ('ingest', 'audit', 'retry', 'reprocess', 'extract');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE processing_job_state AS ENUM ('queued', 'running', 'succeeded', 'degraded', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE processing_job_stage AS ENUM ('uploaded', 'scanning', 'extracting', 'auditing', 'degraded', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE processing_attempt_state AS ENUM ('running', 'succeeded', 'degraded', 'failed', 'cancelled', 'lease_expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_organizations_slug UNIQUE (slug)
);

CREATE INDEX idx_organizations_default ON organizations (is_default);

CREATE TABLE organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role organization_role NOT NULL DEFAULT 'member',
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_organization_memberships_org_user UNIQUE (organization_id, user_id),
  CONSTRAINT ck_organization_memberships_permissions_array
    CHECK (jsonb_typeof(permissions) = 'array')
);

CREATE UNIQUE INDEX uq_organization_memberships_user_default
  ON organization_memberships (user_id)
  WHERE is_default = true;
CREATE INDEX idx_organization_memberships_user
  ON organization_memberships (user_id);
CREATE INDEX idx_organization_memberships_org_role
  ON organization_memberships (organization_id, role);

-- The fixed identifier makes the backfill repeatable across environments.
INSERT INTO organizations (id, name, slug, is_default)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Default Organization',
  'default-organization',
  true
);

INSERT INTO organization_memberships (
  organization_id,
  user_id,
  role,
  is_default
)
SELECT
  '00000000-0000-4000-8000-000000000001',
  u.id,
  CASE
    WHEN lower(coalesce(u.role, '')) = 'admin' THEN 'owner'::organization_role
    ELSE 'member'::organization_role
  END,
  true
FROM users u;

ALTER TABLE claims
  ADD COLUMN organization_id uuid,
  ADD COLUMN owner_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN assignee_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN system_status system_workflow_state NOT NULL DEFAULT 'uploaded',
  ADD COLUMN ai_status ai_workflow_state NOT NULL DEFAULT 'not_started',
  ADD COLUMN human_review_status human_review_state NOT NULL DEFAULT 'unassigned',
  ADD COLUMN current_audit_id uuid,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE claims
SET
  organization_id = '00000000-0000-4000-8000-000000000001',
  system_status = CASE
    WHEN status = 'analyzed' THEN 'ready'::system_workflow_state
    WHEN status = 'processing' THEN 'processing'::system_workflow_state
    WHEN status = 'error' THEN 'error'::system_workflow_state
    ELSE 'uploaded'::system_workflow_state
  END,
  ai_status = CASE
    WHEN status = 'analyzed' THEN 'succeeded'::ai_workflow_state
    WHEN status = 'processing' THEN 'running'::ai_workflow_state
    WHEN status = 'error' THEN 'failed'::ai_workflow_state
    ELSE 'not_started'::ai_workflow_state
  END;

ALTER TABLE claims
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT claims_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

ALTER TABLE documents
  ADD COLUMN organization_id uuid,
  ADD COLUMN uploaded_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN source_sha256 text,
  ADD COLUMN page_count integer,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE documents d
SET organization_id = coalesce(
  (SELECT c.organization_id FROM claims c WHERE c.id = d.claim_id),
  '00000000-0000-4000-8000-000000000001'
);

ALTER TABLE documents
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT documents_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_documents_page_count
    CHECK (page_count IS NULL OR page_count > 0);

CREATE TABLE processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  claim_id uuid REFERENCES claims(id) ON DELETE CASCADE,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  requested_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  type processing_job_type NOT NULL,
  status processing_job_state NOT NULL DEFAULT 'queued',
  stage processing_job_stage NOT NULL DEFAULT 'uploaded',
  progress integer NOT NULL DEFAULT 0,
  priority integer NOT NULL DEFAULT 100,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  error_code text,
  error_message text,
  error_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_processing_jobs_org_idempotency
    UNIQUE (organization_id, idempotency_key),
  CONSTRAINT ck_processing_jobs_progress CHECK (progress BETWEEN 0 AND 100),
  CONSTRAINT ck_processing_jobs_attempts
    CHECK (attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts),
  CONSTRAINT ck_processing_jobs_payload_object
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX idx_processing_jobs_claim
  ON processing_jobs (organization_id, claim_id, created_at DESC);
CREATE INDEX idx_processing_jobs_ready
  ON processing_jobs (status, available_at, priority, created_at)
  WHERE status = 'queued';
CREATE INDEX idx_processing_jobs_expired_lease
  ON processing_jobs (lease_expires_at)
  WHERE status = 'running';

CREATE TABLE processing_job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  worker_id text NOT NULL,
  status processing_attempt_state NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text,
  error_message text,
  error_metadata jsonb,
  CONSTRAINT uq_processing_job_attempt_number UNIQUE (job_id, attempt_number),
  CONSTRAINT ck_processing_job_attempt_number CHECK (attempt_number > 0)
);

CREATE INDEX idx_processing_job_attempts_org_job
  ON processing_job_attempts (organization_id, job_id);

CREATE TABLE audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  claim_id uuid REFERENCES claims(id) ON DELETE CASCADE,
  processing_job_id uuid REFERENCES processing_jobs(id) ON DELETE SET NULL,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  status audit_run_state NOT NULL,
  ruleset_version text NOT NULL,
  ruleset_hash text,
  ruleset_snapshot jsonb,
  prompt_identifier text NOT NULL,
  prompt_hash text,
  prompt_snapshot jsonb,
  model_identifier text NOT NULL,
  source_document_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_request_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  fallback_used boolean NOT NULL DEFAULT false,
  degraded boolean NOT NULL DEFAULT false,
  error_code text,
  error_message text,
  error_metadata jsonb,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_audit_runs_source_hashes_array
    CHECK (jsonb_typeof(source_document_hashes) = 'array'),
  CONSTRAINT ck_audit_runs_provider_ids_array
    CHECK (jsonb_typeof(provider_request_ids) = 'array'),
  CONSTRAINT ck_audit_runs_ruleset_snapshot_object
    CHECK (ruleset_snapshot IS NULL OR jsonb_typeof(ruleset_snapshot) = 'object'),
  CONSTRAINT ck_audit_runs_prompt_snapshot_object
    CHECK (prompt_snapshot IS NULL OR jsonb_typeof(prompt_snapshot) = 'object'),
  CONSTRAINT ck_audit_runs_terminal_consistency CHECK (
    (status = 'succeeded' AND degraded = false AND fallback_used = false AND error_code IS NULL)
    OR status <> 'succeeded'
  )
);

CREATE INDEX idx_audit_runs_org_claim_created
  ON audit_runs (organization_id, claim_id, created_at DESC);
CREATE INDEX idx_audit_runs_job ON audit_runs (processing_job_id);
CREATE INDEX idx_audit_runs_org_status ON audit_runs (organization_id, status);

ALTER TABLE audits DROP CONSTRAINT IF EXISTS uq_audits_claim_id;

ALTER TABLE audits
  ADD COLUMN organization_id uuid,
  ADD COLUMN audit_run_id uuid,
  ADD COLUMN version_number integer,
  ADD COLUMN supersedes_audit_id uuid,
  ADD COLUMN ruleset_version text NOT NULL DEFAULT 'unknown',
  ADD COLUMN ruleset_hash text,
  ADD COLUMN prompt_identifier text NOT NULL DEFAULT 'carrier-audit',
  ADD COLUMN prompt_hash text,
  ADD COLUMN model_identifier text NOT NULL DEFAULT 'unknown',
  ADD COLUMN source_document_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN processing_job_id uuid,
  ADD COLUMN fallback_used boolean NOT NULL DEFAULT false,
  ADD COLUMN degraded boolean NOT NULL DEFAULT false,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN completed_at timestamptz;

UPDATE audits a
SET organization_id = coalesce(
  (SELECT c.organization_id FROM claims c WHERE c.id = a.claim_id),
  '00000000-0000-4000-8000-000000000001'
);

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY claim_id
      ORDER BY created_at NULLS FIRST, id
    )::integer AS version_number
  FROM audits
)
UPDATE audits a
SET version_number = ranked.version_number
FROM ranked
WHERE ranked.id = a.id;

INSERT INTO audit_runs (
  id,
  organization_id,
  claim_id,
  status,
  ruleset_version,
  prompt_identifier,
  model_identifier,
  source_document_hashes,
  provider_request_ids,
  fallback_used,
  degraded,
  started_at,
  completed_at,
  created_at
)
SELECT
  a.id,
  a.organization_id,
  a.claim_id,
  'succeeded'::audit_run_state,
  'legacy',
  'legacy-carrier-audit',
  'legacy-unknown',
  '[]'::jsonb,
  '[]'::jsonb,
  false,
  false,
  coalesce(a.created_at, now()),
  coalesce(a.created_at, now()),
  coalesce(a.created_at, now())
FROM audits a
;

UPDATE audits
SET
  audit_run_id = id,
  ruleset_version = 'legacy',
  prompt_identifier = 'legacy-carrier-audit',
  model_identifier = 'legacy-unknown',
  started_at = coalesce(created_at, now()),
  completed_at = coalesce(created_at, now()),
  approval_status = replace(upper(trim(approval_status)), ' ', '_'),
  risk_level = upper(trim(risk_level));

ALTER TABLE audits
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN audit_run_id SET NOT NULL,
  ALTER COLUMN version_number SET NOT NULL,
  ADD CONSTRAINT audits_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT audits_audit_run_id_fkey
    FOREIGN KEY (audit_run_id) REFERENCES audit_runs(id) ON DELETE RESTRICT,
  ADD CONSTRAINT audits_supersedes_audit_id_fkey
    FOREIGN KEY (supersedes_audit_id) REFERENCES audits(id) ON DELETE RESTRICT,
  ADD CONSTRAINT audits_processing_job_id_fkey
    FOREIGN KEY (processing_job_id) REFERENCES processing_jobs(id) ON DELETE SET NULL,
  ADD CONSTRAINT uq_audits_run_id UNIQUE (audit_run_id),
  ADD CONSTRAINT uq_audits_org_claim_version
    UNIQUE (organization_id, claim_id, version_number),
  ADD CONSTRAINT ck_audits_success_only
    CHECK (degraded = false AND fallback_used = false),
  ADD CONSTRAINT ck_audits_source_hashes_array
    CHECK (jsonb_typeof(source_document_hashes) = 'array');

ALTER TABLE audit_sections ADD COLUMN organization_id uuid;
UPDATE audit_sections s
SET organization_id = a.organization_id
FROM audits a
WHERE a.id = s.audit_id;
UPDATE audit_sections
SET organization_id = '00000000-0000-4000-8000-000000000001'
WHERE organization_id IS NULL;
ALTER TABLE audit_sections
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT audit_sections_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

ALTER TABLE audit_findings
  ADD COLUMN organization_id uuid,
  ADD COLUMN disposition finding_disposition NOT NULL DEFAULT 'open',
  ADD COLUMN override_reason text,
  ADD COLUMN review_notes text,
  ADD COLUMN reviewed_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE audit_findings f
SET organization_id = a.organization_id
FROM audits a
WHERE a.id = f.audit_id;
UPDATE audit_findings
SET organization_id = '00000000-0000-4000-8000-000000000001'
WHERE organization_id IS NULL;
ALTER TABLE audit_findings
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT audit_findings_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_audit_findings_override_reason CHECK (
    disposition <> 'overridden' OR nullif(btrim(override_reason), '') IS NOT NULL
  );

ALTER TABLE audit_structured ADD COLUMN organization_id uuid;
UPDATE audit_structured s
SET organization_id = a.organization_id
FROM audits a
WHERE a.id = s.audit_id;
UPDATE audit_structured
SET organization_id = '00000000-0000-4000-8000-000000000001'
WHERE organization_id IS NULL;
ALTER TABLE audit_structured
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT audit_structured_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

ALTER TABLE audit_versions
  ADD COLUMN organization_id uuid,
  ADD COLUMN audit_run_id uuid,
  ADD COLUMN supersedes_audit_id uuid;

UPDATE audit_versions v
SET
  organization_id = a.organization_id,
  audit_run_id = a.audit_run_id,
  version_number = coalesce(v.version_number, a.version_number),
  supersedes_audit_id = a.supersedes_audit_id
FROM audits a
WHERE a.id = v.audit_id;

INSERT INTO audit_versions (
  organization_id,
  claim_id,
  audit_id,
  audit_run_id,
  version_number,
  supersedes_audit_id,
  created_at
)
SELECT
  a.organization_id,
  a.claim_id,
  a.id,
  a.audit_run_id,
  a.version_number,
  a.supersedes_audit_id,
  a.created_at
FROM audits a
WHERE NOT EXISTS (
  SELECT 1 FROM audit_versions v WHERE v.audit_id = a.id
);

ALTER TABLE audit_versions
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN audit_run_id SET NOT NULL,
  ALTER COLUMN version_number SET NOT NULL,
  ADD CONSTRAINT audit_versions_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT audit_versions_audit_run_id_fkey
    FOREIGN KEY (audit_run_id) REFERENCES audit_runs(id) ON DELETE RESTRICT,
  ADD CONSTRAINT audit_versions_supersedes_audit_id_fkey
    FOREIGN KEY (supersedes_audit_id) REFERENCES audits(id) ON DELETE RESTRICT,
  ADD CONSTRAINT uq_audit_versions_org_claim_version
    UNIQUE (organization_id, claim_id, version_number),
  ADD CONSTRAINT uq_audit_versions_audit UNIQUE (audit_id);

UPDATE claims c
SET current_audit_id = (
  SELECT a.id
  FROM audits a
  WHERE a.claim_id = c.id
    AND a.organization_id = c.organization_id
  ORDER BY a.version_number DESC, a.created_at DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM audits a
  WHERE a.claim_id = c.id
    AND a.organization_id = c.organization_id
);

ALTER TABLE claims
  ADD CONSTRAINT claims_current_audit_id_fkey
    FOREIGN KEY (current_audit_id) REFERENCES audits(id) ON DELETE RESTRICT;

CREATE TABLE evidence_anchors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  finding_id uuid NOT NULL REFERENCES audit_findings(id) ON DELETE CASCADE,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  is_mapped boolean NOT NULL DEFAULT false,
  page_number integer,
  raw_location text,
  quote text,
  anchor_data jsonb,
  mapping_method text NOT NULL DEFAULT 'unmapped',
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_evidence_anchors_page CHECK (page_number IS NULL OR page_number > 0),
  CONSTRAINT ck_evidence_anchors_confidence
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT ck_evidence_anchors_mapping CHECK (
    (is_mapped = false)
    OR (source_document_id IS NOT NULL AND page_number IS NOT NULL)
  )
);

CREATE INDEX idx_evidence_anchors_org_finding
  ON evidence_anchors (organization_id, finding_id);
CREATE INDEX idx_evidence_anchors_document_page
  ON evidence_anchors (source_document_id, page_number);

CREATE TABLE claim_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  activity_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_claim_activity_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX idx_claim_activity_org_claim_created
  ON claim_activity (organization_id, claim_id, created_at DESC);
CREATE INDEX idx_claim_activity_actor
  ON claim_activity (organization_id, actor_user_id);

CREATE TABLE saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  resource_type text NOT NULL DEFAULT 'claims',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort jsonb NOT NULL DEFAULT '{}'::jsonb,
  columns jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_saved_views_user_name
    UNIQUE (organization_id, user_id, name),
  CONSTRAINT ck_saved_views_filters_object CHECK (jsonb_typeof(filters) = 'object'),
  CONSTRAINT ck_saved_views_sort_object CHECK (jsonb_typeof(sort) = 'object'),
  CONSTRAINT ck_saved_views_columns_array
    CHECK (columns IS NULL OR jsonb_typeof(columns) = 'array')
);

CREATE INDEX idx_saved_views_org_user
  ON saved_views (organization_id, user_id);

CREATE INDEX idx_claims_org_created
  ON claims (organization_id, created_at DESC);
CREATE INDEX idx_claims_org_workflow
  ON claims (organization_id, system_status, ai_status);
CREATE INDEX idx_claims_org_assignee_review
  ON claims (organization_id, assignee_user_id, human_review_status);
CREATE INDEX idx_documents_org_claim
  ON documents (organization_id, claim_id);
CREATE INDEX idx_documents_org_storage_path
  ON documents (organization_id, file_url);
CREATE INDEX idx_audits_org_claim_version
  ON audits (organization_id, claim_id, version_number DESC);
CREATE INDEX idx_audits_job ON audits (processing_job_id);
CREATE INDEX idx_sections_org_audit
  ON audit_sections (organization_id, audit_id);
CREATE INDEX idx_findings_org_audit
  ON audit_findings (organization_id, audit_id);
CREATE INDEX idx_findings_org_disposition
  ON audit_findings (organization_id, disposition);
CREATE INDEX idx_findings_source_document
  ON audit_findings (source_document_id)
  WHERE source_document_id IS NOT NULL;
CREATE INDEX idx_audit_structured_org_audit
  ON audit_structured (organization_id, audit_id);
CREATE INDEX idx_audit_structured_audit
  ON audit_structured (audit_id);
CREATE INDEX idx_audit_versions_org_claim
  ON audit_versions (organization_id, claim_id, version_number DESC);
CREATE INDEX idx_audit_versions_audit
  ON audit_versions (audit_id);
CREATE INDEX idx_audit_versions_claim
  ON audit_versions (claim_id);

CREATE OR REPLACE FUNCTION reject_immutable_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_runs_immutable
  BEFORE UPDATE OR DELETE ON audit_runs
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_audit_mutation();
CREATE TRIGGER audits_immutable
  BEFORE UPDATE OR DELETE ON audits
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_audit_mutation();
CREATE TRIGGER audit_versions_immutable
  BEFORE UPDATE OR DELETE ON audit_versions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_audit_mutation();

-- The application authenticates with custom database-backed sessions, not
-- Supabase Auth. No auth.uid()-based policies are created. Direct Data API
-- roles receive no table privileges; the trusted server connection must still
-- apply organization predicates to every query.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations',
    'organization_memberships',
    'users',
    'sessions',
    'claims',
    'documents',
    'processing_jobs',
    'processing_job_attempts',
    'audit_runs',
    'audits',
    'audit_sections',
    'audit_findings',
    'audit_structured',
    'audit_versions',
    'evidence_anchors',
    'claim_activity',
    'saved_views',
    'prompt_settings',
    'carrier_rulesets'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', table_name);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', table_name);
      END IF;
    END IF;
  END LOOP;
END
$$;
