-- Focused role and RLS validation. All fixtures and state transitions roll
-- back; run only against an isolated rehearsal database as a privileged user.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL row_security = on;

DO $structural_assertions$
DECLARE
  relation_name text;
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY[
    'claims_iq_identity',
    'claims_iq_tenant_api',
    'claims_iq_worker',
    'claims_iq_platform_admin'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS role_record
      WHERE role_record.rolname = runtime_role
        AND NOT role_record.rolcanlogin
        AND NOT role_record.rolsuper
        AND NOT role_record.rolcreatedb
        AND NOT role_record.rolcreaterole
        AND NOT role_record.rolreplication
        AND NOT role_record.rolbypassrls
    ) THEN
      RAISE EXCEPTION 'Runtime role % is missing or privileged', runtime_role;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      WHERE relation.relowner = (
        SELECT oid
        FROM pg_catalog.pg_roles
        WHERE rolname = runtime_role
      )
    ) THEN
      RAISE EXCEPTION 'Runtime role % owns a relation', runtime_role;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS inherited_membership
      WHERE inherited_membership.member = (
        SELECT oid
        FROM pg_catalog.pg_roles
        WHERE rolname = runtime_role
      )
    ) THEN
      RAISE EXCEPTION 'Runtime role % inherits another role', runtime_role;
    END IF;
  END LOOP;

  FOREACH relation_name IN ARRAY ARRAY[
    'users',
    'sessions',
    'organizations',
    'organization_memberships',
    'organization_invitations',
    'password_reset_tokens',
    'saved_views',
    'organization_audit_events',
    'organization_settings',
    'carrier_entities',
    'carrier_rulesets',
    'carrier_ruleset_versions',
    'claims',
    'documents',
    'processing_jobs',
    'processing_job_attempts',
    'audit_runs',
    'audits',
    'audit_sections',
    'audit_findings',
    'audit_structured',
    'audit_versions',
    'evidence_anchors',
    'claim_activity',
    'prompt_settings',
    'platform_tenant_access_leases',
    'platform_audit_events'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = relation_name
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS/FORCE RLS is missing on public.%', relation_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = relation_name
        AND (
          'public' = ANY (policy.roles)
          OR 'anon' = ANY (policy.roles)
          OR 'authenticated' = ANY (policy.roles)
        )
    ) THEN
      RAISE EXCEPTION 'Data API role policy remains on public.%', relation_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) AS privilege
      WHERE namespace.nspname = 'public'
        AND relation.relname = relation_name
        AND privilege.grantee = 0
    ) THEN
      RAISE EXCEPTION 'PUBLIC retains table privileges on public.%', relation_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'private'
      AND (
        NOT procedure.prosecdef
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS privilege
          WHERE privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        )
        OR NOT EXISTS (
          SELECT 1
          FROM pg_catalog.unnest(procedure.proconfig) AS setting(value)
          WHERE setting.value LIKE 'search_path=%'
            AND setting.value NOT LIKE '%public%'
        )
      )
  ) THEN
    RAISE EXCEPTION 'A private helper lacks SECURITY DEFINER or a safe fixed search_path';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'reject_immutable_audit_mutation',
        'prevent_last_organization_owner_removal',
        'protect_carrier_ruleset_version_history'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(procedure.proconfig) AS setting(value)
        WHERE setting.value LIKE 'search_path=%'
          AND setting.value NOT LIKE '%public%'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Existing trigger helpers still have mutable search paths';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'private'
      AND procedure.proname = 'platform_list_tenant_summaries'
      AND pg_catalog.pg_get_functiondef(procedure.oid) ~* (
        'organization_memberships|carrier_entities|'
        'public\.claims|count[[:space:]]*\('
      )
  ) THEN
    RAISE EXCEPTION 'Platform tenant summaries calculate tenant metrics';
  END IF;

  IF pg_catalog.has_table_privilege(
       'claims_iq_platform_admin',
       'public.claims',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'claims_iq_worker',
       'public.sessions',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'claims_iq_tenant_api',
       'public.password_reset_tokens',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'anon',
       'public.claims',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated',
       'public.claims',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'claims_iq_identity',
       'public.claims',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'claims_iq_identity',
       'public.audits',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'claims_iq_identity',
       'public.documents',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'claims_iq_identity',
       'public.processing_jobs',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'A restricted role retained an unsafe direct table grant';
  END IF;

  IF pg_catalog.to_regclass(
       'public.complete_iq_schema_migrations'
     ) IS NOT NULL
     AND (
       pg_catalog.has_table_privilege(
         'claims_iq_identity',
         'public.complete_iq_schema_migrations',
         'SELECT'
       )
       OR pg_catalog.has_table_privilege(
         'claims_iq_tenant_api',
         'public.complete_iq_schema_migrations',
         'SELECT'
       )
       OR pg_catalog.has_table_privilege(
         'claims_iq_worker',
         'public.complete_iq_schema_migrations',
         'SELECT'
       )
       OR pg_catalog.has_table_privilege(
         'claims_iq_platform_admin',
         'public.complete_iq_schema_migrations',
         'SELECT'
       )
     ) THEN
    RAISE EXCEPTION 'The migration ledger is visible to a runtime role';
  END IF;
END
$structural_assertions$;

INSERT INTO public.organizations (id, name, slug)
VALUES
  (
    '91000000-0000-4000-8000-000000000001',
    'RLS Tenant A',
    'rls-tenant-a'
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    'RLS Tenant B',
    'rls-tenant-b'
  );

INSERT INTO public.users (
  id,
  email,
  password_hash,
  role,
  platform_role,
  auth_version
)
VALUES
  (
    'rls-user-a',
    'rls-user-a@example.invalid',
    'test-only',
    'user',
    NULL,
    1
  ),
  (
    'rls-user-a-peer',
    'rls-user-a-peer@example.invalid',
    'test-only',
    'user',
    NULL,
    1
  ),
  (
    'rls-user-b',
    'rls-user-b@example.invalid',
    'test-only',
    'user',
    NULL,
    1
  ),
  (
    'rls-platform-admin',
    'rls-platform-admin@example.invalid',
    'test-only',
    'user',
    'platform_admin',
    1
  );

INSERT INTO public.organization_memberships (
  organization_id,
  user_id,
  role
)
VALUES
  (
    '91000000-0000-4000-8000-000000000001',
    'rls-user-a',
    'owner'
  ),
  (
    '91000000-0000-4000-8000-000000000001',
    'rls-user-a-peer',
    'member'
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    'rls-user-b',
    'owner'
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
VALUES
  (
    '91500000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'rls-invitee@example.invalid',
    'reviewer',
    pg_catalog.repeat('a', 64),
    'rls-user-a',
    pg_catalog.statement_timestamp() + interval '1 hour'
  ),
  (
    '91500000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    'rls-tenant-b-invitee@example.invalid',
    'reviewer',
    pg_catalog.repeat('b', 64),
    'rls-user-b',
    pg_catalog.statement_timestamp() + interval '1 hour'
  );

INSERT INTO public.saved_views (
  id,
  organization_id,
  user_id,
  name
)
VALUES
  (
    '91600000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'rls-user-a',
    'Tenant A owner view'
  ),
  (
    '91600000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001',
    'rls-user-a-peer',
    'Tenant A peer view'
  ),
  (
    '91600000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000002',
    'rls-user-b',
    'Tenant B owner view'
  );

INSERT INTO public.carrier_rulesets (
  organization_id,
  carrier_key,
  display_name,
  ruleset
)
VALUES
  (
    '91000000-0000-4000-8000-000000000001',
    'rls-carrier-a',
    'RLS Carrier A',
    '{}'::jsonb
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    'rls-carrier-b',
    'RLS Carrier B',
    '{}'::jsonb
  );

INSERT INTO public.carrier_entities (
  id,
  organization_id,
  entity_key,
  display_name,
  is_primary
)
VALUES
  (
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'rls-carrier-a',
    'RLS Carrier A',
    true
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    'rls-carrier-b',
    'RLS Carrier B',
    true
  );

INSERT INTO public.claims (
  id,
  organization_id,
  claim_number,
  insured_name,
  carrier_entity_id,
  owner_user_id
)
VALUES
  (
    '93000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'RLS-A-001',
    'Tenant A Synthetic',
    '92000000-0000-4000-8000-000000000001',
    'rls-user-a'
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    'RLS-B-001',
    'Tenant B Synthetic',
    '92000000-0000-4000-8000-000000000002',
    'rls-user-b'
  );

INSERT INTO public.documents (
  id,
  organization_id,
  claim_id,
  type,
  file_url
)
VALUES
  (
    '94000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    'claim_file',
    '91000000-0000-4000-8000-000000000001/rls-a.pdf'
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000002',
    'claim_file',
    '91000000-0000-4000-8000-000000000002/rls-b.pdf'
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
  priority,
  idempotency_key
)
VALUES
  (
    '95000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001',
    'rls-user-a',
    'audit',
    'queued',
    'uploaded',
    1,
    'rls-job-a'
  ),
  (
    '95000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000002',
    '94000000-0000-4000-8000-000000000002',
    'rls-user-b',
    'audit',
    'queued',
    'uploaded',
    2,
    'rls-job-b'
  );

INSERT INTO public.sessions (
  sid,
  sess,
  expire,
  user_id,
  auth_version
)
VALUES
  (
    'rls-session-a',
    '{}'::jsonb,
    pg_catalog.statement_timestamp() + interval '1 hour',
    'rls-user-a',
    1
  ),
  (
    'rls-session-b',
    '{}'::jsonb,
    pg_catalog.statement_timestamp() + interval '1 hour',
    'rls-user-b',
    1
  ),
  (
    'rls-platform-session',
    '{}'::jsonb,
    pg_catalog.statement_timestamp() + interval '1 hour',
    'rls-platform-admin',
    1
  );

-- The identity role owns credential/session operations but no tenant graph.
SET LOCAL ROLE claims_iq_identity;

DO $identity_assertions$
DECLARE
  blocked boolean;
  invitee_user_id text;
  invitee_membership_id uuid;
  uninvited_user_id text;
  protected_relation text;
  updated_rows integer;
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM public.sessions
    WHERE sid LIKE 'rls-%'
  ) <> 3 THEN
    RAISE EXCEPTION 'Identity role cannot read its session inventory';
  END IF;

  IF (
    SELECT pg_catalog.count(id)
    FROM public.organizations
    WHERE id IN (
      '91000000-0000-4000-8000-000000000001'::uuid,
      '91000000-0000-4000-8000-000000000002'::uuid
    )
  ) <> 2
     OR (
       SELECT pg_catalog.count(*)
       FROM public.organization_memberships
       WHERE user_id = 'rls-user-a'
     ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.organization_invitations
       WHERE id = '91500000-0000-4000-8000-000000000001'
     ) THEN
    RAISE EXCEPTION 'Identity role cannot resolve pre-tenant account context';
  END IF;

  INSERT INTO public.users (
    email,
    password_hash,
    first_name,
    email_verified_at
  )
  VALUES (
    'rls-invitee@example.invalid',
    'test-only',
    'Invitee',
    pg_catalog.statement_timestamp()
  )
  RETURNING id INTO invitee_user_id;

  INSERT INTO public.users (
    email,
    password_hash,
    first_name
  )
  VALUES (
    'rls-uninvited@example.invalid',
    'test-only',
    'Uninvited'
  )
  RETURNING id INTO uninvited_user_id;

  UPDATE public.users
  SET email_verified_at = pg_catalog.statement_timestamp(),
      updated_at = pg_catalog.statement_timestamp()
  WHERE id = invitee_user_id;

  INSERT INTO public.sessions (
    sid,
    sess,
    expire,
    user_id,
    auth_version
  )
  VALUES (
    'rls-identity-created-session',
    '{"user":{"id":"rls-invitee"}}'::jsonb,
    pg_catalog.statement_timestamp() + interval '1 hour',
    invitee_user_id,
    1
  );

  UPDATE public.sessions
  SET sess = sess || '{"checked":true}'::jsonb
  WHERE sid = 'rls-identity-created-session';

  DELETE FROM public.sessions
  WHERE sid = 'rls-identity-created-session';

  INSERT INTO public.password_reset_tokens (
    user_id,
    token_hash,
    requested_by_user_id,
    requested_for_organization_id,
    expires_at,
    auth_version
  )
  VALUES (
    invitee_user_id,
    pg_catalog.repeat('b', 64),
    'rls-user-a',
    '91000000-0000-4000-8000-000000000001',
    pg_catalog.statement_timestamp() + interval '1 hour',
    1
  );

  UPDATE public.password_reset_tokens
  SET revoked_at = pg_catalog.statement_timestamp()
  WHERE token_hash = pg_catalog.repeat('b', 64);

  INSERT INTO public.organization_memberships (
    organization_id,
    user_id,
    role,
    is_default
  )
  VALUES (
    '91000000-0000-4000-8000-000000000001',
    invitee_user_id,
    'reviewer',
    true
  )
  RETURNING id INTO invitee_membership_id;

  UPDATE public.organization_invitations
  SET accepted_by_user_id = invitee_user_id,
      accepted_at = pg_catalog.statement_timestamp(),
      updated_at = pg_catalog.statement_timestamp()
  WHERE id = '91500000-0000-4000-8000-000000000001';

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows <> 1 THEN
    RAISE EXCEPTION 'Identity role could not accept an active invitation';
  END IF;

  INSERT INTO public.organization_audit_events (
    organization_id,
    actor_user_id,
    event_type,
    target_type,
    target_id,
    metadata
  )
  VALUES (
    '91000000-0000-4000-8000-000000000001',
    invitee_user_id,
    'membership.invitation_accepted',
    'organization_membership',
    invitee_membership_id::text,
    pg_catalog.jsonb_build_object(
      'invitationId',
      '91500000-0000-4000-8000-000000000001',
      'role',
      'reviewer'
    )
  );

  INSERT INTO public.organization_audit_events (
    organization_id,
    actor_user_id,
    event_type,
    target_type,
    target_id,
    metadata
  )
  VALUES (
    '91000000-0000-4000-8000-000000000001',
    'rls-user-a',
    'account.password_changed',
    'user',
    'rls-user-a',
    '{}'::jsonb
  );

  blocked := false;
  BEGIN
    INSERT INTO public.organization_memberships (
      organization_id,
      user_id,
      role
    )
    VALUES (
      '91000000-0000-4000-8000-000000000002',
      uninvited_user_id,
      'reviewer'
    );
  EXCEPTION
    WHEN insufficient_privilege THEN blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'Identity role created a membership without an invitation';
  END IF;

  FOREACH protected_relation IN ARRAY ARRAY[
    'claims',
    'audits',
    'audit_runs',
    'organization_audit_events',
    'documents',
    'processing_jobs',
    'processing_job_attempts'
  ]
  LOOP
    blocked := false;
    BEGIN
      EXECUTE pg_catalog.format(
        'SELECT pg_catalog.count(*) FROM public.%I',
        protected_relation
      );
    EXCEPTION
      WHEN insufficient_privilege THEN blocked := true;
    END;

    IF NOT blocked THEN
      RAISE EXCEPTION
        'Identity role can read protected tenant relation public.%',
        protected_relation;
    END IF;
  END LOOP;
END
$identity_assertions$;

RESET ROLE;

-- Tenant A sees A, its peer users, and its carrier profile, but never B.
SET LOCAL ROLE claims_iq_tenant_api;
SELECT pg_catalog.set_config('app.user_id', 'rls-user-a', true);
SELECT pg_catalog.set_config(
  'app.organization_id',
  '91000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config('app.session_id', 'rls-session-a', true);

DO $tenant_a_assertions$
DECLARE
  blocked_claim_update boolean := false;
  blocked_saved_view_update boolean := false;
  blocked_insert boolean := false;
  blocked_identity boolean := false;
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM public.claims
  ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.claims
       WHERE id = '93000000-0000-4000-8000-000000000001'
     )
     OR EXISTS (
       SELECT 1
       FROM public.claims
       WHERE id = '93000000-0000-4000-8000-000000000002'
     ) THEN
    RAISE EXCEPTION 'Tenant A claim isolation failed';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.users
    WHERE id LIKE 'rls-user-a%'
  ) <> 2
     OR EXISTS (
       SELECT 1
       FROM public.users
       WHERE id = 'rls-user-b'
     ) THEN
    RAISE EXCEPTION 'Tenant-scoped user visibility failed';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.organization_memberships
  ) <> 3
     OR EXISTS (
       SELECT 1
       FROM public.organization_memberships
       WHERE organization_id =
         '91000000-0000-4000-8000-000000000002'::uuid
     ) THEN
    RAISE EXCEPTION 'Tenant-scoped membership visibility failed';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.organization_invitations
  ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.organization_invitations
       WHERE id = '91500000-0000-4000-8000-000000000001'
     )
     OR EXISTS (
       SELECT 1
       FROM public.organization_invitations
       WHERE id = '91500000-0000-4000-8000-000000000002'
     ) THEN
    RAISE EXCEPTION 'Tenant-scoped invitation visibility failed';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.saved_views
  ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.saved_views
       WHERE id = '91600000-0000-4000-8000-000000000001'
         AND user_id = 'rls-user-a'
     )
     OR EXISTS (
       SELECT 1
       FROM public.saved_views
       WHERE id IN (
         '91600000-0000-4000-8000-000000000002'::uuid,
         '91600000-0000-4000-8000-000000000003'::uuid
       )
     ) THEN
    RAISE EXCEPTION 'Tenant/user-scoped saved-view visibility failed';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.carrier_entities
  ) <> 1
     OR (
       SELECT organization_id
       FROM public.carrier_entities
       LIMIT 1
     ) <> '91000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'Tenant carrier-profile isolation failed';
  END IF;

  BEGIN
    UPDATE public.claims
    SET
      organization_id = '91000000-0000-4000-8000-000000000002',
      carrier_entity_id = NULL,
      owner_user_id = NULL
    WHERE id = '93000000-0000-4000-8000-000000000001';
  EXCEPTION
    WHEN insufficient_privilege THEN blocked_claim_update := true;
  END;

  IF NOT blocked_claim_update THEN
    RAISE EXCEPTION 'Claim tenant-key UPDATE escaped WITH CHECK';
  END IF;

  BEGIN
    UPDATE public.saved_views
    SET organization_id = '91000000-0000-4000-8000-000000000002'
    WHERE id = '91600000-0000-4000-8000-000000000001';
  EXCEPTION
    WHEN insufficient_privilege THEN blocked_saved_view_update := true;
  END;

  IF NOT blocked_saved_view_update THEN
    RAISE EXCEPTION 'Saved-view tenant-key UPDATE escaped WITH CHECK';
  END IF;

  BEGIN
    INSERT INTO public.claims (
      organization_id,
      claim_number,
      insured_name
    )
    VALUES (
      '91000000-0000-4000-8000-000000000002',
      'RLS-CROSS-INSERT',
      'Blocked'
    );
  EXCEPTION
    WHEN insufficient_privilege THEN blocked_insert := true;
  END;

  IF NOT blocked_insert THEN
    RAISE EXCEPTION 'Cross-tenant INSERT escaped WITH CHECK';
  END IF;

  BEGIN
    PERFORM pg_catalog.count(*) FROM public.sessions;
  EXCEPTION
    WHEN insufficient_privilege THEN blocked_identity := true;
  END;

  IF NOT blocked_identity THEN
    RAISE EXCEPTION 'Tenant role can read identity sessions';
  END IF;
