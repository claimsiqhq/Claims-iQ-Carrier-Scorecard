-- Synthetic records exercise every legacy relationship during migration.
INSERT INTO users (id, email, password_hash, role) VALUES
  ('user-admin', 'admin@example.invalid', 'test-only', 'admin'),
  ('user-reviewer', 'reviewer@example.invalid', 'test-only', 'user');

INSERT INTO claims (id, claim_number, insured_name, carrier, status)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  'SYNTH-001',
  'Synthetic Person',
  'Andover',
  'analyzed'
);

INSERT INTO documents (
  id,
  claim_id,
  type,
  file_url,
  extracted_text,
  metadata
)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'claim_file',
  'legacy/synth.pdf',
  '=== PAGE 1 === synthetic',
  '{"contentType":"application/pdf"}'
);

INSERT INTO audits (
  id,
  claim_id,
  overall_score,
  technical_score,
  presentation_score,
  risk_level,
  approval_status
)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  90,
  90,
  90,
  'low',
  'NOT READY'
);

INSERT INTO audit_sections (id, audit_id, section, score)
VALUES (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'DA',
  90
);

INSERT INTO audit_findings (
  id,
  audit_id,
  type,
  severity,
  title,
  source_document_id
)
VALUES (
  '50000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'question',
  'warning',
  'Synthetic finding',
  '20000000-0000-4000-8000-000000000001'
);

INSERT INTO audit_structured (id, audit_id)
VALUES (
  '60000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);

INSERT INTO audit_versions (
  id,
  claim_id,
  audit_id,
  version_number
)
VALUES (
  '70000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  1
);

DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO anon, authenticated;
