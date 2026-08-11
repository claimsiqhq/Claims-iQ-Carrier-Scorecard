-- Focused Supabase Storage tenant-isolation validation. Run only against an
-- isolated rehearsal database after 20260810225039_carrier_tenant_storage.sql.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL row_security = on;

DO $structural_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'claim-documents'
      AND name = 'claim-documents'
      AND public = false
      AND file_size_limit = 104857600
  ) THEN
    RAISE EXCEPTION 'The private claim-documents bucket is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'carrier-tenant-migration-quarantine'
      AND name = 'carrier-tenant-migration-quarantine'
      AND public = false
      AND file_size_limit = 104857600
  ) OR pg_catalog.to_regclass(
    'private.carrier_tenant_storage_manifest'
  ) IS NULL OR pg_catalog.to_regclass(
    'private.carrier_tenant_storage_runs'
  ) IS NULL THEN
    RAISE EXCEPTION
      'The private migration quarantine or durable manifest is missing';
  END IF;

  IF pg_catalog.has_table_privilege(
       'anon',
       'private.carrier_tenant_storage_manifest',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated',
       'private.carrier_tenant_storage_manifest',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'A Data API role can read the migration manifest';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
      AND policy.policyname LIKE 'claim_documents_tenant_%'
      AND policy.roles = ARRAY['authenticated']::name[]
  ) <> 4 THEN
    RAISE EXCEPTION
      'The complete authenticated claim-document policy set is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
      AND policy.permissive = 'PERMISSIVE'
      AND policy.roles
        && ARRAY['public', 'anon', 'authenticated']::name[]
      AND policy.policyname NOT LIKE 'claim_documents_tenant_%'
  ) THEN
    RAISE EXCEPTION
      'A foreign permissive Data API policy remains on storage.objects';
  END IF;

  IF pg_catalog.has_table_privilege(
       'anon',
       'storage.objects',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated',
       'public.inbound_email_routes',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'claims_iq_identity',
       'public.inbound_email_routes',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'A storage/email boundary retained an unsafe direct grant';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'inbound_email_deliveries'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Inbound delivery RLS is not forced';
  END IF;
END
$structural_assertions$;

INSERT INTO public.organizations (id, name, slug)
VALUES
  (
    'a1000000-0000-4000-8000-000000000001',
    'Storage Tenant A',
    'storage-tenant-a'
  ),
  (
    'b1000000-0000-4000-8000-000000000002',
    'Storage Tenant B',
    'storage-tenant-b'
  );

INSERT INTO public.users (
  id,
  email,
  password_hash,
  role,
  auth_version,
  email_verified_at
)
VALUES
  (
    'storage-user-a',
    'storage-user-a@example.invalid',
    'test-only',
    'user',
    1,
    pg_catalog.statement_timestamp()
  ),
  (
    'storage-user-b',
    'storage-user-b@example.invalid',
    'test-only',
    'user',
    1,
    pg_catalog.statement_timestamp()
  );

INSERT INTO public.organization_memberships (
  organization_id,
  user_id,
  role,
  permissions
)
VALUES
  (
    'a1000000-0000-4000-8000-000000000001',
    'storage-user-a',
    'member',
    '["email:ingest"]'::jsonb
  ),
  (
    'b1000000-0000-4000-8000-000000000002',
    'storage-user-b',
    'member',
    '[]'::jsonb
  );

INSERT INTO public.inbound_email_routes (
  id,
  organization_id,
  recipient_address,
  route_key_hash,
  webhook_secret_hash,
  provider_public_key
)
VALUES (
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'storage-tenant-a@inbound.example.invalid',
  pg_catalog.repeat('a', 64),
  pg_catalog.repeat('b', 64),
  'test-provider-public-key'
);

SET LOCAL ROLE claims_iq_identity;

DO $inbound_route_assertions$
DECLARE
  resolved_route record;
  authorized_sender record;
BEGIN
  SELECT *
  INTO resolved_route
  FROM private.resolve_inbound_email_route(
    pg_catalog.repeat('a', 64),
    pg_catalog.repeat('b', 64)
  );

  IF resolved_route.route_id IS DISTINCT FROM
       'a4000000-0000-4000-8000-000000000001'::uuid
     OR resolved_route.organization_id IS DISTINCT FROM
       'a1000000-0000-4000-8000-000000000001'::uuid
     OR resolved_route.recipient_address IS DISTINCT FROM
       'storage-tenant-a@inbound.example.invalid' THEN
    RAISE EXCEPTION 'Valid inbound route did not resolve deterministically';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.resolve_inbound_email_route(
      pg_catalog.repeat('a', 64),
      pg_catalog.repeat('c', 64)
    )
  ) THEN
    RAISE EXCEPTION 'Forged inbound route secret was accepted';
  END IF;

  SELECT *
  INTO authorized_sender
  FROM private.authorize_inbound_email_sender(
    'a4000000-0000-4000-8000-000000000001'::uuid,
    'STORAGE-USER-A@EXAMPLE.INVALID'
  );

  IF authorized_sender.organization_id IS DISTINCT FROM
       'a1000000-0000-4000-8000-000000000001'::uuid
     OR authorized_sender.user_id IS DISTINCT FROM 'storage-user-a'
     OR authorized_sender.auth_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Permitted inbound sender was not authorized';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.authorize_inbound_email_sender(
      'a4000000-0000-4000-8000-000000000001'::uuid,
      'storage-user-b@example.invalid'
    )
  ) THEN
    RAISE EXCEPTION 'Foreign or unpermitted inbound sender was authorized';
  END IF;
