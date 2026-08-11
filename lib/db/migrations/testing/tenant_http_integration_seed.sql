-- Post-cutover fixture for the real two-tenant HTTP/RLS integration suite.
-- The test runner replaces the password-hash marker before applying this file.

BEGIN;

SET CONSTRAINTS ALL DEFERRED;

INSERT INTO public.users (
  id,
  email,
  password_hash,
  first_name,
  last_name,
  role,
  platform_role,
  auth_version,
  email_verified_at
)
VALUES
  (
    'integration-allstate-owner',
    'allstate-owner@example.invalid',
    '__TENANT_INTEGRATION_PASSWORD_HASH__',
    'Alice',
    'Allstate',
    'user',
    NULL,
    1,
    pg_catalog.statement_timestamp()
  ),
  (
    'integration-andover-owner',
    'andover-owner@example.invalid',
    '__TENANT_INTEGRATION_PASSWORD_HASH__',
    'Andrew',
    'Andover',
    'user',
    NULL,
    1,
    pg_catalog.statement_timestamp()
  ),
  (
    'integration-platform-admin',
    'platform-admin@example.invalid',
    '__TENANT_INTEGRATION_PASSWORD_HASH__',
    'Pat',
    'Platform',
    'admin',
    'platform_admin',
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
    'b1000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'integration-allstate-owner',
    'owner',
    '[]'::jsonb,
    true
  ),
  (
    'b1000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'integration-andover-owner',
    'owner',
    '[]'::jsonb,
    true
  );

-- The cutover rehearsal intentionally starts with tiny legacy rulesets. Replace
-- them with valid published versions so the real carrier-policy service runs.
UPDATE public.carrier_ruleset_versions
SET status = 'archived'::public.carrier_ruleset_version_state
WHERE carrier_key IN ('allstate', 'andover')
  AND status = 'published'::public.carrier_ruleset_version_state;

UPDATE public.carrier_rulesets
SET
  ruleset = '{
    "version": "tenant-http-integration-v2",
    "da_questions": [{
      "id": "DA-1",
      "text": "Is the desk-adjuster file complete?",
      "weight": 100,
      "section": "documentation",
      "scorecard": "DA",
      "categoryKey": "documentation",
      "categoryName": "Documentation"
    }],
    "fa_questions": [{
      "id": "FA-1",
      "text": "Is the field-adjuster file complete?",
      "weight": 100,
      "section": "documentation",
      "scorecard": "FA",
      "categoryKey": "documentation",
      "categoryName": "Documentation"
    }],
    "scorecard_categories": [{
      "id": "documentation",
      "label": "Documentation",
      "max_score": 100
    }]
  }'::jsonb,
  updated_at = pg_catalog.statement_timestamp()
WHERE organization_id IN (
  'a11a0000-0000-4000-8000-000000000001',
  'a11a0000-0000-4000-8000-000000000002'
);

