-- Simulate the external service-role copy for PostgreSQL-only rehearsal. The
-- production predeploy uses the migration adapter and real object bytes.

CREATE TEMP TABLE rehearsal_document_destinations (
  document_id uuid PRIMARY KEY,
  claim_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  source_path text NOT NULL,
  destination_path text NOT NULL,
  object_size bigint NOT NULL,
  object_sha256 varchar(64) NOT NULL
) ON COMMIT DROP;

INSERT INTO rehearsal_document_destinations (
  document_id,
  claim_id,
  organization_id,
  source_path,
  destination_path,
  object_size,
  object_sha256
)
SELECT
  document.id,
  claim.id,
  mapping.organization_id,
  document.file_url,
  'organizations/'
    || mapping.organization_id::text
    || '/claims/'
    || claim.id::text
    || '/documents/'
    || document.id::text
    || '/'
    || pg_catalog.regexp_replace(document.file_url, '^.*/', ''),
  (source.metadata ->> 'size')::bigint,
  (
    pg_catalog.md5('fixture-source:' || document.file_url)
    || pg_catalog.md5('fixture-source-2:' || document.file_url)
  )::varchar(64)
FROM public.documents AS document
JOIN public.claims AS claim
  ON claim.id = document.claim_id
JOIN (
  VALUES
    (
      'Allstate',
      'a11a0000-0000-4000-8000-000000000001'::uuid
    ),
    (
      'Andover',
      'a11a0000-0000-4000-8000-000000000002'::uuid
    ),
    (
      'Bay State Insurance Company',
      'a11a0000-0000-4000-8000-000000000002'::uuid
    ),
    (
      'Cambridge Mutual',
      'a11a0000-0000-4000-8000-000000000002'::uuid
    ),
    (
      'Merrimack Mutual',
      'a11a0000-0000-4000-8000-000000000002'::uuid
    )
) AS mapping(carrier_name, organization_id)
  ON mapping.carrier_name = claim.carrier
JOIN storage.objects AS source
  ON source.bucket_id = 'claim-documents'
 AND source.name = document.file_url;

INSERT INTO storage.objects (bucket_id, name, metadata)
SELECT
  'claim-documents',
  destination.destination_path,
  pg_catalog.jsonb_build_object(
    'size',
    destination.object_size,
    'sha256',
    destination.object_sha256,
    'fixtureCopy',
    true
  )
FROM rehearsal_document_destinations AS destination
ON CONFLICT (bucket_id, name) DO NOTHING;

INSERT INTO private.carrier_tenant_storage_manifest (
  source_bucket,
  source_path,
  destination_bucket,
  destination_path,
  disposition,
  document_id,
  organization_id,
  claim_id,
  source_size,
  source_sha256,
  destination_size,
  destination_sha256,
  copied_at,
  verified_at
)
SELECT
  'claim-documents',
  destination.source_path,
  'claim-documents',
  destination.destination_path,
  'referenced',
  destination.document_id,
  destination.organization_id,
  destination.claim_id,
  destination.object_size,
  destination.object_sha256,
  destination.object_size,
  destination.object_sha256,
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp()
FROM rehearsal_document_destinations AS destination
ON CONFLICT (source_bucket, source_path) DO NOTHING;

CREATE TEMP TABLE rehearsal_quarantine_destinations (
  source_path text PRIMARY KEY,
  destination_path text NOT NULL UNIQUE,
  object_size bigint NOT NULL,
  object_sha256 varchar(64) NOT NULL
) ON COMMIT DROP;

INSERT INTO rehearsal_quarantine_destinations (
  source_path,
  destination_path,
  object_size,
  object_sha256
)
SELECT
  source.name,
  'unreferenced/'
    || pg_catalog.md5(source.name)
    || '/'
    || pg_catalog.regexp_replace(source.name, '^.*/', ''),
  (source.metadata ->> 'size')::bigint,
  (
    pg_catalog.md5('fixture-source:' || source.name)
    || pg_catalog.md5('fixture-source-2:' || source.name)
  )::varchar(64)
FROM storage.objects AS source
WHERE source.bucket_id = 'claim-documents'
  AND source.name NOT LIKE 'organizations/%'
  AND NOT EXISTS (
    SELECT 1
    FROM public.documents AS document
    WHERE document.file_url = source.name
  );

INSERT INTO storage.objects (bucket_id, name, metadata)
SELECT
  'carrier-tenant-migration-quarantine',
  destination.destination_path,
  pg_catalog.jsonb_build_object(
    'size',
    destination.object_size,
    'sha256',
    destination.object_sha256,
    'fixtureCopy',
    true
  )
FROM rehearsal_quarantine_destinations AS destination
ON CONFLICT (bucket_id, name) DO NOTHING;

INSERT INTO private.carrier_tenant_storage_manifest (
  source_bucket,
  source_path,
  destination_bucket,
  destination_path,
  disposition,
  source_size,
  source_sha256,
  destination_size,
  destination_sha256,
  copied_at,
  verified_at
)
SELECT
  'claim-documents',
  destination.source_path,
  'carrier-tenant-migration-quarantine',
  destination.destination_path,
  'quarantine',
  destination.object_size,
  destination.object_sha256,
  destination.object_size,
  destination.object_sha256,
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp()
FROM rehearsal_quarantine_destinations AS destination
ON CONFLICT (source_bucket, source_path) DO NOTHING;

INSERT INTO private.carrier_tenant_storage_runs (
  run_key,
  source_bucket,
  referenced_count,
  quarantine_count,
  inventory_count,
  inventory_sha256,
  copy_completed_at
)
SELECT
  'carrier-tenant-cutover-v1',
  'claim-documents',
  (
    SELECT count(*)::integer
    FROM private.carrier_tenant_storage_manifest
    WHERE disposition = 'referenced'
  ),
  (
    SELECT count(*)::integer
    FROM private.carrier_tenant_storage_manifest
    WHERE disposition = 'quarantine'
  ),
  (
    SELECT count(*)::integer
    FROM private.carrier_tenant_storage_manifest
  ),
  (
    pg_catalog.md5(
      pg_catalog.string_agg(
        manifest.source_bucket
          || '/'
          || manifest.source_path
          || ':'
          || manifest.source_sha256,
        ','
        ORDER BY manifest.source_bucket, manifest.source_path
      )
    )
    || pg_catalog.md5(
      'second:'
      || pg_catalog.string_agg(
        manifest.source_bucket
          || '/'
          || manifest.source_path
          || ':'
          || manifest.source_sha256,
        ','
        ORDER BY manifest.source_bucket, manifest.source_path
      )
    )
  )::varchar(64),
  pg_catalog.statement_timestamp()
FROM private.carrier_tenant_storage_manifest AS manifest
ON CONFLICT (run_key)
DO UPDATE SET
  source_bucket = EXCLUDED.source_bucket,
  referenced_count = EXCLUDED.referenced_count,
  quarantine_count = EXCLUDED.quarantine_count,
  inventory_count = EXCLUDED.inventory_count,
  inventory_sha256 = EXCLUDED.inventory_sha256,
  copy_completed_at = EXCLUDED.copy_completed_at,
  updated_at = pg_catalog.statement_timestamp();