END
$inbound_route_assertions$;

RESET ROLE;

INSERT INTO public.sessions (
  sid,
  sess,
  expire,
  user_id,
  auth_version
)
VALUES
  (
    'storage-session-a',
    '{"purpose":"storage-validation"}'::jsonb,
    pg_catalog.statement_timestamp() + interval '10 minutes',
    'storage-user-a',
    1
  ),
  (
    'storage-session-b',
    '{"purpose":"storage-validation"}'::jsonb,
    pg_catalog.statement_timestamp() + interval '10 minutes',
    'storage-user-b',
    1
  );

INSERT INTO public.claims (
  id,
  organization_id,
  claim_number,
  insured_name,
  owner_user_id
)
VALUES
  (
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'STORAGE-A-1',
    'Tenant A Synthetic',
    'storage-user-a'
  ),
  (
    'b2000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000002',
    'STORAGE-B-1',
    'Tenant B Synthetic',
    'storage-user-b'
  );

INSERT INTO storage.objects (bucket_id, name)
VALUES
  (
    'claim-documents',
    'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000001/report-a.pdf'
  ),
  (
    'claim-documents',
    'organizations/b1000000-0000-4000-8000-000000000002/claims/b2000000-0000-4000-8000-000000000002/documents/b3000000-0000-4000-8000-000000000002/report-b.pdf'
  );

INSERT INTO public.documents (
  id,
  organization_id,
  claim_id,
  uploaded_by_user_id,
  type,
  file_url,
  metadata
)
VALUES (
  'a3000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'storage-user-a',
  'claim_file',
  'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000001/report-a.pdf',
  jsonb_build_object(
    'organizationId',
    'a1000000-0000-4000-8000-000000000001',
    'claimId',
    'a2000000-0000-4000-8000-000000000001',
    'documentId',
    'a3000000-0000-4000-8000-000000000001',
    'storagePath',
    'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000001/report-a.pdf'
  )
);

INSERT INTO public.processing_jobs (
  id,
  organization_id,
  claim_id,
  document_id,
  requested_by_user_id,
  type,
  idempotency_key
)
VALUES (
  'a5000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'storage-user-a',
  'ingest',
  'storage-validation-inbound-message'
);

INSERT INTO public.inbound_email_deliveries (
  id,
  organization_id,
  route_id,
  provider_message_id,
  sender_email,
  recipient_address,
  requested_by_user_id,
  claim_id,
  document_id,
  processing_job_id
)
VALUES (
  'a6000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  '<storage-validation@example.invalid>',
  'storage-user-a@example.invalid',
  'storage-tenant-a@inbound.example.invalid',
  'storage-user-a',
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001'
);

DO $inbound_replay_assertion$
DECLARE
  duplicate_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.inbound_email_deliveries (
      id,
      organization_id,
      route_id,
      provider_message_id,
      sender_email,
      recipient_address,
      requested_by_user_id,
      claim_id,
      document_id,
      processing_job_id
    )
    VALUES (
      'a6000000-0000-4000-8000-000000000002',
      'a1000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000001',
      '<storage-validation@example.invalid>',
      'storage-user-a@example.invalid',
      'storage-tenant-a@inbound.example.invalid',
      'storage-user-a',
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001'
    );
  EXCEPTION
    WHEN unique_violation THEN duplicate_blocked := true;
  END;

  IF NOT duplicate_blocked THEN
    RAISE EXCEPTION 'Inbound provider-message replay was not rejected';
  END IF;
END
$inbound_replay_assertion$;

SET LOCAL ROLE claims_iq_tenant_api;
SELECT pg_catalog.set_config('app.user_id', 'storage-user-a', true);
SELECT pg_catalog.set_config(
  'app.organization_id',
  'a1000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config('app.session_id', 'storage-session-a', true);

DO $inbound_delivery_rls_assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM public.inbound_email_deliveries
  ) <> 1 THEN
    RAISE EXCEPTION 'Tenant delivery RLS did not expose exactly its own row';
  END IF;
