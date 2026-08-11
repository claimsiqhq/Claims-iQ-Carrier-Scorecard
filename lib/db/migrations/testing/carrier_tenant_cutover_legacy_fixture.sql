-- Realistic two-parent-carrier legacy inventory for the isolated cutover
-- rehearsal. Apply after the foundation/RLS migrations and Storage test
-- support, but before the carrier tenant Storage and data-cutover migrations.

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
    'user-platform-two',
    'platform-two@example.invalid',
    'test-only',
    'admin',
    1,
    pg_catalog.statement_timestamp()
  ),
  (
    'user-tenant-admin',
    'tenant-admin@example.invalid',
    'test-only',
    'user',
    1,
    pg_catalog.statement_timestamp()
  );

INSERT INTO public.organization_memberships (
  id,
  organization_id,
  user_id,
  role,
  permissions,
  is_default
)
VALUES
  (
    '81000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'user-platform-two',
    'owner',
    '[]'::jsonb,
    true
  ),
  (
    '81000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'user-tenant-admin',
    'admin',
    '["email:ingest"]'::jsonb,
    true
  );

UPDATE public.claims
SET
  owner_user_id = 'user-tenant-admin',
  assignee_user_id = 'user-reviewer'
WHERE id = '10000000-0000-4000-8000-000000000001';

INSERT INTO public.carrier_rulesets (
  id,
  carrier_key,
  display_name,
  active,
  ruleset
)
VALUES
  (
    '91000000-0000-4000-8000-000000000001',
    'allstate',
    'Allstate',
    true,
    '{"version":"1.0","questions":[]}'::jsonb
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    'andover',
    'Andover',
    true,
    '{"version":"1.0","questions":[]}'::jsonb
  ),
  (
    '91000000-0000-4000-8000-000000000003',
    'wawanesa',
    'Wawanesa',
    true,
    '{"version":"1.0","questions":[]}'::jsonb
  );

INSERT INTO public.carrier_ruleset_versions (
  id,
  carrier_key,
  version_number,
  version_label,
  status,
  display_name,
  ruleset,
  validation,
  source_references,
  published_at
)
VALUES
  (
    '92000000-0000-4000-8000-000000000001',
    'allstate',
    1,
    '1.0',
    'published',
    'Allstate',
    '{"version":"1.0","questions":[]}'::jsonb,
    '{"errors":[],"warnings":[]}'::jsonb,
    '[]'::jsonb,
    pg_catalog.statement_timestamp()
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    'andover',
    1,
    '1.0',
    'published',
    'Andover',
    '{"version":"1.0","questions":[]}'::jsonb,
    '{"errors":[],"warnings":[]}'::jsonb,
    '[]'::jsonb,
    pg_catalog.statement_timestamp()
  ),
  (
    '92000000-0000-4000-8000-000000000003',
    'wawanesa',
    1,
    '1.0',
    'published',
    'Wawanesa',
    '{"version":"1.0","questions":[]}'::jsonb,
    '{"errors":[],"warnings":[]}'::jsonb,
    '[]'::jsonb,
    pg_catalog.statement_timestamp()
  );

INSERT INTO public.claims (
  id,
  organization_id,
  claim_number,
  insured_name,
  carrier,
  status,
  owner_user_id,
  assignee_user_id
)
VALUES
  (
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'ALLSTATE-001',
    'Allstate Synthetic',
    'Allstate',
    'analyzed',
    'user-reviewer',
    'user-tenant-admin'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    'BAYSTATE-001',
    'Bay State Synthetic',
    'Bay State Insurance Company',
    'pending',
    'user-tenant-admin',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000001',
    'CAMBRIDGE-001',
    'Cambridge Synthetic',
    'Cambridge Mutual',
    'pending',
    'user-reviewer',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000001',
    'MERRIMACK-001',
    'Merrimack Synthetic',
    'Merrimack Mutual',
    'pending',
    'user-tenant-admin',
    NULL
  );