END
$tenant_a_assertions$;

-- Malformed UUID settings fail closed without raising.
SELECT pg_catalog.set_config(
  'app.organization_id',
  'not-a-uuid',
  true
);

DO $malformed_context_assertion$
BEGIN
  IF EXISTS (SELECT 1 FROM public.claims) THEN
    RAISE EXCEPTION 'Malformed tenant context did not fail closed';
  END IF;
END
$malformed_context_assertion$;

RESET ROLE;

-- Tenant B independently sees only B.
SET LOCAL ROLE claims_iq_tenant_api;
SELECT pg_catalog.set_config('app.user_id', 'rls-user-b', true);
SELECT pg_catalog.set_config(
  'app.organization_id',
  '91000000-0000-4000-8000-000000000002',
  true
);
SELECT pg_catalog.set_config('app.session_id', 'rls-session-b', true);

DO $tenant_b_assertions$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM public.claims
  ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.claims
       WHERE id = '93000000-0000-4000-8000-000000000002'
     )
     OR EXISTS (
       SELECT 1
       FROM public.claims
       WHERE id = '93000000-0000-4000-8000-000000000001'
     ) THEN
    RAISE EXCEPTION 'Tenant B claim isolation failed';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.users
    WHERE id IN ('rls-user-a', 'rls-user-a-peer', 'rls-user-b')
  ) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.users WHERE id = 'rls-user-b'
     )
     OR (
       SELECT pg_catalog.count(*)
       FROM public.organization_memberships
     ) <> 1
     OR (
       SELECT pg_catalog.count(*)
       FROM public.organization_invitations
     ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.organization_invitations
       WHERE id = '91500000-0000-4000-8000-000000000002'
     )
     OR (
       SELECT pg_catalog.count(*)
       FROM public.saved_views
     ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.saved_views
       WHERE id = '91600000-0000-4000-8000-000000000003'
         AND user_id = 'rls-user-b'
     ) THEN
    RAISE EXCEPTION
      'Tenant B user/membership/invitation/saved-view isolation failed';
  END IF;