INSERT INTO public.carrier_ruleset_versions (
  id,
  organization_id,
  carrier_key,
  version_number,
  version_label,
  status,
  display_name,
  ruleset,
  validation,
  change_summary,
  source_references,
  created_by_user_id,
  approved_by_user_id,
  published_at
)
VALUES
  (
    'b1100000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'allstate',
    2,
    'tenant-http-integration-v2',
    'published',
    'Allstate',
    '{
      "version": "tenant-http-integration-v2",
      "da_questions": [{
        "id": "DA-1",
        "text": "Is the desk-adjuster file complete?",
        "weight": 100,
        "section": "documentation",
        "scorecard": "DA",
        "categoryKey": "documentation",
        "categoryName": "Documentation"
      }],
      "fa_questions": [{
        "id": "FA-1",
        "text": "Is the field-adjuster file complete?",
        "weight": 100,
        "section": "documentation",
        "scorecard": "FA",
        "categoryKey": "documentation",
        "categoryName": "Documentation"
      }],
      "scorecard_categories": [{
        "id": "documentation",
        "label": "Documentation",
        "max_score": 100
      }]
    }'::jsonb,
    '{"errors":[],"warnings":[]}'::jsonb,
    'Tenant HTTP integration fixture',
    '[]'::jsonb,
    'integration-allstate-owner',
    'integration-allstate-owner',
    pg_catalog.statement_timestamp()
  ),
  (
    'b1100000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'andover',
    2,
    'tenant-http-integration-v2',
    'published',
    'Andover',
    '{
      "version": "tenant-http-integration-v2",
      "da_questions": [{
        "id": "DA-1",
        "text": "Is the desk-adjuster file complete?",
        "weight": 100,
        "section": "documentation",
        "scorecard": "DA",
        "categoryKey": "documentation",
        "categoryName": "Documentation"
      }],
      "fa_questions": [{
        "id": "FA-1",
        "text": "Is the field-adjuster file complete?",
        "weight": 100,
        "section": "documentation",
        "scorecard": "FA",
        "categoryKey": "documentation",
        "categoryName": "Documentation"
      }],
      "scorecard_categories": [{
        "id": "documentation",
        "label": "Documentation",
        "max_score": 100
      }]
    }'::jsonb,
    '{"errors":[],"warnings":[]}'::jsonb,
    'Tenant HTTP integration fixture',
    '[]'::jsonb,
    'integration-andover-owner',
    'integration-andover-owner',
    pg_catalog.statement_timestamp()
  );

INSERT INTO public.claims (
  id,
  organization_id,
  claim_number,
  insured_name,
  carrier_entity_id,
  carrier,
  job_type,
  date_of_loss,
  status,
  policy_number,
  loss_type,
  property_address,
  adjuster,
  total_claim_amount,
  deductible,
  summary,
  owner_user_id,
  assignee_user_id,
  system_status,
  ai_status,
  human_review_status,
  created_at
)
VALUES
  (
    'b2000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'ALLSTATE-TENANT-SECRET-001',
    'Allstate Integration Secret',
    'e11e0000-0000-4000-8000-000000000001',
    'Allstate',
    'property',
    '2026-01-01',
    'analyzed',
    'ALL-POLICY-SECRET',
    'water',
    '1 Allstate Secret Way',
    'Alice Adjuster',
    '$12500.00',
    '$1000.00',
    'Allstate-only integration fixture',
    'integration-allstate-owner',
    'integration-allstate-owner',
    'ready',
    'succeeded',
    'pending',
    pg_catalog.statement_timestamp() - interval '2 days'
  ),
  (
    'b2000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'ANDOVER-TENANT-SECRET-002',
    'Andover Integration Secret',
    'e11e0000-0000-4000-8000-000000000002',
    'Andover',
    'property',
    '2026-02-02',
    'analyzed',
    'AND-POLICY-SECRET',
    'fire',
    '2 Andover Secret Lane',
    'Andrew Adjuster',
    '$9800.00',
    '$750.00',
    'Andover-only integration fixture',
    'integration-andover-owner',
    'integration-andover-owner',
    'ready',
    'succeeded',
    'pending',
    pg_catalog.statement_timestamp() - interval '1 day'
  );

-- The storage-integrity trigger requires the exact object to pre-exist before
-- document metadata can be registered.
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES
  (
    'claim-documents',
    'organizations/a11a0000-0000-4000-8000-000000000001/claims/b2000000-0000-4000-8000-000000000001/documents/b3000000-0000-4000-8000-000000000001/allstate-secret.pdf',
    '{"size":101,"sha256":"allstate-integration-fixture"}'::jsonb
  ),
  (
    'claim-documents',
    'organizations/a11a0000-0000-4000-8000-000000000002/claims/b2000000-0000-4000-8000-000000000002/documents/b3000000-0000-4000-8000-000000000002/andover-secret.pdf',
    '{"size":102,"sha256":"andover-integration-fixture"}'::jsonb
  )
ON CONFLICT (bucket_id, name) DO NOTHING;