INSERT INTO public.documents (
  id,
  organization_id,
  claim_id,
  uploaded_by_user_id,
  type,
  file_url,
  extracted_text,
  metadata
)
VALUES
  (
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'user-admin',
    'claim_file',
    'legacy/allstate-loss.pdf',
    'allstate fixture',
    '{"contentType":"application/pdf"}'::jsonb
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'user-tenant-admin',
    'claim_file',
    'legacy/bay-state-loss.pdf',
    'bay state fixture',
    '{"contentType":"application/pdf"}'::jsonb
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    'user-reviewer',
    'claim_file',
    'legacy/cambridge-loss.pdf',
    'cambridge fixture',
    '{"contentType":"application/pdf"}'::jsonb
  ),
  (
    '20000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000005',
    'user-tenant-admin',
    'claim_file',
    'legacy/merrimack-loss.pdf',
    'merrimack fixture',
    '{"contentType":"application/pdf"}'::jsonb
  );

INSERT INTO public.processing_jobs (
  id,
  organization_id,
  claim_id,
  document_id,
  requested_by_user_id,
  type,
  status,
  stage,
  progress,
  idempotency_key,
  attempt_count,
  completed_at
)
VALUES (
  '93000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002',
  'user-admin',
  'audit',
  'succeeded',
  'completed',
  100,
  'cutover-fixture-allstate-audit',
  1,
  pg_catalog.statement_timestamp()
);

INSERT INTO public.processing_job_attempts (
  id,
  organization_id,
  job_id,
  attempt_number,
  worker_id,
  status,
  completed_at
)
VALUES (
  '94000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001',
  1,
  'fixture-worker',
  'succeeded',
  pg_catalog.statement_timestamp()
);

INSERT INTO public.audit_runs (
  id,
  organization_id,
  claim_id,
  processing_job_id,
  actor_user_id,
  status,
  ruleset_version,
  ruleset_hash,
  ruleset_snapshot,
  prompt_identifier,
  prompt_hash,
  prompt_snapshot,
  model_identifier,
  source_document_hashes,
  provider_request_ids,
  started_at,
  completed_at
)
VALUES (
  '95000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '93000000-0000-4000-8000-000000000001',
  'user-admin',
  'succeeded',
  '1.0',
  pg_catalog.repeat('a', 64),
  '{"version":"1.0"}'::jsonb,
  'carrier-audit',
  pg_catalog.repeat('b', 64),
  '{"prompt":"fixture"}'::jsonb,
  'fixture-model',
  '["fixture-document-hash"]'::jsonb,
  '["fixture-provider-request"]'::jsonb,
  pg_catalog.statement_timestamp() - interval '1 minute',
  pg_catalog.statement_timestamp()
);

INSERT INTO public.audits (
  id,
  organization_id,
  claim_id,
  audit_run_id,
  version_number,
  ruleset_version,
  ruleset_hash,
  prompt_identifier,
  prompt_hash,
  model_identifier,
  source_document_hashes,
  actor_user_id,
  processing_job_id,
  fallback_used,
  degraded,
  started_at,
  completed_at,
  overall_score,
  technical_score,
  presentation_score,
  risk_level,
  approval_status
)
VALUES (
  '96000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000001',
  1,
  '1.0',
  pg_catalog.repeat('a', 64),
  'carrier-audit',
  pg_catalog.repeat('b', 64),
  'fixture-model',
  '["fixture-document-hash"]'::jsonb,
  'user-admin',
  '93000000-0000-4000-8000-000000000001',
  false,
  false,
  pg_catalog.statement_timestamp() - interval '1 minute',
  pg_catalog.statement_timestamp(),
  91,
  92,
  90,
  'LOW',
  'READY'
);

INSERT INTO public.audit_sections (
  id,
  organization_id,
  audit_id,
  section,
  score
)
VALUES (
  '97000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  'DA',
  91
);

INSERT INTO public.audit_findings (
  id,
  organization_id,
  audit_id,
  type,
  severity,
  title,
  source_document_id
)
VALUES (
  '98000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  'question',
  'warning',
  'Allstate fixture finding',
  '20000000-0000-4000-8000-000000000002'
);