END
$tenant_b_assertions$;

RESET ROLE;

-- Seed an expired lease and a revoked lease. Neither can authorize tenant
-- reads. A very short lease avoids mutating immutable grant terms.
INSERT INTO public.platform_tenant_access_leases (
  id,
  organization_id,
  platform_user_id,
  session_id,
  reason,
  expires_at
)
VALUES (
  '96000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'rls-platform-admin',
  'rls-platform-session',
  'RLS expired lease validation',
  pg_catalog.clock_timestamp() + interval '100 milliseconds'
);

SELECT pg_catalog.pg_sleep(0.2);

INSERT INTO public.platform_tenant_access_leases (
  id,
  organization_id,
  platform_user_id,
  session_id,
  reason,
  expires_at
)
VALUES (
  '96000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000001',
  'rls-platform-admin',
  'rls-platform-session',
  'RLS revoked lease validation',
  pg_catalog.statement_timestamp() + interval '15 minutes'
);

UPDATE public.platform_tenant_access_leases
SET
  revoked_at = pg_catalog.clock_timestamp(),
  revoked_by_user_id = 'rls-platform-admin',
  revocation_reason = 'RLS revoked lease validation'
WHERE id = '96000000-0000-4000-8000-000000000002';

SET LOCAL ROLE claims_iq_tenant_api;
SELECT pg_catalog.set_config('app.user_id', 'rls-platform-admin', true);
SELECT pg_catalog.set_config(
  'app.organization_id',
  '91000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'app.session_id',
  'rls-platform-session',
  true
);

