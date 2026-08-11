-- Carrier tenant data and storage cutover.
--
-- The migration-only storage copier must complete first. This transaction
-- consumes only its private, hash-verified manifest; it never derives tenant
-- ownership from model output or from names outside the explicit allowlist.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';
SET CONSTRAINTS ALL DEFERRED;

CREATE TEMP TABLE carrier_tenant_cutover_organizations (
  organization_id uuid PRIMARY KEY,
  carrier_key text NOT NULL UNIQUE,
  organization_name text NOT NULL,
  organization_slug text NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO carrier_tenant_cutover_organizations (
  organization_id,
  carrier_key,
  organization_name,
  organization_slug
)
VALUES
  (
    'a11a0000-0000-4000-8000-000000000001',
    'allstate',
    'Allstate',
    'allstate'
  ),
  (
    'a11a0000-0000-4000-8000-000000000002',
    'andover',
    'Andover',
    'andover'
  ),
  (
    'a11a0000-0000-4000-8000-000000000003',
    'wawanesa',
    'Wawanesa',
    'wawanesa'
  );

CREATE TEMP TABLE carrier_tenant_cutover_entities (
  entity_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  entity_key text NOT NULL,
  display_name text NOT NULL,
  legal_name text NOT NULL,
  is_primary boolean NOT NULL,
  UNIQUE (organization_id, entity_key)
) ON COMMIT DROP;

INSERT INTO carrier_tenant_cutover_entities (
  entity_id,
  organization_id,
  entity_key,
  display_name,
  legal_name,
  is_primary
)
VALUES
  (
    'e11e0000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'allstate',
    'Allstate',
    'Allstate Insurance Company',
    true
  ),
  (
    'e11e0000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'andover',
    'Andover',
    'The Andover Companies',
    true
  ),
  (
    'e11e0000-0000-4000-8000-000000000003',
    'a11a0000-0000-4000-8000-000000000002',
    'bay-state-insurance-company',
    'Bay State Insurance Company',
    'Bay State Insurance Company',
    false
  ),
  (
    'e11e0000-0000-4000-8000-000000000004',
    'a11a0000-0000-4000-8000-000000000002',
    'cambridge-mutual',
    'Cambridge Mutual',
    'Cambridge Mutual Fire Insurance Company',
    false
  ),
  (
    'e11e0000-0000-4000-8000-000000000005',
    'a11a0000-0000-4000-8000-000000000002',
    'merrimack-mutual',
    'Merrimack Mutual',
    'Merrimack Mutual Fire Insurance Company',
    false
  ),
  (
    'e11e0000-0000-4000-8000-000000000006',
    'a11a0000-0000-4000-8000-000000000003',
    'wawanesa',
    'Wawanesa',
    'Wawanesa Insurance',
    true
  );

CREATE TEMP TABLE carrier_tenant_cutover_carriers (
  legacy_carrier text PRIMARY KEY,
  organization_id uuid NOT NULL,
  entity_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO carrier_tenant_cutover_carriers (
  legacy_carrier,
  organization_id,
  entity_id
)
VALUES
  (
    'Allstate',
    'a11a0000-0000-4000-8000-000000000001',
    'e11e0000-0000-4000-8000-000000000001'
  ),
  (
    'Andover',
    'a11a0000-0000-4000-8000-000000000002',
    'e11e0000-0000-4000-8000-000000000002'
  ),
  (
    'Bay State Insurance Company',
    'a11a0000-0000-4000-8000-000000000002',
    'e11e0000-0000-4000-8000-000000000003'
  ),
  (
    'Cambridge Mutual',
    'a11a0000-0000-4000-8000-000000000002',
    'e11e0000-0000-4000-8000-000000000004'
  ),
  (
    'Merrimack Mutual',
    'a11a0000-0000-4000-8000-000000000002',
    'e11e0000-0000-4000-8000-000000000005'
  );

DO $identity_preflight$
DECLARE
  legacy_organization_id constant uuid :=
    '00000000-0000-4000-8000-000000000001';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.organizations AS existing
    JOIN carrier_tenant_cutover_organizations AS expected
      ON expected.organization_id = existing.id
    WHERE existing.name IS DISTINCT FROM expected.organization_name
       OR existing.slug IS DISTINCT FROM expected.organization_slug
       OR existing.is_default IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION
      'A deterministic carrier organization UUID collides with different data'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organizations AS existing
    JOIN carrier_tenant_cutover_organizations AS expected
      ON expected.organization_slug = existing.slug
    WHERE existing.id <> expected.organization_id
  ) THEN
    RAISE EXCEPTION
      'A deterministic carrier organization slug is owned by another UUID'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organizations AS organization
    WHERE organization.id <> legacy_organization_id
      AND NOT EXISTS (
        SELECT 1
        FROM carrier_tenant_cutover_organizations AS expected
        WHERE expected.organization_id = organization.id
      )
  ) THEN
    RAISE EXCEPTION
      'Unexpected organization exists; carrier tenant cutover is ambiguous'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = legacy_organization_id
      AND (
        name <> 'Default Organization'
        OR slug <> 'default-organization'
      )
  ) THEN
    RAISE EXCEPTION
      'The legacy organization identity does not match the approved inventory'
      USING ERRCODE = '23514';
  END IF;