INSERT INTO public.documents (
  id,
  organization_id,
  claim_id,
  uploaded_by_user_id,
  type,
  file_url,
  source_sha256,
  page_count,
  extracted_text,
  metadata
)
VALUES
  (
    'b3000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'integration-allstate-owner',
    'claim_file',
    'organizations/a11a0000-0000-4000-8000-000000000001/claims/b2000000-0000-4000-8000-000000000001/documents/b3000000-0000-4000-8000-000000000001/allstate-secret.pdf',
    pg_catalog.repeat('1', 64),
    1,
    'ALLSTATE DOCUMENT SECRET',
    '{
      "organizationId": "a11a0000-0000-4000-8000-000000000001",
      "claimId": "b2000000-0000-4000-8000-000000000001",
      "documentId": "b3000000-0000-4000-8000-000000000001",
      "storagePath": "organizations/a11a0000-0000-4000-8000-000000000001/claims/b2000000-0000-4000-8000-000000000001/documents/b3000000-0000-4000-8000-000000000001/allstate-secret.pdf",
      "fileName": "allstate-secret.pdf",
      "contentType": "application/pdf",
      "size": 101
    }'::jsonb
  ),
  (
    'b3000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000002',
    'integration-andover-owner',
    'claim_file',
    'organizations/a11a0000-0000-4000-8000-000000000002/claims/b2000000-0000-4000-8000-000000000002/documents/b3000000-0000-4000-8000-000000000002/andover-secret.pdf',
    pg_catalog.repeat('2', 64),
    1,
    'ANDOVER DOCUMENT SECRET',
    '{
      "organizationId": "a11a0000-0000-4000-8000-000000000002",
      "claimId": "b2000000-0000-4000-8000-000000000002",
      "documentId": "b3000000-0000-4000-8000-000000000002",
      "storagePath": "organizations/a11a0000-0000-4000-8000-000000000002/claims/b2000000-0000-4000-8000-000000000002/documents/b3000000-0000-4000-8000-000000000002/andover-secret.pdf",
      "fileName": "andover-secret.pdf",
      "contentType": "application/pdf",
      "size": 102
    }'::jsonb
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
  priority,
  idempotency_key,
  payload,
  attempt_count,
  max_attempts,
  started_at,
  completed_at
)
VALUES
  (
    'b4000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    'integration-allstate-owner',
    'audit',
    'succeeded',
    'completed',
    100,
    100,
    'tenant-http-allstate-complete',
    '{"fixture":"allstate"}'::jsonb,
    1,
    3,
    pg_catalog.statement_timestamp() - interval '2 minutes',
    pg_catalog.statement_timestamp() - interval '1 minute'
  ),
  (
    'b4000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000002',
    'b3000000-0000-4000-8000-000000000002',
    'integration-andover-owner',
    'audit',
    'succeeded',
    'completed',
    100,
    100,
    'tenant-http-andover-complete',
    '{"fixture":"andover"}'::jsonb,
    1,
    3,
    pg_catalog.statement_timestamp() - interval '2 minutes',
    pg_catalog.statement_timestamp() - interval '1 minute'
  ),
  (
    'b4200000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    'integration-allstate-owner',
    'extract',
    'queued',
    'uploaded',
    0,
    1,
    'tenant-http-worker-allstate',
    '{"fixture":"worker-control"}'::jsonb,
    0,
    3,
    NULL,
    NULL
  ),
  (
    'b4200000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000002',
    'b3000000-0000-4000-8000-000000000002',
    'integration-andover-owner',
    'extract',
    'queued',
    'uploaded',
    0,
    2,
    'tenant-http-worker-andover',
    '{"fixture":"worker-control"}'::jsonb,
    0,
    3,
    NULL,
    NULL
  );