DO $inactive_lease_assertion$
BEGIN
  IF EXISTS (SELECT 1 FROM public.claims)
     OR private.has_tenant_admin_access(
       '91000000-0000-4000-8000-000000000001'
     ) THEN
    RAISE EXCEPTION 'Expired or revoked platform lease authorized a claim read';
  END IF;
END
$inactive_lease_assertion$;

RESET ROLE;

INSERT INTO public.platform_tenant_access_leases (
  id,
  organization_id,
  platform_user_id,
  session_id,
  reason,
  expires_at
)
VALUES (
  '96000000-0000-4000-8000-000000000003',
  '91000000-0000-4000-8000-000000000001',
  'rls-platform-admin',
  'rls-platform-session',
  'RLS valid lease validation',
  pg_catalog.statement_timestamp() + interval '15 minutes'
);

SET LOCAL ROLE claims_iq_tenant_api;
SELECT pg_catalog.set_config('app.user_id', 'rls-platform-admin', true);
SELECT pg_catalog.set_config(
  'app.organization_id',
  '91000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'app.session_id',
  'rls-platform-session',
  true
);

DO $valid_lease_assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM public.claims
  ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.claims
       WHERE id = '93000000-0000-4000-8000-000000000001'
     )
     OR NOT private.has_tenant_admin_access(
       '91000000-0000-4000-8000-000000000001'
     ) THEN
    RAISE EXCEPTION 'Valid session-bound platform lease did not authorize tenant context';
  END IF;
