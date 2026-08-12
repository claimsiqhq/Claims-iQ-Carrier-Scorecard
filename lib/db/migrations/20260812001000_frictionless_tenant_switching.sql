-- Frictionless RBAC tenant switching.
--
-- 1. Ordinary users may now belong to multiple carrier organizations; a
--    membership row (with its role) is the unit of role-based tenant access.
--    Postgres RLS (private.has_tenant_access) already authorizes any
--    organization the user is a member of, so removing the single-membership
--    triggers does not weaken tenant isolation.
-- 2. Users remember their last active organization across logins so sign-in
--    lands directly in the right tenant workspace.

DROP TRIGGER IF EXISTS trg_single_carrier_tenant_membership
  ON public.organization_memberships;
DROP FUNCTION IF EXISTS public.enforce_single_carrier_tenant_membership();

-- The demotion guard existed only to preserve the single-membership
-- invariant for non-platform users; it is moot now.
DROP TRIGGER IF EXISTS trg_platform_role_membership_limit
  ON public.users;
DROP FUNCTION IF EXISTS public.enforce_platform_role_membership_limit();

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_active_organization_id uuid
    REFERENCES public.organizations (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_last_active_organization
  ON public.users (last_active_organization_id)
  WHERE last_active_organization_id IS NOT NULL;

-- The identity plane records the last active tenant during login and tenant
-- switching. claims_iq_identity already holds SELECT on all user columns.
GRANT UPDATE (last_active_organization_id)
  ON public.users TO claims_iq_identity;