INSERT INTO public.processing_job_attempts (
  id,
  organization_id,
  job_id,
  attempt_number,
  worker_id,
  status,
  started_at,
  completed_at
)
VALUES
  (
    'b4100000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'b4000000-0000-4000-8000-000000000001',
    1,
    'fixture-worker-allstate',
    'succeeded',
    pg_catalog.statement_timestamp() - interval '2 minutes',
    pg_catalog.statement_timestamp() - interval '1 minute'
  ),
  (
    'b4100000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'b4000000-0000-4000-8000-000000000002',
    1,
    'fixture-worker-andover',
    'succeeded',
    pg_catalog.statement_timestamp() - interval '2 minutes',
    pg_catalog.statement_timestamp() - interval '1 minute'
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
  fallback_used,
  degraded,
  started_at,
  completed_at
)
VALUES
  (
    'b5000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b4000000-0000-4000-8000-000000000001',
    'integration-allstate-owner',
    'succeeded',
    'tenant-http-integration-v2',
    pg_catalog.repeat('a', 64),
    '{"version":"tenant-http-integration-v2"}'::jsonb,
    'carrier-audit',
    pg_catalog.repeat('b', 64),
    '{"fixture":"allstate"}'::jsonb,
    'transport-stub-not-needed',
    '[{"documentId":"b3000000-0000-4000-8000-000000000001","sha256":"allstate"}]'::jsonb,
    '["allstate-provider-request"]'::jsonb,
    false,
    false,
    pg_catalog.statement_timestamp() - interval '2 minutes',
    pg_catalog.statement_timestamp() - interval '1 minute'
  ),
  (
    'b5000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000002',
    'b4000000-0000-4000-8000-000000000002',
    'integration-andover-owner',
    'succeeded',
    'tenant-http-integration-v2',
    pg_catalog.repeat('c', 64),
    '{"version":"tenant-http-integration-v2"}'::jsonb,
    'carrier-audit',
    pg_catalog.repeat('d', 64),
    '{"fixture":"andover"}'::jsonb,
    'transport-stub-not-needed',
    '[{"documentId":"b3000000-0000-4000-8000-000000000002","sha256":"andover"}]'::jsonb,
    '["andover-provider-request"]'::jsonb,
    false,
    false,
    pg_catalog.statement_timestamp() - interval '2 minutes',
    pg_catalog.statement_timestamp() - interval '1 minute'
  );

INSERT INTO public.audits (
  id,
  organization_id,
  claim_id,
  audit_run_id,
  version_number,
  overall_score,
  technical_score,
  presentation_score,
  risk_level,
  approval_status,
  executive_summary,
  raw_response,
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
  completed_at
)
VALUES
  (
    'b6000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b5000000-0000-4000-8000-000000000001',
    1,
    91,
    92,
    90,
    'LOW',
    'READY',
    'Allstate audit summary secret',
    '{
      "overall_audit": {
        "overall_score_percent": 91,
        "readiness": "READY",
        "technical_risk": "LOW",
        "executive_summary": "Allstate audit summary secret",
        "failed_count": 0,
        "partial_count": 0,
        "passed_count": 2,
        "warning_count": 0,
        "action_required_count": 0
      },
      "desk_adjuster_scorecard": {
        "score_percent": 92,
        "points_awarded": 92,
        "points_possible": 100,
        "denial_letter_applicable": false,
        "categories": []
      },
      "field_adjuster_scorecard": {
        "score_percent": 90,
        "points_awarded": 90,
        "points_possible": 100,
        "categories": []
      },
      "root_issue_groups": [],
      "issues": [],
      "validation_checks": []
    }'::jsonb,
    'tenant-http-integration-v2',
    pg_catalog.repeat('a', 64),
    'carrier-audit',
    pg_catalog.repeat('b', 64),
    'transport-stub-not-needed',
    '[{"documentId":"b3000000-0000-4000-8000-000000000001","sha256":"allstate"}]'::jsonb,
    'integration-allstate-owner',
    'b4000000-0000-4000-8000-000000000001',
    false,
    false,
    pg_catalog.statement_timestamp() - interval '2 minutes',
    pg_catalog.statement_timestamp() - interval '1 minute'
  ),
  (
    'b6000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000002',
    'b5000000-0000-4000-8000-000000000002',
    1,
    73,
    70,
    76,
    'HIGH',
    'REVIEW',
    'Andover audit summary secret',
    '{
      "overall_audit": {
        "overall_score_percent": 73,
        "readiness": "REVIEW",
        "technical_risk": "HIGH",
        "executive_summary": "Andover audit summary secret",
        "failed_count": 1,
        "partial_count": 0,
        "passed_count": 1,
        "warning_count": 1,
        "action_required_count": 1
      },
      "desk_adjuster_scorecard": {
        "score_percent": 70,
        "points_awarded": 70,
        "points_possible": 100,
        "denial_letter_applicable": true,
        "categories": []
      },
      "field_adjuster_scorecard": {
        "score_percent": 76,
        "points_awarded": 76,
        "points_possible": 100,
        "categories": []
      },
      "root_issue_groups": [],
      "issues": [],
      "validation_checks": []
    }'::jsonb,
    'tenant-http-integration-v2',
    pg_catalog.repeat('c', 64),
    'carrier-audit',
    pg_catalog.repeat('d', 64),
    'transport-stub-not-needed',
    '[{"documentId":"b3000000-0000-4000-8000-000000000002","sha256":"andover"}]'::jsonb,
    'integration-andover-owner',
    'b4000000-0000-4000-8000-000000000002',
    false,
    false,
    pg_catalog.statement_timestamp() - interval '2 minutes',
    pg_catalog.statement_timestamp() - interval '1 minute'
  );