END
$identity_preflight$;

INSERT INTO public.organizations (
  id,
  name,
  slug,
  is_default
)
SELECT
  expected.organization_id,
  expected.organization_name,
  expected.organization_slug,
  false
FROM carrier_tenant_cutover_organizations AS expected
ON CONFLICT (id) DO NOTHING;

DO $entity_collision_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.carrier_entities AS existing
    JOIN carrier_tenant_cutover_entities AS expected
      ON expected.entity_id = existing.id
    WHERE existing.organization_id IS DISTINCT FROM expected.organization_id
       OR existing.entity_key IS DISTINCT FROM expected.entity_key
       OR existing.display_name IS DISTINCT FROM expected.display_name
       OR existing.legal_name IS DISTINCT FROM expected.legal_name
       OR existing.is_primary IS DISTINCT FROM expected.is_primary
  ) THEN
    RAISE EXCEPTION
      'A deterministic carrier entity UUID collides with different data'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.carrier_entities AS existing
    JOIN carrier_tenant_cutover_entities AS expected
      ON expected.organization_id = existing.organization_id
     AND expected.entity_key = existing.entity_key
    WHERE existing.id <> expected.entity_id
  ) THEN
    RAISE EXCEPTION
      'A deterministic carrier entity key is owned by another UUID'
      USING ERRCODE = '23505';
  END IF;
END
$entity_collision_preflight$;

INSERT INTO public.carrier_entities (
  id,
  organization_id,
  entity_key,
  display_name,
  legal_name,
  is_primary,
  active
)
SELECT
  expected.entity_id,
  expected.organization_id,
  expected.entity_key,
  expected.display_name,
  expected.legal_name,
  expected.is_primary,
  true
FROM carrier_tenant_cutover_entities AS expected
ON CONFLICT (id) DO NOTHING;

DO $ruleset_preflight$
BEGIN
  IF (
    SELECT count(*)
    FROM public.carrier_rulesets
  ) <> 3
     OR EXISTS (
       SELECT 1
       FROM public.carrier_rulesets AS ruleset
       WHERE ruleset.carrier_key NOT IN (
         'allstate',
         'andover',
         'wawanesa'
       )
     )
     OR (
       SELECT count(DISTINCT carrier_key)
       FROM public.carrier_rulesets
     ) <> 3 THEN
    RAISE EXCEPTION
      'Carrier ruleset inventory differs from the approved Allstate/Andover/Wawanesa allowlist'
      USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT count(*)
    FROM public.carrier_ruleset_versions
  ) <> 3
     OR EXISTS (
       SELECT 1
       FROM public.carrier_ruleset_versions AS version
       WHERE version.carrier_key NOT IN (
         'allstate',
         'andover',
         'wawanesa'
       )
     )
     OR EXISTS (
       SELECT 1
       FROM public.carrier_ruleset_versions
       GROUP BY carrier_key
       HAVING count(*) <> 1
     ) THEN
    RAISE EXCEPTION
      'Carrier ruleset version inventory differs from one approved version per carrier'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.carrier_rulesets AS ruleset
    JOIN carrier_tenant_cutover_organizations AS expected
      ON expected.carrier_key = ruleset.carrier_key
    WHERE ruleset.organization_id IS NOT NULL
      AND ruleset.organization_id <> expected.organization_id
  ) OR EXISTS (
    SELECT 1
    FROM public.carrier_ruleset_versions AS version
    JOIN carrier_tenant_cutover_organizations AS expected
      ON expected.carrier_key = version.carrier_key
    WHERE version.organization_id IS NOT NULL
      AND version.organization_id <> expected.organization_id
  ) THEN
    RAISE EXCEPTION
      'A carrier ruleset already has conflicting tenant ownership'
      USING ERRCODE = '23514';
  END IF;
END
$ruleset_preflight$;