END
$valid_lease_assertion$;

RESET ROLE;

UPDATE public.platform_tenant_access_leases
SET
  revoked_at = pg_catalog.clock_timestamp(),
  revoked_by_user_id = 'rls-platform-admin',
  revocation_reason = 'RLS valid lease revoked'
WHERE id = '96000000-0000-4000-8000-000000000003';

SET LOCAL ROLE claims_iq_tenant_api;
SELECT pg_catalog.set_config('app.user_id', 'rls-platform-admin', true);
SELECT pg_catalog.set_config(
  'app.organization_id',
  '91000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_catalog.set_config(
  'app.session_id',
  'rls-platform-session',
  true
);

DO $revoked_valid_lease_assertion$
BEGIN
  IF EXISTS (SELECT 1 FROM public.claims)
     OR private.has_tenant_admin_access(
       '91000000-0000-4000-8000-000000000001'
     ) THEN
    RAISE EXCEPTION 'A revoked formerly-valid lease still authorized claims';
  END IF;
END
$revoked_valid_lease_assertion$;

RESET ROLE;

-- The platform capability has no direct claim grant. Its summary and
-- create/revoke operations are available only through narrow functions.
SET LOCAL ROLE claims_iq_platform_admin;
SELECT pg_catalog.set_config('app.user_id', 'rls-platform-admin', true);
SELECT pg_catalog.set_config(
  'app.session_id',
  'rls-platform-session',
  true
);
SELECT pg_catalog.set_config('app.organization_id', '', true);

