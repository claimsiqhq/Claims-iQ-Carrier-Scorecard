DO $$
DECLARE
  default_org uuid := '00000000-0000-4000-8000-000000000001';
  blocked boolean := false;
  owner_blocked boolean := false;
BEGIN
  IF (
    SELECT count(*)
    FROM organizations
    WHERE id = default_org AND is_default
  ) <> 1 THEN
    RAISE EXCEPTION 'default organization backfill failed';
  END IF;

  IF (
    SELECT count(*)
    FROM organization_memberships
    WHERE organization_id = default_org
  ) <> 2 THEN
    RAISE EXCEPTION 'membership backfill failed';
  END IF;

  IF (
    SELECT role::text
    FROM organization_memberships
    WHERE user_id = 'user-admin'
  ) <> 'owner' THEN
    RAISE EXCEPTION 'admin role backfill failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM claims
    WHERE id = '10000000-0000-4000-8000-000000000001'
      AND organization_id = default_org
      AND current_audit_id = '30000000-0000-4000-8000-000000000001'
      AND system_status = 'ready'
      AND ai_status = 'succeeded'
  ) THEN
    RAISE EXCEPTION 'claim workflow/audit backfill failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM audit_runs
    WHERE id = '30000000-0000-4000-8000-000000000001'
      AND organization_id = default_org
      AND status = 'succeeded'
      AND ruleset_version = 'legacy'
  ) THEN
    RAISE EXCEPTION 'legacy audit provenance backfill failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM audits
    WHERE id = '30000000-0000-4000-8000-000000000001'
      AND approval_status = 'NOT_READY'
      AND risk_level = 'LOW'
  ) THEN
    RAISE EXCEPTION 'legacy audit label canonicalization failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM audit_findings
    WHERE id = '50000000-0000-4000-8000-000000000001'
      AND organization_id = default_org
      AND source_document_id = '20000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'finding tenancy/source backfill failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN (
        'claims',
        'documents',
        'audits',
        'audit_findings',
        'carrier_ruleset_versions',
        'organizations',
        'organization_audit_events',
        'organization_invitations',
        'organization_settings',
        'password_reset_tokens',
        'prompt_settings',
        'processing_jobs'
      )
      AND relrowsecurity = false
  ) THEN
    RAISE EXCEPTION 'RLS was not enabled on all critical tables';
  END IF;

  IF has_table_privilege('anon', 'public.claims', 'SELECT')
     OR has_table_privilege('authenticated', 'public.claims', 'SELECT')
     OR has_table_privilege('anon', 'public.prompt_settings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.prompt_settings', 'SELECT')
     OR has_table_privilege('anon', 'public.organization_invitations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.organization_invitations', 'SELECT')
     OR has_table_privilege('anon', 'public.password_reset_tokens', 'SELECT')
     OR has_table_privilege('authenticated', 'public.password_reset_tokens', 'SELECT') THEN
    RAISE EXCEPTION 'Data API privileges were not revoked';
  END IF;

  IF to_regclass('public.uq_users_email_normalized') IS NULL
     OR to_regclass('public.idx_sessions_user_id') IS NULL
     OR to_regclass('public.uq_organization_invitations_pending_email') IS NULL
     OR to_regclass('public.uq_password_reset_tokens_active_user') IS NULL THEN
    RAISE EXCEPTION 'secure account administration indexes are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM users
    WHERE email IS NOT NULL
      AND email IS DISTINCT FROM lower(btrim(email))
  ) THEN
    RAISE EXCEPTION 'user email normalization failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'auth_version'
      AND is_nullable = 'NO'
  ) OR EXISTS (
    SELECT 1
    FROM sessions
    WHERE user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'credential versioning/session ownership migration failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM prompt_settings
    WHERE organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'prompt settings organization backfill failed';
  END IF;

  IF (
    SELECT count(*)
    FROM organization_settings
    WHERE organization_id = default_org
  ) <> 1 THEN
    RAISE EXCEPTION 'organization settings backfill failed';
  END IF;

  BEGIN
    UPDATE audits
    SET overall_score = 1
    WHERE id = '30000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN sqlstate '55000' THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'append-only audit trigger did not reject update';
  END IF;

  BEGIN
    UPDATE organization_memberships
    SET role = 'admin'
    WHERE organization_id = default_org
      AND user_id = 'user-admin';
  EXCEPTION WHEN check_violation THEN
    owner_blocked := true;
  END;

  IF NOT owner_blocked THEN
    RAISE EXCEPTION 'last organization owner guard did not reject demotion';
  END IF;
END
$$;