CREATE TEMP TABLE carrier_tenant_cutover_claim_map (
  claim_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  entity_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO carrier_tenant_cutover_claim_map (
  claim_id,
  organization_id,
  entity_id
)
SELECT
  claim.id,
  mapping.organization_id,
  mapping.entity_id
FROM public.claims AS claim
JOIN carrier_tenant_cutover_carriers AS mapping
  ON mapping.legacy_carrier = claim.carrier;

DO $claim_preflight$
DECLARE
  legacy_organization_id constant uuid :=
    '00000000-0000-4000-8000-000000000001';
BEGIN
  IF (
    SELECT count(*)
    FROM carrier_tenant_cutover_claim_map
  ) <> (
    SELECT count(*)
    FROM public.claims
  ) THEN
    RAISE EXCEPTION
      'Unmapped carrier exists; only the explicit carrier allowlist is accepted'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.claims AS claim
    JOIN carrier_tenant_cutover_claim_map AS mapping
      ON mapping.claim_id = claim.id
    WHERE claim.organization_id NOT IN (
      legacy_organization_id,
      mapping.organization_id
    )
       OR (
         claim.carrier_entity_id IS NOT NULL
         AND claim.carrier_entity_id <> mapping.entity_id
       )
  ) THEN
    RAISE EXCEPTION
      'A claim has conflicting organization or carrier-entity ownership'
      USING ERRCODE = '23514';
  END IF;
END
$claim_preflight$;