DO $platform_role_assertions$
DECLARE
  blocked boolean := false;
  function_lease_id uuid;
  managed_profile_id uuid;
  managed_entity_id uuid;
  managed_version_id uuid;
BEGIN
  BEGIN
    PERFORM pg_catalog.count(*) FROM public.claims;
  EXCEPTION
    WHEN insufficient_privilege THEN blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'Platform role can directly read claims';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM private.platform_list_tenant_summaries()
    WHERE organization_id IN (
      '91000000-0000-4000-8000-000000000001'::uuid,
      '91000000-0000-4000-8000-000000000002'::uuid
    )
  ) <> 2 THEN
    RAISE EXCEPTION 'Platform tenant summary function failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.platform_list_tenant_summaries() AS summary
    WHERE NOT (
         pg_catalog.to_jsonb(summary) ?& ARRAY[
           'organization_id',
           'organization_name',
           'organization_slug'
         ]
       )
       OR (
         pg_catalog.to_jsonb(summary) - ARRAY[
           'organization_id',
           'organization_name',
           'organization_slug'
         ]
       ) <> '{}'::jsonb
  ) THEN
    RAISE EXCEPTION 'Platform tenant summaries expose tenant metrics';
  END IF;

  function_lease_id := private.platform_create_tenant_access(
    '91000000-0000-4000-8000-000000000002',
    'RLS validation platform function',
    interval '1 hour'
  );

  IF function_lease_id IS NULL
     OR NOT private.platform_revoke_tenant_access(
       function_lease_id,
       'RLS validation platform revocation'
     ) THEN
    RAISE EXCEPTION 'Platform lease functions failed';
  END IF;

  managed_profile_id := private.platform_upsert_carrier_profile(
    '91000000-0000-4000-8000-000000000002',
    'rls-carrier-b',
    'RLS Carrier B',
    '{"managed":true}'::jsonb,
    NULL,
    'rls-carrier-b',
    'RLS Carrier B',
    'RLS Carrier B Legal',
    'RLS validation carrier profile'
  );

  managed_entity_id := private.platform_upsert_carrier_entity(
    '91000000-0000-4000-8000-000000000002',
    NULL,
    'rls-carrier-b-subsidiary',
    'RLS Carrier B Subsidiary',
    NULL,
    false,
    true,
    'RLS validation carrier entity'
  );

  managed_version_id :=
    private.platform_create_carrier_ruleset_version(
      '91000000-0000-4000-8000-000000000002',
      'validation-1',
      'RLS Carrier B',
      NULL,
      '{"managed":true,"version":1}'::jsonb,
      '{"errors":[],"warnings":[]}'::jsonb,
      'RLS validation version',
      '[]'::jsonb,
      'RLS validation carrier version'
    );

  IF managed_profile_id IS NULL
     OR managed_entity_id IS NULL
     OR managed_version_id IS NULL
     OR NOT private.platform_publish_carrier_ruleset_version(
       '91000000-0000-4000-8000-000000000002',
       managed_version_id,
       'RLS validation carrier publication'
     ) THEN
    RAISE EXCEPTION 'Narrow platform carrier management functions failed';
  END IF;
