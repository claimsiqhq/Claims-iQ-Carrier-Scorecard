-- A worker restart can exhaust a job lease outside the worker that owned the
-- claim. Keep claim workflow state aligned when the lease reaper makes that
-- job terminal.

BEGIN;

CREATE OR REPLACE FUNCTION private.reconcile_expired_job_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.type = 'rendition'::public.processing_job_type
     OR NEW.claim_id IS NULL
     OR NEW.status <> 'failed'::public.processing_job_state
     OR NEW.error_code <> 'lease_expired'
     OR NEW.attempt_count < NEW.max_attempts
     OR (
       OLD.status = NEW.status
       AND OLD.error_code IS NOT DISTINCT FROM NEW.error_code
     ) THEN
    RETURN NEW;
  END IF;

  UPDATE public.claims AS claim
  SET
    status = CASE
      WHEN claim.current_audit_id IS NULL THEN 'error'
      ELSE 'analyzed'
    END,
    system_status = CASE
      WHEN claim.current_audit_id IS NULL
        THEN 'error'::public.system_workflow_state
      ELSE 'ready'::public.system_workflow_state
    END,
    ai_status = 'failed'::public.ai_workflow_state,
    updated_at = pg_catalog.clock_timestamp()
  WHERE claim.id = NEW.claim_id
    AND claim.organization_id = NEW.organization_id
    AND claim.status <> 'archived'
    AND claim.system_status <> 'archived'::public.system_workflow_state;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.reconcile_expired_job_claim()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_reconcile_expired_job_claim
  ON public.processing_jobs;

CREATE TRIGGER trg_reconcile_expired_job_claim
AFTER UPDATE OF status, error_code
ON public.processing_jobs
FOR EACH ROW
EXECUTE FUNCTION private.reconcile_expired_job_claim();

COMMIT;