CREATE TEMP TABLE carrier_tenant_cutover_document_map (
  document_id uuid PRIMARY KEY,
  claim_id uuid NOT NULL,
  organization_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO carrier_tenant_cutover_document_map (
  document_id,
  claim_id,
  organization_id
)
SELECT
  document.id,
  claim_map.claim_id,
  claim_map.organization_id
FROM public.documents AS document
JOIN carrier_tenant_cutover_claim_map AS claim_map
  ON claim_map.claim_id = document.claim_id;

CREATE TEMP TABLE carrier_tenant_cutover_job_map (
  job_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO carrier_tenant_cutover_job_map (job_id, organization_id)
SELECT
  job.id,
  COALESCE(
    claim_map.organization_id,
    document_map.organization_id
  )
FROM public.processing_jobs AS job
LEFT JOIN carrier_tenant_cutover_claim_map AS claim_map
  ON claim_map.claim_id = job.claim_id
LEFT JOIN carrier_tenant_cutover_document_map AS document_map
  ON document_map.document_id = job.document_id
WHERE COALESCE(
  claim_map.organization_id,
  document_map.organization_id
) IS NOT NULL;

CREATE TEMP TABLE carrier_tenant_cutover_run_map (
  run_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO carrier_tenant_cutover_run_map (run_id, organization_id)
SELECT
  run.id,
  COALESCE(
    claim_map.organization_id,
    job_map.organization_id
  )
FROM public.audit_runs AS run
LEFT JOIN carrier_tenant_cutover_claim_map AS claim_map
  ON claim_map.claim_id = run.claim_id
LEFT JOIN carrier_tenant_cutover_job_map AS job_map
  ON job_map.job_id = run.processing_job_id
WHERE COALESCE(
  claim_map.organization_id,
  job_map.organization_id
) IS NOT NULL;

CREATE TEMP TABLE carrier_tenant_cutover_audit_map (
  audit_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO carrier_tenant_cutover_audit_map (
  audit_id,
  organization_id
)
SELECT
  audit.id,
  COALESCE(
    claim_map.organization_id,
    run_map.organization_id,
    job_map.organization_id
  )
FROM public.audits AS audit
LEFT JOIN carrier_tenant_cutover_claim_map AS claim_map
  ON claim_map.claim_id = audit.claim_id
LEFT JOIN carrier_tenant_cutover_run_map AS run_map
  ON run_map.run_id = audit.audit_run_id
LEFT JOIN carrier_tenant_cutover_job_map AS job_map
  ON job_map.job_id = audit.processing_job_id
WHERE COALESCE(
  claim_map.organization_id,
  run_map.organization_id,
  job_map.organization_id
) IS NOT NULL;

CREATE TEMP TABLE carrier_tenant_cutover_finding_map (
  finding_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO carrier_tenant_cutover_finding_map (
  finding_id,
  organization_id
)
SELECT finding.id, audit_map.organization_id
FROM public.audit_findings AS finding
JOIN carrier_tenant_cutover_audit_map AS audit_map
  ON audit_map.audit_id = finding.audit_id;

CREATE TEMP TABLE carrier_tenant_cutover_version_map (
  version_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO carrier_tenant_cutover_version_map (
  version_id,
  organization_id
)
SELECT version.id, audit_map.organization_id
FROM public.audit_versions AS version
JOIN carrier_tenant_cutover_audit_map AS audit_map
  ON audit_map.audit_id = version.audit_id;

DO $descendant_graph_preflight$
BEGIN
  IF (
    SELECT count(*) FROM carrier_tenant_cutover_document_map
  ) <> (SELECT count(*) FROM public.documents)
     OR (
       SELECT count(*) FROM carrier_tenant_cutover_job_map
     ) <> (SELECT count(*) FROM public.processing_jobs)
     OR (
       SELECT count(*) FROM carrier_tenant_cutover_run_map
     ) <> (SELECT count(*) FROM public.audit_runs)
     OR (
       SELECT count(*) FROM carrier_tenant_cutover_audit_map
     ) <> (SELECT count(*) FROM public.audits)
     OR (
       SELECT count(*) FROM carrier_tenant_cutover_finding_map
     ) <> (SELECT count(*) FROM public.audit_findings)
     OR (
       SELECT count(*) FROM carrier_tenant_cutover_version_map
     ) <> (SELECT count(*) FROM public.audit_versions)
     OR (
       SELECT count(*)
       FROM public.processing_job_attempts AS attempt
       JOIN carrier_tenant_cutover_job_map AS job_map
         ON job_map.job_id = attempt.job_id
     ) <> (SELECT count(*) FROM public.processing_job_attempts)
     OR (
       SELECT count(*)
       FROM public.audit_sections AS section
       JOIN carrier_tenant_cutover_audit_map AS audit_map
         ON audit_map.audit_id = section.audit_id
     ) <> (SELECT count(*) FROM public.audit_sections)
     OR (
       SELECT count(*)
       FROM public.audit_structured AS structured
       JOIN carrier_tenant_cutover_audit_map AS audit_map
         ON audit_map.audit_id = structured.audit_id
     ) <> (SELECT count(*) FROM public.audit_structured)
     OR (
       SELECT count(*)
       FROM public.evidence_anchors AS anchor
       JOIN carrier_tenant_cutover_finding_map AS finding_map
         ON finding_map.finding_id = anchor.finding_id
     ) <> (SELECT count(*) FROM public.evidence_anchors)
     OR (
       SELECT count(*)
       FROM public.claim_activity AS activity
       JOIN carrier_tenant_cutover_claim_map AS claim_map
         ON claim_map.claim_id = activity.claim_id
     ) <> (SELECT count(*) FROM public.claim_activity) THEN
    RAISE EXCEPTION
      'A claim descendant cannot be mapped unambiguously to a claim tenant'
      USING ERRCODE = '23514';
  END IF;
END
$descendant_graph_preflight$;

CREATE TEMP TABLE carrier_tenant_cutover_platform_users (
  user_id varchar PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO carrier_tenant_cutover_platform_users (user_id)
SELECT app_user.id
FROM public.users AS app_user
JOIN public.organization_memberships AS membership
  ON membership.user_id = app_user.id
 AND membership.organization_id =
   '00000000-0000-4000-8000-000000000001'
WHERE lower(btrim(app_user.role)) = 'admin'
  AND membership.role = 'owner'::public.organization_role
UNION
SELECT app_user.id
FROM public.users AS app_user
WHERE app_user.platform_role =
  'platform_admin'::public.platform_role;

CREATE TEMP TABLE carrier_tenant_cutover_tenant_users (
  user_id varchar PRIMARY KEY,
  source_role text NOT NULL
) ON COMMIT DROP;

INSERT INTO carrier_tenant_cutover_tenant_users (
  user_id,
  source_role
)
SELECT membership.user_id, membership.role::text
FROM public.organization_memberships AS membership
WHERE membership.organization_id =
    '00000000-0000-4000-8000-000000000001'
  AND NOT EXISTS (
    SELECT 1
    FROM carrier_tenant_cutover_platform_users AS platform_user
    WHERE platform_user.user_id = membership.user_id
  )
UNION
SELECT membership.user_id, membership.role::text
FROM public.organization_memberships AS membership
JOIN public.users AS app_user
  ON app_user.id = membership.user_id
WHERE membership.organization_id =
    'a11a0000-0000-4000-8000-000000000002'
  AND app_user.platform_role IS DISTINCT FROM
    'platform_admin'::public.platform_role;

DO $membership_preflight$
DECLARE
  legacy_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = '00000000-0000-4000-8000-000000000001'
  )
  INTO legacy_exists;

  IF (
    SELECT count(*)
    FROM carrier_tenant_cutover_platform_users
  ) <> 2
     OR (
       SELECT count(*)
       FROM carrier_tenant_cutover_tenant_users
     ) <> 2
     OR (
       SELECT count(*)
       FROM public.users
     ) <> 4
     OR EXISTS (
       SELECT 1
       FROM public.users AS app_user
       WHERE NOT EXISTS (
         SELECT 1
         FROM carrier_tenant_cutover_platform_users AS platform_user
         WHERE platform_user.user_id = app_user.id
       )
         AND NOT EXISTS (
           SELECT 1
           FROM carrier_tenant_cutover_tenant_users AS tenant_user
           WHERE tenant_user.user_id = app_user.id
         )
     ) THEN
    RAISE EXCEPTION
      'User inventory differs from two platform admins and two Andover users'
      USING ERRCODE = '23514';
  END IF;

  IF legacy_exists THEN
    IF (
      SELECT count(*)
      FROM public.organization_memberships
      WHERE organization_id =
        '00000000-0000-4000-8000-000000000001'
    ) <> 4
       OR EXISTS (
         SELECT 1
         FROM public.organization_memberships
         WHERE organization_id <>
           '00000000-0000-4000-8000-000000000001'
       )
       OR (
         SELECT count(*)
         FROM carrier_tenant_cutover_tenant_users
         WHERE source_role = 'admin'
       ) <> 1
       OR (
         SELECT count(*)
         FROM carrier_tenant_cutover_tenant_users
         WHERE source_role = 'member'
       ) <> 1 THEN
      RAISE EXCEPTION
        'Legacy membership inventory is not the approved owner/owner/admin/member split'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM public.organization_memberships AS membership
      JOIN carrier_tenant_cutover_platform_users AS platform_user
        ON platform_user.user_id = membership.user_id
    )
       OR (
         SELECT count(*)
         FROM public.organization_memberships
         WHERE organization_id =
           'a11a0000-0000-4000-8000-000000000002'
       ) <> 2
       OR (
         SELECT count(*)
         FROM carrier_tenant_cutover_tenant_users
         WHERE source_role = 'owner'
       ) <> 1
       OR (
         SELECT count(*)
         FROM carrier_tenant_cutover_tenant_users
         WHERE source_role = 'member'
       ) <> 1 THEN
      RAISE EXCEPTION
        'Previously cut-over memberships do not match the approved final state'
        USING ERRCODE = '23514';
    END IF;
  END IF;
END
$membership_preflight$;

DO $non_claim_relation_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.platform_tenant_access_leases
    WHERE organization_id =
      '00000000-0000-4000-8000-000000000001'
  ) OR EXISTS (
    SELECT 1
    FROM public.platform_audit_events
    WHERE organization_id =
      '00000000-0000-4000-8000-000000000001'
  ) OR EXISTS (
    SELECT 1
    FROM public.inbound_email_routes
    WHERE organization_id =
      '00000000-0000-4000-8000-000000000001'
  ) OR EXISTS (
    SELECT 1
    FROM public.inbound_email_deliveries
    WHERE organization_id =
      '00000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION
      'A post-foundation platform or inbound-email relation references the legacy organization'
      USING ERRCODE = '23514';
  END IF;
END
$non_claim_relation_preflight$;

-- These guards must be suspended while immutable history rows and the final
-- legacy owner are re-homed. ALTER TRIGGER is transactional: any failure rolls
-- the disable operations back before the migration lock is released.
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

DO $verified_storage_manifest_preflight$
DECLARE
  storage_run private.carrier_tenant_storage_runs%ROWTYPE;
BEGIN
  SELECT *
  INTO storage_run
  FROM private.carrier_tenant_storage_runs
  WHERE run_key = 'carrier-tenant-cutover-v1';

  IF NOT FOUND
     OR storage_run.source_bucket <> 'claim-documents'
     OR storage_run.copy_completed_at IS NULL
     OR storage_run.referenced_count <> (
       SELECT count(*) FROM public.documents
     )
     OR storage_run.inventory_count <>
       storage_run.referenced_count + storage_run.quarantine_count
     OR storage_run.inventory_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION
      'Verified carrier tenant storage run is missing or stale'
      USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT count(*)
    FROM private.carrier_tenant_storage_manifest
    WHERE disposition = 'referenced'
  ) <> storage_run.referenced_count
     OR (
       SELECT count(*)
       FROM private.carrier_tenant_storage_manifest
       WHERE disposition = 'quarantine'
     ) <> storage_run.quarantine_count
     OR EXISTS (
       SELECT 1
       FROM public.documents AS document
       JOIN carrier_tenant_cutover_document_map AS document_map
         ON document_map.document_id = document.id
       LEFT JOIN private.carrier_tenant_storage_manifest AS manifest
         ON manifest.document_id = document.id
        AND manifest.disposition = 'referenced'
       LEFT JOIN storage.objects AS destination
         ON destination.bucket_id = manifest.destination_bucket
        AND destination.name = manifest.destination_path
       WHERE manifest.document_id IS NULL
          OR manifest.organization_id <> document_map.organization_id
          OR manifest.claim_id <> document_map.claim_id
          OR manifest.destination_bucket <> 'claim-documents'
          OR manifest.destination_path NOT LIKE
            'organizations/'
            || document_map.organization_id::text
            || '/claims/'
            || document_map.claim_id::text
            || '/documents/'
            || document.id::text
            || '/%'
          OR document.file_url NOT IN (
            manifest.source_path,
            manifest.destination_path
          )
          OR manifest.verified_at IS NULL
          OR manifest.source_size <> manifest.destination_size
          OR manifest.source_sha256 <> manifest.destination_sha256
          OR manifest.source_sha256 !~ '^[0-9a-f]{64}$'
          OR destination.id IS NULL
          OR (
            document.source_sha256 IS NOT NULL
            AND document.source_sha256 <> manifest.source_sha256
          )
          OR (
            document.metadata IS NOT NULL
            AND pg_catalog.jsonb_typeof(document.metadata) <> 'object'
          )
     )
     OR EXISTS (
       SELECT 1
       FROM private.carrier_tenant_storage_manifest AS manifest
       LEFT JOIN storage.objects AS destination
         ON destination.bucket_id = manifest.destination_bucket
        AND destination.name = manifest.destination_path
       WHERE manifest.disposition = 'quarantine'
         AND (
           manifest.destination_bucket <>
             'carrier-tenant-migration-quarantine'
           OR manifest.verified_at IS NULL
           OR manifest.source_size <> manifest.destination_size
           OR manifest.source_sha256 <> manifest.destination_sha256
           OR destination.id IS NULL
         )
     ) THEN
    RAISE EXCEPTION
      'A referenced or quarantined storage object is absent or unverified'
      USING ERRCODE = '23514';
  END IF;
END
$verified_storage_manifest_preflight$;

UPDATE public.users AS app_user
SET platform_role = 'platform_admin'::public.platform_role
FROM carrier_tenant_cutover_platform_users AS platform_user
WHERE platform_user.user_id = app_user.id
  AND app_user.platform_role IS DISTINCT FROM
    'platform_admin'::public.platform_role;

UPDATE public.claims AS claim
SET
  owner_user_id = CASE
    WHEN EXISTS (
      SELECT 1
      FROM carrier_tenant_cutover_platform_users AS platform_owner
      WHERE platform_owner.user_id = claim.owner_user_id
    )
      OR claim_map.organization_id <>
        'a11a0000-0000-4000-8000-000000000002'
      THEN NULL
    ELSE claim.owner_user_id
  END,
  assignee_user_id = CASE
    WHEN EXISTS (
      SELECT 1
      FROM carrier_tenant_cutover_platform_users AS platform_assignee
      WHERE platform_assignee.user_id = claim.assignee_user_id
    )
      OR claim_map.organization_id <>
        'a11a0000-0000-4000-8000-000000000002'
      THEN NULL
    ELSE claim.assignee_user_id
  END
FROM carrier_tenant_cutover_claim_map AS claim_map
WHERE claim_map.claim_id = claim.id;

DELETE FROM public.saved_views AS saved_view
USING carrier_tenant_cutover_platform_users AS platform_user
WHERE saved_view.user_id = platform_user.user_id
  AND saved_view.organization_id =
    '00000000-0000-4000-8000-000000000001';

UPDATE public.organization_memberships AS membership
SET
  organization_id =
    'a11a0000-0000-4000-8000-000000000002',
  role = CASE membership.role
    WHEN 'admin'::public.organization_role
      THEN 'owner'::public.organization_role
    ELSE membership.role
  END,
  is_default = true
FROM carrier_tenant_cutover_tenant_users AS tenant_user
WHERE tenant_user.user_id = membership.user_id
  AND membership.organization_id =
    '00000000-0000-4000-8000-000000000001';

DELETE FROM public.organization_memberships AS membership
USING carrier_tenant_cutover_platform_users AS platform_user
WHERE platform_user.user_id = membership.user_id
  AND membership.organization_id =
    '00000000-0000-4000-8000-000000000001';

UPDATE public.organization_invitations
SET organization_id =
  'a11a0000-0000-4000-8000-000000000002'
WHERE organization_id =
  '00000000-0000-4000-8000-000000000001';

UPDATE public.password_reset_tokens
SET requested_for_organization_id =
  'a11a0000-0000-4000-8000-000000000002'
WHERE requested_for_organization_id =
  '00000000-0000-4000-8000-000000000001';

UPDATE public.saved_views AS saved_view
SET organization_id =
  'a11a0000-0000-4000-8000-000000000002'
FROM carrier_tenant_cutover_tenant_users AS tenant_user
WHERE tenant_user.user_id = saved_view.user_id
  AND saved_view.organization_id =
    '00000000-0000-4000-8000-000000000001';

UPDATE public.organization_settings
SET organization_id =
  'a11a0000-0000-4000-8000-000000000002'
WHERE organization_id =
  '00000000-0000-4000-8000-000000000001';

INSERT INTO public.organization_settings (organization_id)
SELECT organization_id
FROM carrier_tenant_cutover_organizations
ON CONFLICT (organization_id) DO NOTHING;

UPDATE public.prompt_settings
SET organization_id =
  'a11a0000-0000-4000-8000-000000000002'
WHERE organization_id =
  '00000000-0000-4000-8000-000000000001';

UPDATE public.organization_audit_events AS event
SET organization_id = CASE
  WHEN event.target_type = 'claim'
    THEN COALESCE(
      (
        SELECT claim_map.organization_id
        FROM carrier_tenant_cutover_claim_map AS claim_map
        WHERE claim_map.claim_id::text = event.target_id
      ),
      'a11a0000-0000-4000-8000-000000000002'::uuid
    )
  ELSE 'a11a0000-0000-4000-8000-000000000002'::uuid
END
WHERE event.organization_id =
  '00000000-0000-4000-8000-000000000001';

UPDATE public.carrier_rulesets AS ruleset
SET organization_id = expected.organization_id
FROM carrier_tenant_cutover_organizations AS expected
WHERE expected.carrier_key = ruleset.carrier_key;

UPDATE public.carrier_ruleset_versions AS version
SET organization_id = expected.organization_id
FROM carrier_tenant_cutover_organizations AS expected
WHERE expected.carrier_key = version.carrier_key;

UPDATE public.claims AS claim
SET
  organization_id = claim_map.organization_id,
  carrier_entity_id = claim_map.entity_id
FROM carrier_tenant_cutover_claim_map AS claim_map
WHERE claim_map.claim_id = claim.id;

UPDATE public.documents AS document
SET
  organization_id = document_map.organization_id,
  file_url = manifest.destination_path,
  source_sha256 = manifest.source_sha256,
  metadata = COALESCE(document.metadata, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(
      'organizationId', document_map.organization_id::text,
      'claimId', document_map.claim_id::text,
      'documentId', document.id::text,
      'storagePath', manifest.destination_path,
      'sourceSha256', manifest.source_sha256,
      'sourceSize', manifest.source_size
    )
FROM carrier_tenant_cutover_document_map AS document_map
JOIN private.carrier_tenant_storage_manifest AS manifest
  ON manifest.document_id = document_map.document_id
 AND manifest.disposition = 'referenced'
WHERE document.id = document_map.document_id;

UPDATE public.processing_jobs AS job
SET organization_id = job_map.organization_id
FROM carrier_tenant_cutover_job_map AS job_map
WHERE job_map.job_id = job.id;

UPDATE public.processing_job_attempts AS attempt
SET organization_id = job_map.organization_id
FROM carrier_tenant_cutover_job_map AS job_map
WHERE job_map.job_id = attempt.job_id;

UPDATE public.audit_runs AS run
SET organization_id = run_map.organization_id
FROM carrier_tenant_cutover_run_map AS run_map
WHERE run_map.run_id = run.id;

UPDATE public.audits AS audit
SET organization_id = audit_map.organization_id
FROM carrier_tenant_cutover_audit_map AS audit_map
WHERE audit_map.audit_id = audit.id;

UPDATE public.audit_sections AS section
SET organization_id = audit_map.organization_id
FROM carrier_tenant_cutover_audit_map AS audit_map
WHERE audit_map.audit_id = section.audit_id;

UPDATE public.audit_findings AS finding
SET organization_id = finding_map.organization_id
FROM carrier_tenant_cutover_finding_map AS finding_map
WHERE finding_map.finding_id = finding.id;

UPDATE public.audit_structured AS structured
SET organization_id = audit_map.organization_id
FROM carrier_tenant_cutover_audit_map AS audit_map
WHERE audit_map.audit_id = structured.audit_id;

UPDATE public.audit_versions AS version
SET organization_id = version_map.organization_id
FROM carrier_tenant_cutover_version_map AS version_map
WHERE version_map.version_id = version.id;

UPDATE public.evidence_anchors AS anchor
SET organization_id = finding_map.organization_id
FROM carrier_tenant_cutover_finding_map AS finding_map
WHERE finding_map.finding_id = anchor.finding_id;

UPDATE public.claim_activity AS activity
SET organization_id = claim_map.organization_id
FROM carrier_tenant_cutover_claim_map AS claim_map
WHERE claim_map.claim_id = activity.claim_id;

-- Drain deferred FK/profile trigger events before ALTER TABLE validation.
SET CONSTRAINTS ALL IMMEDIATE;

DO $validate_expand_constraints$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS relation_name,
      constraint_record.conname AS constraint_name
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND constraint_record.contype IN ('c', 'f')
      AND NOT constraint_record.convalidated
    ORDER BY relation.relname, constraint_record.conname
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',
      item.schema_name,
      item.relation_name,
      item.constraint_name
    );
  END LOOP;
END
$validate_expand_constraints$;

ALTER TABLE public.carrier_rulesets
  ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.carrier_ruleset_versions
  ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.claims
  ALTER COLUMN carrier_entity_id SET NOT NULL;

DO $legacy_reference_preflight$
DECLARE
  legacy_organization_id constant uuid :=
    '00000000-0000-4000-8000-000000000001';
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.organization_memberships
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.organization_invitations
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.saved_views
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.organization_audit_events
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.organization_settings
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.prompt_settings
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.carrier_entities
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.carrier_rulesets
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.carrier_ruleset_versions
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.claims
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.documents
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.processing_jobs
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.processing_job_attempts
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.audit_runs
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.audits
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.audit_sections
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.audit_findings
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.audit_structured
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.audit_versions
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.evidence_anchors
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.claim_activity
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.platform_tenant_access_leases
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.platform_audit_events
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.inbound_email_routes
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.inbound_email_deliveries
    WHERE organization_id = legacy_organization_id
    UNION ALL
    SELECT 1 FROM public.password_reset_tokens
    WHERE requested_for_organization_id = legacy_organization_id
  ) THEN
    RAISE EXCEPTION
      'Legacy organization still has dependent rows after cutover'
      USING ERRCODE = '23514';
  END IF;
END
$legacy_reference_preflight$;

DELETE FROM public.organizations
WHERE id = '00000000-0000-4000-8000-000000000001';

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

DO $final_cutover_assertions$
BEGIN
  IF (
    SELECT count(*)
    FROM public.organizations
  ) <> 3
     OR EXISTS (
       SELECT 1
       FROM carrier_tenant_cutover_organizations AS expected
       WHERE NOT EXISTS (
         SELECT 1
         FROM public.carrier_rulesets AS ruleset
         WHERE ruleset.organization_id = expected.organization_id
           AND ruleset.carrier_key = expected.carrier_key
       )
     )
     OR EXISTS (
       SELECT 1
       FROM carrier_tenant_cutover_organizations AS expected
       WHERE (
         SELECT count(*)
         FROM public.carrier_entities AS entity
         WHERE entity.organization_id = expected.organization_id
           AND entity.is_primary
       ) <> 1
     )
     OR EXISTS (
       SELECT 1
       FROM public.claims
       WHERE carrier_entity_id IS NULL
     )
     OR EXISTS (
       SELECT 1
       FROM public.carrier_rulesets
       WHERE organization_id IS NULL
     )
     OR EXISTS (
       SELECT 1
       FROM public.carrier_ruleset_versions
       WHERE organization_id IS NULL
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint AS constraint_record
       JOIN pg_catalog.pg_class AS relation
         ON relation.oid = constraint_record.conrelid
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND constraint_record.contype IN ('c', 'f')
         AND NOT constraint_record.convalidated
     )
     OR (
       SELECT count(*)
       FROM public.users
       WHERE platform_role =
         'platform_admin'::public.platform_role
     ) <> 2
     OR EXISTS (
       SELECT 1
       FROM public.organization_memberships AS membership
       JOIN public.users AS app_user
         ON app_user.id = membership.user_id
       WHERE app_user.platform_role =
         'platform_admin'::public.platform_role
     )
     OR (
       SELECT count(*)
       FROM public.organization_memberships
       WHERE organization_id =
         'a11a0000-0000-4000-8000-000000000002'
     ) <> 2
     OR (
       SELECT count(*)
       FROM public.organization_memberships
       WHERE organization_id =
           'a11a0000-0000-4000-8000-000000000002'
         AND role = 'owner'::public.organization_role
     ) <> 1 THEN
    RAISE EXCEPTION
      'Carrier tenant cutover final-state validation failed'
      USING ERRCODE = '23514';
  END IF;
END
$final_cutover_assertions$;

COMMIT;