END
$platform_role_assertions$;

RESET ROLE;

DO $platform_audit_assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM public.platform_audit_events
    WHERE actor_user_id = 'rls-platform-admin'
      AND reason IN (
        'RLS validation platform function',
        'RLS validation platform revocation',
        'RLS validation carrier profile',
        'RLS validation carrier entity',
        'RLS validation carrier version',
        'RLS validation carrier publication'
      )
  ) <> 6 THEN
    RAISE EXCEPTION 'Platform function audit trail is incomplete';
  END IF;
END
$platform_audit_assertion$;

-- A worker cannot see any tenant from a bare organization setting. Claiming a
-- job establishes a running lease; the graph remains visible only while the
-- app.worker_id + app.job_id + app.organization_id tuple matches that lease.
SET LOCAL ROLE claims_iq_worker;
SELECT pg_catalog.set_config('app.worker_id', 'rls-worker-a', true);
SELECT pg_catalog.set_config('app.job_id', '', true);
SELECT pg_catalog.set_config(
  'app.organization_id',
  '91000000-0000-4000-8000-000000000002',
  true
);

DO $unleased_worker_assertion$
BEGIN
  IF EXISTS (SELECT 1 FROM public.claims) THEN
    RAISE EXCEPTION 'Worker organization context bypassed job leasing';
  END IF;
END
$unleased_worker_assertion$;

SELECT private.claim_processing_job(60000);

DO $leased_worker_assertions$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM public.processing_jobs
  ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.processing_jobs
       WHERE id = '95000000-0000-4000-8000-000000000001'
         AND status = 'running'
         AND lease_owner = 'rls-worker-a'
     ) THEN
    RAISE EXCEPTION 'Worker did not claim only the expected job';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.claims
  ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.claims
       WHERE id = '93000000-0000-4000-8000-000000000001'
     )
     OR EXISTS (
       SELECT 1
       FROM public.claims
       WHERE id = '93000000-0000-4000-8000-000000000002'
     ) THEN
    RAISE EXCEPTION 'Worker escaped its leased job tenant';
  END IF;

  IF NOT private.heartbeat_processing_job(
    60000,
    'auditing'::public.processing_job_stage,
    50
  ) THEN
    RAISE EXCEPTION 'Context-bound worker heartbeat failed';
  END IF;
END
$leased_worker_assertions$;

SELECT pg_catalog.set_config(
  'app.organization_id',
  '91000000-0000-4000-8000-000000000002',
  true
);

DO $mismatched_worker_context_assertion$
BEGIN
  IF EXISTS (SELECT 1 FROM public.claims) THEN
    RAISE EXCEPTION 'Mismatched worker organization context authorized rows';
  END IF;
END
$mismatched_worker_context_assertion$;

SELECT pg_catalog.set_config(
  'app.organization_id',
  '91000000-0000-4000-8000-000000000001',
  true
);

DO $worker_completion_assertion$
BEGIN
  IF NOT private.complete_processing_job(
    'succeeded'::public.processing_job_state,
    '{"validated":true}'::jsonb
  ) THEN
    RAISE EXCEPTION 'Context-bound worker completion failed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.claims) THEN
    RAISE EXCEPTION 'Completed worker lease retained tenant-row access';
  END IF;
END
$worker_completion_assertion$;

SELECT pg_catalog.set_config('app.worker_id', 'rls-worker-b', true);
SELECT private.claim_processing_job(1000);
SELECT pg_catalog.pg_sleep(1.1);