INSERT INTO public.audit_sections (
  id,
  organization_id,
  audit_id,
  section,
  score,
  reasoning
)
VALUES
  (
    'b7000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'b6000000-0000-4000-8000-000000000001',
    'DA',
    92,
    'Allstate section secret'
  ),
  (
    'b7000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'b6000000-0000-4000-8000-000000000002',
    'DA',
    70,
    'Andover section secret'
  );

INSERT INTO public.audit_findings (
  id,
  organization_id,
  audit_id,
  type,
  severity,
  title,
  description,
  source_document_id,
  disposition,
  metadata
)
VALUES
  (
    'b8000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'b6000000-0000-4000-8000-000000000001',
    'documentation',
    'warning',
    'Allstate finding secret',
    'Allstate finding description',
    'b3000000-0000-4000-8000-000000000001',
    'open',
    '{"root_issue":"allstate_secret_root","category_key":"documentation"}'::jsonb
  ),
  (
    'b8000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'b6000000-0000-4000-8000-000000000002',
    'documentation',
    'fail',
    'Andover finding secret',
    'Andover finding description',
    'b3000000-0000-4000-8000-000000000002',
    'open',
    '{"root_issue":"andover_secret_root","category_key":"documentation"}'::jsonb
  );

INSERT INTO public.audit_structured (
  id,
  organization_id,
  audit_id,
  deferred_items,
  invoice_adjustments,
  scope_deviations,
  unknowns,
  carrier_questions
)
VALUES
  (
    'b9000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'b6000000-0000-4000-8000-000000000001',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '["Allstate structured secret"]'::jsonb
  ),
  (
    'b9000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'b6000000-0000-4000-8000-000000000002',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '["Andover structured secret"]'::jsonb
  );

INSERT INTO public.audit_versions (
  id,
  organization_id,
  claim_id,
  audit_id,
  audit_run_id,
  version_number
)
VALUES
  (
    'ba000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b6000000-0000-4000-8000-000000000001',
    'b5000000-0000-4000-8000-000000000001',
    1
  ),
  (
    'ba000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000002',
    'b6000000-0000-4000-8000-000000000002',
    'b5000000-0000-4000-8000-000000000002',
    1
  );

UPDATE public.claims
SET current_audit_id = CASE id
  WHEN 'b2000000-0000-4000-8000-000000000001'::uuid
    THEN 'b6000000-0000-4000-8000-000000000001'::uuid
  WHEN 'b2000000-0000-4000-8000-000000000002'::uuid
    THEN 'b6000000-0000-4000-8000-000000000002'::uuid
END
WHERE id IN (
  'b2000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000002'
);

INSERT INTO public.evidence_anchors (
  id,
  organization_id,
  finding_id,
  source_document_id,
  is_mapped,
  page_number,
  raw_location,
  quote,
  anchor_data,
  mapping_method,
  confidence
)
VALUES
  (
    'bb000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'b8000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    true,
    1,
    'page 1',
    'Allstate evidence secret',
    '{"fixture":"allstate"}'::jsonb,
    'fixture',
    0.99
  ),
  (
    'bb000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'b8000000-0000-4000-8000-000000000002',
    'b3000000-0000-4000-8000-000000000002',
    true,
    1,
    'page 1',
    'Andover evidence secret',
    '{"fixture":"andover"}'::jsonb,
    'fixture',
    0.98
  );