END
$inbound_delivery_rls_assertion$;

RESET ROLE;
SELECT pg_catalog.set_config('app.user_id', '', true);
SELECT pg_catalog.set_config('app.organization_id', '', true);
SELECT pg_catalog.set_config('app.session_id', '', true);

DO $registration_assertions$
DECLARE
  blocked_tenant_path boolean := false;
  blocked_document_path boolean := false;
  blocked_metadata boolean := false;
  blocked_missing_object boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.documents (
      id,
      organization_id,
      claim_id,
      type,
      file_url,
      metadata
    )
    VALUES (
      'a3000000-0000-4000-8000-000000000002',
      'a1000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      'claim_file',
      'organizations/b1000000-0000-4000-8000-000000000002/claims/b2000000-0000-4000-8000-000000000002/documents/b3000000-0000-4000-8000-000000000002/report-b.pdf',
      jsonb_build_object(
        'organizationId',
        'a1000000-0000-4000-8000-000000000001',
        'claimId',
        'a2000000-0000-4000-8000-000000000001',
        'documentId',
        'a3000000-0000-4000-8000-000000000002',
        'storagePath',
        'organizations/b1000000-0000-4000-8000-000000000002/claims/b2000000-0000-4000-8000-000000000002/documents/b3000000-0000-4000-8000-000000000002/report-b.pdf'
      )
    );
  EXCEPTION
    WHEN check_violation THEN blocked_tenant_path := true;
  END;

  BEGIN
    INSERT INTO public.documents (
      id,
      organization_id,
      claim_id,
      type,
      file_url,
      metadata
    )
    VALUES (
      'a3000000-0000-4000-8000-000000000004',
      'a1000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      'claim_file',
      'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000001/wrong-document.pdf',
      jsonb_build_object(
        'organizationId',
        'a1000000-0000-4000-8000-000000000001',
        'claimId',
        'a2000000-0000-4000-8000-000000000001',
        'documentId',
        'a3000000-0000-4000-8000-000000000004',
        'storagePath',
        'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000001/wrong-document.pdf'
      )
    );
  EXCEPTION
    WHEN check_violation THEN blocked_document_path := true;
  END;

  BEGIN
    INSERT INTO public.documents (
      id,
      organization_id,
      claim_id,
      type,
      file_url,
      metadata
    )
    VALUES (
      'a3000000-0000-4000-8000-000000000005',
      'a1000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      'claim_file',
      'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000005/metadata-mismatch.pdf',
      jsonb_build_object(
        'organizationId',
        'a1000000-0000-4000-8000-000000000001',
        'claimId',
        'a2000000-0000-4000-8000-000000000001',
        'documentId',
        'b3000000-0000-4000-8000-000000000002',
        'storagePath',
        'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000005/metadata-mismatch.pdf'
      )
    );
  EXCEPTION
    WHEN check_violation THEN blocked_metadata := true;
  END;

  BEGIN
    INSERT INTO public.documents (
      id,
      organization_id,
      claim_id,
      type,
      file_url,
      metadata
    )
    VALUES (
      'a3000000-0000-4000-8000-000000000003',
      'a1000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      'claim_file',
      'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000003/missing.pdf',
      jsonb_build_object(
        'organizationId',
        'a1000000-0000-4000-8000-000000000001',
        'claimId',
        'a2000000-0000-4000-8000-000000000001',
        'documentId',
        'a3000000-0000-4000-8000-000000000003',
        'storagePath',
        'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000003/missing.pdf'
      )
    );
  EXCEPTION
    WHEN foreign_key_violation THEN blocked_missing_object := true;
  END;

  IF NOT blocked_tenant_path
     OR NOT blocked_document_path
     OR NOT blocked_metadata
     OR NOT blocked_missing_object THEN
    RAISE EXCEPTION
      'Document storage path/metadata/existence registration validation failed';
  END IF;
END
$registration_assertions$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated',
    'sub', 'storage-user-a',
    'user_id', 'storage-user-a',
    'organization_id', 'a1000000-0000-4000-8000-000000000001',
    'session_id', 'storage-session-a',
    'exp', EXTRACT(
      EPOCH FROM pg_catalog.statement_timestamp() + interval '5 minutes'
    )::bigint
  )::text,
  true
);