DO $expired_worker_lease_assertion$
BEGIN
  IF EXISTS (SELECT 1 FROM public.claims) THEN
    RAISE EXCEPTION 'Expired worker lease retained tenant-row access';
  END IF;

  IF private.heartbeat_processing_job(
       60000,
       'auditing'::public.processing_job_stage,
       50
     ) THEN
    RAISE EXCEPTION 'Expired worker lease accepted a heartbeat';
  END IF;

  IF private.complete_processing_job(
       'succeeded'::public.processing_job_state,
       '{"late":true}'::jsonb
     ) THEN
    RAISE EXCEPTION 'Expired worker lease accepted completion';
  END IF;

  IF private.fail_processing_job(
       'late_worker',
       'Expired worker attempted a write',
       '{"late":true}'::jsonb
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Expired worker lease accepted failure handling';
  END IF;
END
$expired_worker_lease_assertion$;

-- Claiming again reaps the expired attempt before issuing a fresh lease.
SELECT private.claim_processing_job(60000);

DO $reclaimed_worker_lease_assertion$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM public.processing_job_attempts
       WHERE job_id = '95000000-0000-4000-8000-000000000002'
         AND attempt_number = 1
         AND worker_id = 'rls-worker-b'
         AND status = 'lease_expired'::public.processing_attempt_state
         AND error_code = 'lease_expired'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.processing_jobs
       WHERE id = '95000000-0000-4000-8000-000000000002'
         AND status = 'running'::public.processing_job_state
         AND attempt_count = 2
         AND lease_owner = 'rls-worker-b'
     ) THEN
    RAISE EXCEPTION 'Expired worker attempt was not safely reaped and reclaimed';
  END IF;
END
$reclaimed_worker_lease_assertion$;

DO $worker_failure_assertion$
BEGIN
  IF private.fail_processing_job(
       'rls_validation_failure',
       'Synthetic worker failure',
       '{"validated":true}'::jsonb
     ) <> 'queued'::public.processing_job_state THEN
    RAISE EXCEPTION 'Context-bound worker failure/requeue failed';
  END IF;
END
$worker_failure_assertion$;

RESET ROLE;

DO $worker_failure_state_assertion$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.processing_jobs AS job
    JOIN public.processing_job_attempts AS attempt
      ON attempt.organization_id = job.organization_id
     AND attempt.job_id = job.id
     AND attempt.attempt_number = job.attempt_count
    WHERE job.id = '95000000-0000-4000-8000-000000000002'
      AND job.status = 'queued'::public.processing_job_state
      AND job.lease_owner IS NULL
      AND attempt.worker_id = 'rls-worker-b'
      AND attempt.status = 'failed'::public.processing_attempt_state
      AND EXISTS (
        SELECT 1
        FROM public.processing_job_attempts AS expired_attempt
        WHERE expired_attempt.organization_id = job.organization_id
          AND expired_attempt.job_id = job.id
          AND expired_attempt.attempt_number = 1
          AND expired_attempt.worker_id = 'rls-worker-b'
          AND expired_attempt.status =
            'lease_expired'::public.processing_attempt_state
          AND expired_attempt.error_code = 'lease_expired'
      )
  ) THEN
    RAISE EXCEPTION 'Worker failure state was not persisted safely';
  END IF;
END
$worker_failure_state_assertion$;

-- Composite tenant foreign keys reject a relationship even for a privileged
-- migration user that bypasses RLS.
DO $cross_tenant_relationship_assertion$
DECLARE
  blocked_carrier boolean := false;
  blocked_document boolean := false;
  blocked_saved_view boolean := false;
  blocked_job_document boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.claims (
      organization_id,
      claim_number,
      insured_name,
      carrier_entity_id
    )
    VALUES (
      '91000000-0000-4000-8000-000000000001',
      'RLS-CROSS-RELATIONSHIP',
      'Blocked',
      '92000000-0000-4000-8000-000000000002'
    );
  EXCEPTION
    WHEN foreign_key_violation THEN blocked_carrier := true;
  END;

  BEGIN
    INSERT INTO public.documents (
      id,
      organization_id,
      claim_id,
      type
    )
    VALUES (
      '94000000-0000-4000-8000-000000000003',
      '91000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000002',
      'claim_file'
    );
  EXCEPTION
    WHEN foreign_key_violation THEN blocked_document := true;
  END;

  BEGIN
    INSERT INTO public.saved_views (
      id,
      organization_id,
      user_id,
      name
    )
    VALUES (
      '91600000-0000-4000-8000-000000000004',
      '91000000-0000-4000-8000-000000000001',
      'rls-user-b',
      'Cross-tenant membership view'
    );
  EXCEPTION
    WHEN foreign_key_violation THEN blocked_saved_view := true;
  END;

  BEGIN
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
      '95000000-0000-4000-8000-000000000003',
      '91000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000002',
      'rls-user-a',
      'audit',
      'rls-cross-tenant-document'
    );
  EXCEPTION
    WHEN foreign_key_violation THEN blocked_job_document := true;
  END;

  IF NOT blocked_carrier
     OR NOT blocked_document
     OR NOT blocked_saved_view
     OR NOT blocked_job_document THEN
    RAISE EXCEPTION
      'One or more cross-tenant composite foreign-key inserts were accepted';
  END IF;
END
$cross_tenant_relationship_assertion$;

ROLLBACK;