INSERT INTO public.audit_structured (
  id,
  organization_id,
  audit_id
)
VALUES (
  '99000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001'
);

INSERT INTO public.audit_versions (
  id,
  organization_id,
  claim_id,
  audit_id,
  audit_run_id,
  version_number
)
VALUES (
  '9a000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '96000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',
  1
);

UPDATE public.claims
SET current_audit_id =
  '96000000-0000-4000-8000-000000000001'
WHERE id = '10000000-0000-4000-8000-000000000002';

INSERT INTO public.evidence_anchors (
  id,
  organization_id,
  finding_id,
  source_document_id,
  is_mapped,
  page_number,
  mapping_method
)
VALUES (
  '9b000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  true,
  1,
  'fixture'
);

INSERT INTO public.claim_activity (
  id,
  organization_id,
  claim_id,
  actor_user_id,
  activity_type,
  metadata
)
VALUES (
  '9c000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'user-admin',
  'fixture.created',
  '{"source":"cutover-rehearsal"}'::jsonb
);

INSERT INTO public.saved_views (
  id,
  organization_id,
  user_id,
  name
)
VALUES
  (
    '9d000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'user-admin',
    'Platform legacy view'
  ),
  (
    '9d000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'user-reviewer',
    'Andover review queue'
  );

INSERT INTO public.prompt_settings (
  id,
  organization_id,
  key,
  value
)
VALUES (
  '9e000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'carrier-audit',
  'fixture prompt'
);

INSERT INTO public.organization_audit_events (
  id,
  organization_id,
  actor_user_id,
  event_type,
  target_type,
  target_id,
  metadata
)
VALUES
  (
    '9f000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'user-admin',
    'claim.fixture_created',
    'claim',
    '10000000-0000-4000-8000-000000000002',
    '{"fixture":true}'::jsonb
  ),
  (
    '9f000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'user-tenant-admin',
    'settings.fixture_updated',
    'organization_settings',
    '00000000-0000-4000-8000-000000000001',
    '{"fixture":true}'::jsonb
  );

INSERT INTO public.organization_invitations (
  id,
  organization_id,
  email,
  role,
  token_hash,
  invited_by_user_id,
  expires_at
)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'future-member@example.invalid',
  'member',
  pg_catalog.repeat('c', 64),
  'user-tenant-admin',
  pg_catalog.statement_timestamp() + interval '1 day'
);

INSERT INTO public.password_reset_tokens (
  id,
  user_id,
  token_hash,
  requested_by_user_id,
  requested_for_organization_id,
  expires_at,
  revoked_at,
  auth_version
)
VALUES (
  'a1000000-0000-4000-8000-000000000001',
  'user-reviewer',
  pg_catalog.repeat('d', 64),
  'user-tenant-admin',
  '00000000-0000-4000-8000-000000000001',
  pg_catalog.statement_timestamp() + interval '1 day',
  pg_catalog.statement_timestamp(),
  1
);

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit
)
VALUES (
  'claim-documents',
  'claim-documents',
  false,
  104857600
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES
  (
    'claim-documents',
    'legacy/synth.pdf',
    '{"size":101}'::jsonb
  ),
  (
    'claim-documents',
    'legacy/allstate-loss.pdf',
    '{"size":102}'::jsonb
  ),
  (
    'claim-documents',
    'legacy/bay-state-loss.pdf',
    '{"size":103}'::jsonb
  ),
  (
    'claim-documents',
    'legacy/cambridge-loss.pdf',
    '{"size":104}'::jsonb
  ),
  (
    'claim-documents',
    'legacy/merrimack-loss.pdf',
    '{"size":105}'::jsonb
  ),
  (
    'claim-documents',
    'legacy/orphan-1.bin',
    '{"size":11}'::jsonb
  ),
  (
    'claim-documents',
    'legacy/orphan-2.bin',
    '{"size":12}'::jsonb
  ),
  (
    'claim-documents',
    'legacy/orphan-3.bin',
    '{"size":13}'::jsonb
  ),
  (
    'claim-documents',
    'legacy/orphan-4.bin',
    '{"size":14}'::jsonb
  );