DO $tenant_a_storage_assertions$
DECLARE
  blocked_cross_tenant_insert boolean := false;
  affected_rows bigint;
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM storage.objects
    WHERE bucket_id = 'claim-documents'
  ) <> 1
     OR EXISTS (
       SELECT 1
       FROM storage.objects
       WHERE name LIKE 'organizations/b1000000-%'
     ) THEN
    RAISE EXCEPTION 'Tenant A can see a foreign storage object';
  END IF;

  IF storage.claim_document_path_is_authorized(
       'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000001/%2e%2e.pdf'
     )
     OR storage.claim_document_path_is_authorized(
       'organizations/a1000000-0000-4000-8000-000000000001/claims/../documents/a3000000-0000-4000-8000-000000000001/report.pdf'
     )
     OR storage.claim_document_path_is_authorized(
       'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000001/report%2Fescape.pdf'
     )
     OR storage.claim_document_path_is_authorized(
       'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000001/report%252e.pdf'
     )
     OR storage.claim_document_path_is_authorized(
       'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001\documents\a3000000-0000-4000-8000-000000000001\report.pdf'
     ) THEN
    RAISE EXCEPTION 'Traversal or encoded storage path was authorized';
  END IF;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES (
      'claim-documents',
      'organizations/b1000000-0000-4000-8000-000000000002/claims/b2000000-0000-4000-8000-000000000002/documents/b3000000-0000-4000-8000-000000000003/forged.pdf'
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      blocked_cross_tenant_insert := true;
  END;

  IF NOT blocked_cross_tenant_insert THEN
    RAISE EXCEPTION 'Tenant A inserted a Tenant B storage object';
  END IF;

  INSERT INTO storage.objects (bucket_id, name)
  VALUES (
    'claim-documents',
    'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000004/temporary.pdf'
  );

  UPDATE storage.objects
  SET name =
    'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000004/renamed.pdf'
  WHERE name =
    'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000004/temporary.pdf';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'Tenant A could not update its authorized storage object';
  END IF;

  UPDATE storage.objects
  SET name =
    'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000004/forged-update.pdf'
  WHERE name =
    'organizations/b1000000-0000-4000-8000-000000000002/claims/b2000000-0000-4000-8000-000000000002/documents/b3000000-0000-4000-8000-000000000002/report-b.pdf';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'Tenant A updated a Tenant B storage object';
  END IF;

  DELETE FROM storage.objects
  WHERE name =
    'organizations/b1000000-0000-4000-8000-000000000002/claims/b2000000-0000-4000-8000-000000000002/documents/b3000000-0000-4000-8000-000000000002/report-b.pdf';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'Tenant A deleted a Tenant B storage object';
  END IF;

  DELETE FROM storage.objects
  WHERE name =
    'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000004/renamed.pdf';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'Tenant A could not delete its authorized storage object';
  END IF;
END
$tenant_a_storage_assertions$;

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated',
    'sub', 'storage-user-a',
    'user_id', 'storage-user-a',
    'organization_id', 'a1000000-0000-4000-8000-000000000001',
    'session_id', 'storage-session-a',
    'exp', EXTRACT(
      EPOCH FROM pg_catalog.statement_timestamp() - interval '1 minute'
    )::bigint
  )::text,
  true
);

DO $expired_jwt_assertion$
DECLARE
  blocked_insert boolean := false;
  affected_rows bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects) THEN
    RAISE EXCEPTION 'An expired JWT retained storage access';
  END IF;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES (
      'claim-documents',
      'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000006/expired-write.pdf'
    );
  EXCEPTION
    WHEN insufficient_privilege THEN blocked_insert := true;
  END;

  DELETE FROM storage.objects
  WHERE name =
    'organizations/a1000000-0000-4000-8000-000000000001/claims/a2000000-0000-4000-8000-000000000001/documents/a3000000-0000-4000-8000-000000000001/report-a.pdf';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  IF NOT blocked_insert OR affected_rows <> 0 THEN
    RAISE EXCEPTION 'An expired JWT retained storage write/delete access';
  END IF;
END
$expired_jwt_assertion$;

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated',
    'sub', 'storage-user-b',
    'user_id', 'storage-user-b',
    'organization_id', 'b1000000-0000-4000-8000-000000000002',
    'session_id', 'storage-session-b',
    'exp', EXTRACT(
      EPOCH FROM pg_catalog.statement_timestamp() + interval '5 minutes'
    )::bigint
  )::text,
  true
);

DO $tenant_b_storage_assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM storage.objects
    WHERE bucket_id = 'claim-documents'
  ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM storage.objects
       WHERE name LIKE 'organizations/b1000000-%'
     ) THEN
    RAISE EXCEPTION 'JWT organization mismatch did not isolate storage';
  END IF;
END
$tenant_b_storage_assertion$;

SELECT pg_catalog.set_config('request.jwt.claims', '{}'::jsonb::text, true);

DO $missing_claims_assertion$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects) THEN
    RAISE EXCEPTION 'Missing JWT claims retained storage access';
  END IF;
END
$missing_claims_assertion$;

RESET ROLE;

ROLLBACK;
