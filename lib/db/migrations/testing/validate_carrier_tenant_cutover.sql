-- Final-state assertions for the isolated carrier tenant cutover rehearsal.

DO $cutover_assertions$
DECLARE
  allstate_id constant uuid :=
    'a11a0000-0000-4000-8000-000000000001';
  andover_id constant uuid :=
    'a11a0000-0000-4000-8000-000000000002';
  wawanesa_id constant uuid :=
    'a11a0000-0000-4000-8000-000000000003';
BEGIN
  IF (
    SELECT count(*)
    FROM public.organizations
  ) <> 3
     OR EXISTS (
       SELECT 1
       FROM public.organizations
       WHERE id =
         '00000000-0000-4000-8000-000000000001'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.organizations
       WHERE id = allstate_id AND slug = 'allstate'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.organizations
       WHERE id = andover_id AND slug = 'andover'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.organizations
       WHERE id = wawanesa_id AND slug = 'wawanesa'
     ) THEN
    RAISE EXCEPTION 'Deterministic carrier organizations are invalid';
  END IF;

  IF (
    SELECT count(*) FROM public.carrier_entities
  ) <> 6
     OR (
       SELECT count(*)
       FROM public.carrier_entities
       WHERE is_primary
     ) <> 3
     OR NOT EXISTS (
       SELECT 1
       FROM public.carrier_entities
       WHERE id = 'e11e0000-0000-4000-8000-000000000003'
         AND organization_id = andover_id
         AND entity_key = 'bay-state-insurance-company'
         AND NOT is_primary
     ) THEN
    RAISE EXCEPTION 'Carrier entity hierarchy or deterministic IDs are invalid';
  END IF;

  IF (
    SELECT count(*) FROM public.carrier_rulesets
  ) <> 3
     OR (
       SELECT count(*) FROM public.carrier_ruleset_versions
     ) <> 3
     OR EXISTS (
       SELECT 1 FROM public.carrier_rulesets
       WHERE organization_id IS NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.carrier_ruleset_versions
       WHERE organization_id IS NULL
     ) THEN
    RAISE EXCEPTION 'Carrier ruleset ownership was not completed exactly';
  END IF;

  IF (
    SELECT count(*) FROM public.claims
  ) <> 5
     OR (
       SELECT count(*) FROM public.claims
       WHERE organization_id = allstate_id
     ) <> 1
     OR (
       SELECT count(*) FROM public.claims
       WHERE organization_id = andover_id
     ) <> 4
     OR (
       SELECT count(*) FROM public.claims
       WHERE carrier = 'Allstate'
     ) <> 1
     OR (
       SELECT count(*) FROM public.claims
       WHERE carrier = 'Andover'
     ) <> 1
     OR (
       SELECT count(*) FROM public.claims
       WHERE carrier = 'Bay State Insurance Company'
     ) <> 1
     OR (
       SELECT count(*) FROM public.claims
       WHERE carrier = 'Cambridge Mutual'
     ) <> 1
     OR (
       SELECT count(*) FROM public.claims
       WHERE carrier = 'Merrimack Mutual'
     ) <> 1
     OR EXISTS (
       SELECT 1
       FROM public.claims AS claim
       LEFT JOIN public.carrier_entities AS entity
         ON entity.id = claim.carrier_entity_id
        AND entity.organization_id = claim.organization_id
       WHERE entity.id IS NULL
     ) THEN
    RAISE EXCEPTION 'Claim counts or carrier entity mappings are invalid';
  END IF;

  IF (
    SELECT count(*) FROM public.documents
  ) <> 5
     OR EXISTS (
       SELECT 1
       FROM public.documents AS document
       WHERE document.file_url NOT LIKE
         'organizations/'
         || document.organization_id::text
         || '/claims/'
         || document.claim_id::text
         || '/documents/'
         || document.id::text
         || '/%'
          OR document.metadata ->> 'organizationId' <>
            document.organization_id::text
          OR document.metadata ->> 'claimId' <> document.claim_id::text
          OR document.metadata ->> 'documentId' <> document.id::text
          OR document.metadata ->> 'storagePath' <> document.file_url
          OR document.source_sha256 !~ '^[0-9a-f]{64}$'
     )
     OR (
       SELECT count(*)
       FROM private.carrier_tenant_storage_manifest
       WHERE disposition = 'referenced'
     ) <> 5
     OR (
       SELECT count(*)
       FROM private.carrier_tenant_storage_manifest
       WHERE disposition = 'quarantine'
     ) <> 4
     OR (
       SELECT quarantine_count
       FROM private.carrier_tenant_storage_runs
       WHERE run_key = 'carrier-tenant-cutover-v1'
     ) <> 4 THEN
    RAISE EXCEPTION 'Storage paths, hashes, or manifest counts are invalid';
  END IF;

  IF (
    SELECT count(*)
    FROM storage.objects
    WHERE bucket_id = 'claim-documents'
      AND name LIKE 'legacy/%'
  ) <> 9
     OR (
       SELECT count(*)
       FROM storage.objects
       WHERE bucket_id = 'carrier-tenant-migration-quarantine'
     ) <> 4 THEN
    RAISE EXCEPTION
      'Legacy objects were deleted or quarantine copies are incomplete';
  END IF;

  IF (
    SELECT count(*)
    FROM public.users
    WHERE platform_role = 'platform_admin'::public.platform_role
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
       WHERE organization_id = andover_id
     ) <> 2
     OR (
       SELECT count(*)
       FROM public.organization_memberships
       WHERE organization_id = andover_id
         AND role = 'owner'::public.organization_role
         AND user_id = 'user-tenant-admin'
     ) <> 1
     OR (
       SELECT count(*)
       FROM public.organization_memberships
       WHERE organization_id = andover_id
         AND role = 'member'::public.organization_role
         AND user_id = 'user-reviewer'
     ) <> 1 THEN
    RAISE EXCEPTION 'Platform roles or final Andover memberships are invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.audit_runs
    WHERE id = '95000000-0000-4000-8000-000000000001'
      AND organization_id = allstate_id
      AND actor_user_id = 'user-admin'
      AND ruleset_hash = pg_catalog.repeat('a', 64)
      AND prompt_hash = pg_catalog.repeat('b', 64)
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.audits
    WHERE id = '96000000-0000-4000-8000-000000000001'
      AND organization_id = allstate_id
      AND version_number = 1
      AND actor_user_id = 'user-admin'
      AND ruleset_hash = pg_catalog.repeat('a', 64)
      AND prompt_hash = pg_catalog.repeat('b', 64)
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.audit_versions
    WHERE id = '9a000000-0000-4000-8000-000000000001'
      AND organization_id = allstate_id
      AND version_number = 1
  ) THEN
    RAISE EXCEPTION 'Audit identity, version, hash, or actor provenance changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_audit_events
    WHERE id = '9f000000-0000-4000-8000-000000000001'
      AND organization_id = allstate_id
      AND actor_user_id = 'user-admin'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.organization_audit_events
    WHERE id = '9f000000-0000-4000-8000-000000000002'
      AND organization_id = andover_id
      AND actor_user_id = 'user-tenant-admin'
  ) OR EXISTS (
    SELECT 1
    FROM public.prompt_settings
    WHERE organization_id <> andover_id
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.organization_settings
    WHERE organization_id = andover_id
      AND in_app_notifications_enabled
  ) OR EXISTS (
    SELECT 1
    FROM public.organization_invitations
    WHERE organization_id <> andover_id
  ) OR EXISTS (
    SELECT 1
    FROM public.password_reset_tokens
    WHERE requested_for_organization_id <> andover_id
  ) THEN
    RAISE EXCEPTION 'Deterministic non-claim or event ownership is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND constraint_record.contype IN ('c', 'f')
      AND NOT constraint_record.convalidated
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (
          table_name = 'carrier_rulesets'
          AND column_name = 'organization_id'
        )
        OR (
          table_name = 'carrier_ruleset_versions'
          AND column_name = 'organization_id'
        )
        OR (
          table_name = 'claims'
          AND column_name = 'carrier_entity_id'
        )
      )
      AND is_nullable <> 'NO'
  ) THEN
    RAISE EXCEPTION 'Cutover constraints were not validated or tightened';
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
        'trg_organization_memberships_owner_guard'
      )
      AND trigger_record.tgenabled <> 'O'
  ) THEN
    RAISE EXCEPTION 'A suspended immutable or owner trigger was not restored';
  END IF;
END
$cutover_assertions$;