INSERT INTO public.claim_activity (
  id,
  organization_id,
  claim_id,
  actor_user_id,
  activity_type,
  metadata
)
VALUES
  (
    'bc000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'integration-allstate-owner',
    'tenant_http_fixture_created',
    '{"tenant":"allstate"}'::jsonb
  ),
  (
    'bc000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000002',
    'integration-andover-owner',
    'tenant_http_fixture_created',
    '{"tenant":"andover"}'::jsonb
  );

INSERT INTO public.organization_invitations (
  id,
  organization_id,
  email,
  role,
  token_hash,
  invited_by_user_id,
  expires_at,
  last_sent_at,
  send_count
)
VALUES
  (
    'bd000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'allstate-invite@example.invalid',
    'reviewer',
    pg_catalog.repeat('1', 64),
    'integration-allstate-owner',
    pg_catalog.statement_timestamp() + interval '1 day',
    pg_catalog.statement_timestamp(),
    1
  ),
  (
    'bd000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'andover-invite@example.invalid',
    'reviewer',
    pg_catalog.repeat('2', 64),
    'integration-andover-owner',
    pg_catalog.statement_timestamp() + interval '1 day',
    pg_catalog.statement_timestamp(),
    1
  );

INSERT INTO public.saved_views (
  id,
  organization_id,
  user_id,
  name,
  resource_type,
  filters,
  sort,
  columns,
  is_default
)
VALUES
  (
    'be000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'integration-allstate-owner',
    'Allstate private view',
    'claims',
    '{"risk":"LOW"}'::jsonb,
    '{"createdAt":"desc"}'::jsonb,
    '["claimNumber","insuredName"]'::jsonb,
    true
  ),
  (
    'be000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'integration-andover-owner',
    'Andover private view',
    'claims',
    '{"risk":"HIGH"}'::jsonb,
    '{"createdAt":"desc"}'::jsonb,
    '["claimNumber","insuredName"]'::jsonb,
    true
  );

INSERT INTO public.organization_settings (
  organization_id,
  in_app_notifications_enabled,
  email_notifications_enabled,
  retention_days,
  purge_mode,
  updated_by_user_id
)
VALUES
  (
    'a11a0000-0000-4000-8000-000000000001',
    true,
    false,
    365,
    'manual',
    'integration-allstate-owner'
  ),
  (
    'a11a0000-0000-4000-8000-000000000002',
    true,
    true,
    730,
    'manual',
    'integration-andover-owner'
  )
ON CONFLICT (organization_id)
DO UPDATE SET
  in_app_notifications_enabled = EXCLUDED.in_app_notifications_enabled,
  email_notifications_enabled = EXCLUDED.email_notifications_enabled,
  retention_days = EXCLUDED.retention_days,
  purge_mode = EXCLUDED.purge_mode,
  updated_by_user_id = EXCLUDED.updated_by_user_id,
  updated_at = pg_catalog.statement_timestamp();

INSERT INTO public.prompt_settings (organization_id, key, value)
VALUES
  (
    'a11a0000-0000-4000-8000-000000000001',
    'tenant_http_integration',
    'Allstate prompt secret'
  ),
  (
    'a11a0000-0000-4000-8000-000000000002',
    'tenant_http_integration',
    'Andover prompt secret'
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
    'bf000000-0000-4000-8000-000000000001',
    'a11a0000-0000-4000-8000-000000000001',
    'integration-allstate-owner',
    'tenant_http_fixture.created',
    'claim',
    'b2000000-0000-4000-8000-000000000001',
    '{"tenant":"allstate"}'::jsonb
  ),
  (
    'bf000000-0000-4000-8000-000000000002',
    'a11a0000-0000-4000-8000-000000000002',
    'integration-andover-owner',
    'tenant_http_fixture.created',
    'claim',
    'b2000000-0000-4000-8000-000000000002',
    '{"tenant":"andover"}'::jsonb
  );

COMMIT;
