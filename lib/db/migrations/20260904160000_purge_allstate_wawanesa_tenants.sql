-- Purge the retired Allstate and Wawanesa carrier tenants.
--
-- Both tenants were inventoried and exported before this file was authored;
-- Supabase's own backups remain the only rollback once it commits. The
-- migration runner deletes every Storage object under organizations/<id>/ in
-- the claim-documents bucket before this SQL runs (see
-- artifacts/api-server/src/migrations/tenantStoragePurge.ts); this transaction
-- removes the database rows.
--
-- Every tenant relation references organizations with ON DELETE RESTRICT, so
-- dependents are deleted explicitly, leaves first. The target set is an
-- explicit allowlist of two deterministic cutover UUIDs, each of which must
-- still carry its approved slug and name; Andover
-- (a11a0000-0000-4000-8000-000000000002) is never touched.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';

CREATE TEMP TABLE tenant_purge_organizations (
  organization_id uuid PRIMARY KEY,
  organization_name text NOT NULL,
  organization_slug text NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO tenant_purge_organizations (
  organization_id,
  organization_name,
  organization_slug
)
VALUES
  (
    'a11a0000-0000-4000-8000-000000000001',
    'Allstate',
    'allstate'
  ),
  (
    'a11a0000-0000-4000-8000-000000000003',
    'Wawanesa',
    'wawanesa'
  );

DO $identity_preflight$
DECLARE
  andover_organization_id constant uuid :=
    'a11a0000-0000-4000-8000-000000000002';
BEGIN
  -- A target UUID that still exists must be the approved tenant. Any drift
  -- (renamed, re-slugged, or promoted to default) aborts before a row moves.
  IF EXISTS (
    SELECT 1
    FROM public.organizations AS existing
    JOIN tenant_purge_organizations AS expected
      ON expected.organization_id = existing.id
    WHERE existing.slug IS DISTINCT FROM expected.organization_slug
       OR existing.name IS DISTINCT FROM expected.organization_name
       OR existing.is_default IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION
      'A purge target organization UUID does not match the approved Allstate/Wawanesa identity'
      USING ERRCODE = '23514';
  END IF;

  -- The approved slug under a different UUID means the tenant was recreated;
  -- this file only knows the deterministic cutover UUIDs.
  IF EXISTS (
    SELECT 1
    FROM public.organizations AS existing
    JOIN tenant_purge_organizations AS expected
      ON expected.organization_slug = existing.slug
    WHERE existing.id <> expected.organization_id
  ) THEN
    RAISE EXCEPTION
      'A purge target slug is owned by an organization UUID outside the approved allowlist'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = andover_organization_id
      AND slug = 'andover'
  ) THEN
    RAISE EXCEPTION
      'The Andover organization is missing or does not match its approved identity'
      USING ERRCODE = '23514';
  END IF;

  -- In-flight work would race the purge: workers hold leases and write audit
  -- rows for these tenants. Cancel or drain it first.
  IF EXISTS (
    SELECT 1
    FROM public.processing_jobs AS job
    JOIN tenant_purge_organizations AS expected
      ON expected.organization_id = job.organization_id
    WHERE job.status IN (
      'queued'::public.processing_job_state,
      'running'::public.processing_job_state
    )
  ) THEN
    RAISE EXCEPTION
      'A purge target organization still has queued or running processing jobs'
      USING ERRCODE = '55006';
  END IF;

  -- Absent organizations were already purged (rehearsal reruns, environments
  -- that never held these tenants). The final assertions still verify that no
  -- dependent row survives.
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations AS existing
    JOIN tenant_purge_organizations AS expected
      ON expected.organization_id = existing.id
  ) THEN
    RAISE NOTICE
      'Allstate and Wawanesa organizations are already absent; verifying that no dependent rows remain';
  END IF;
END
$identity_preflight$;

-- These guards must be suspended while immutable history rows and the last
-- owner memberships are removed. The lease audit trigger inserts a new
-- platform_audit_events row on DELETE, which would re-reference the
-- organization being purged, and the platform audit log is otherwise
-- append-only. ALTER TRIGGER is transactional: any failure rolls the disable
-- operations back before the migration lock is released.
ALTER TABLE public.audit_runs
  DISABLE TRIGGER audit_runs_immutable;
ALTER TABLE public.audits
  DISABLE TRIGGER audits_immutable;
ALTER TABLE public.audit_versions
  DISABLE TRIGGER audit_versions_immutable;
ALTER TABLE public.carrier_ruleset_versions
  DISABLE TRIGGER trg_carrier_ruleset_versions_history_guard;
ALTER TABLE public.organization_memberships
  DISABLE TRIGGER trg_organization_memberships_owner_guard;
ALTER TABLE public.platform_tenant_access_leases
  DISABLE TRIGGER trg_audit_platform_tenant_access_lease;
ALTER TABLE public.platform_audit_events
  DISABLE TRIGGER trg_platform_audit_events_immutable;

-- Claim descendants, leaves first. evidence_anchors reference findings and
-- documents; findings reference documents (RESTRICT); inbound-email deliveries
-- reference claims, documents, jobs, and routes (RESTRICT).
DELETE FROM public.evidence_anchors
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.audit_findings
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.audit_sections
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.audit_structured
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.claim_activity
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.processing_job_attempts
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.inbound_email_deliveries
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.inbound_email_routes
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

