-- Intake reserves a queued job before creating its claim and document, then
-- attaches those records to the job in the same transaction. Keep all other
-- processing-job columns restricted to the existing tenant update allowlist.

BEGIN;

GRANT UPDATE (claim_id, document_id)
  ON TABLE public.processing_jobs
  TO claims_iq_tenant_api;

COMMIT;