-- claims.current_audit_id restricts audit deletion while the claim row still
-- exists; release it before the audit history goes.
UPDATE public.claims
SET current_audit_id = NULL
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
)
  AND current_audit_id IS NOT NULL;

DELETE FROM public.audit_versions
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.audits
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.audit_runs
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.processing_jobs
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.documents
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.claims
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

-- Carrier profile bundle. The deferred profile-bundle constraint triggers
-- accept a tenant with zero profiles and zero entities, so removing the
-- profile, its versions, and the entities in one transaction satisfies them.
DELETE FROM public.carrier_ruleset_versions
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.carrier_rulesets
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.carrier_entities
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

-- Tenant configuration, access, and history.
DELETE FROM public.prompt_settings
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.saved_views
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.organization_invitations
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.organization_audit_events
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.organization_settings
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.organization_memberships
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

-- Platform-plane access history for the purged tenants.
DELETE FROM public.platform_tenant_access_leases
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.platform_audit_events
WHERE organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

-- SET NULL references are released explicitly so the organization delete
-- below cannot depend on cascade side effects.
UPDATE public.users
SET last_active_organization_id = NULL
WHERE last_active_organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

UPDATE public.password_reset_tokens
SET requested_for_organization_id = NULL
WHERE requested_for_organization_id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

DELETE FROM public.organizations
WHERE id IN (
  SELECT organization_id FROM tenant_purge_organizations
);

-- Drain deferred FK and profile-bundle trigger events here so any violation
-- surfaces inside this file rather than at the migration runner's COMMIT.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.audit_runs
  ENABLE TRIGGER audit_runs_immutable;
ALTER TABLE public.audits
  ENABLE TRIGGER audits_immutable;
ALTER TABLE public.audit_versions
  ENABLE TRIGGER audit_versions_immutable;
ALTER TABLE public.carrier_ruleset_versions
  ENABLE TRIGGER trg_carrier_ruleset_versions_history_guard;
ALTER TABLE public.organization_memberships
  ENABLE TRIGGER trg_organization_memberships_owner_guard;
ALTER TABLE public.platform_tenant_access_leases
  ENABLE TRIGGER trg_audit_platform_tenant_access_lease;
ALTER TABLE public.platform_audit_events
  ENABLE TRIGGER trg_platform_audit_events_immutable;

DO $final_purge_assertions$
DECLARE
  andover_organization_id constant uuid :=
    'a11a0000-0000-4000-8000-000000000002';
  item record;
  remaining bigint;
BEGIN
  -- Every public base table with an organization_id column, discovered from
  -- the catalog so a relation added after this file was written cannot be
  -- skipped silently.
  FOR item IN
    SELECT
      column_record.table_schema,
      column_record.table_name
    FROM information_schema.columns AS column_record
    JOIN information_schema.tables AS table_record
      ON table_record.table_schema = column_record.table_schema
     AND table_record.table_name = column_record.table_name
    WHERE column_record.table_schema = 'public'
      AND column_record.column_name = 'organization_id'
      AND table_record.table_type = 'BASE TABLE'
    ORDER BY column_record.table_name
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT count(*) FROM %I.%I AS relation '
      || 'WHERE relation.organization_id::text IN ('
      || 'SELECT organization_id::text FROM tenant_purge_organizations)',
      item.table_schema,
      item.table_name
    )
    INTO remaining;

    IF remaining > 0 THEN
      RAISE EXCEPTION
        '% row(s) in %.% still reference a purged organization',
        remaining,
        item.table_schema,
        item.table_name
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE last_active_organization_id IN (
      SELECT organization_id FROM tenant_purge_organizations
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.password_reset_tokens
    WHERE requested_for_organization_id IN (
      SELECT organization_id FROM tenant_purge_organizations
    )
  ) THEN
    RAISE EXCEPTION
      'A user or password reset token still points at a purged organization'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id IN (
      SELECT organization_id FROM tenant_purge_organizations
    )
       OR slug IN (
      SELECT organization_slug FROM tenant_purge_organizations
    )
  ) THEN
    RAISE EXCEPTION
      'A purged organization still exists'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = andover_organization_id
      AND slug = 'andover'
  )
     OR (
       SELECT count(*)
       FROM public.carrier_rulesets
       WHERE organization_id = andover_organization_id
     ) <> 1
     OR (
       SELECT count(*)
       FROM public.carrier_entities
       WHERE organization_id = andover_organization_id
         AND is_primary
     ) <> 1 THEN
    RAISE EXCEPTION
      'The Andover tenant is not intact after the purge'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_record
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = trigger_record.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND trigger_record.tgname IN (
        'audit_runs_immutable',
        'audits_immutable',
        'audit_versions_immutable',
        'trg_carrier_ruleset_versions_history_guard',
        'trg_organization_memberships_owner_guard',
        'trg_audit_platform_tenant_access_lease',
        'trg_platform_audit_events_immutable'
      )
      AND trigger_record.tgenabled <> 'O'
  ) THEN
    RAISE EXCEPTION
      'A suspended guard trigger was not re-enabled after the purge'
      USING ERRCODE = '23514';
  END IF;
END
$final_purge_assertions$;

COMMIT;
