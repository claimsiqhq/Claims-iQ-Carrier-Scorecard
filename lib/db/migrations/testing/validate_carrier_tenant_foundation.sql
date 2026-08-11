BEGIN;

DO $$
DECLARE
  org_a uuid := '81000000-0000-4000-8000-000000000001';
  org_b uuid := '81000000-0000-4000-8000-000000000002';
  entity_a uuid := '82000000-0000-4000-8000-000000000001';
  entity_b uuid := '82000000-0000-4000-8000-000000000002';
  claim_a uuid := '83000000-0000-4000-8000-000000000001';
  membership_a uuid := '84000000-0000-4000-8000-000000000001';
  lease_id uuid := '85000000-0000-4000-8000-000000000001';
  non_platform_user varchar := 'tenant-foundation-user';
  platform_user varchar := 'tenant-foundation-platform-admin';
  blocked boolean;
BEGIN
  IF to_regclass('public.carrier_entities') IS NULL
     OR to_regclass('public.platform_tenant_access_leases') IS NULL
     OR to_regclass('public.platform_audit_events') IS NULL THEN
    RAISE EXCEPTION 'Carrier tenant foundation tables are missing';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conname LIKE 'fk_%_tenant'
      AND convalidated = false
  ) < 28 THEN
    RAISE EXCEPTION 'Expected NOT VALID same-tenant foreign keys are missing';
  END IF;

  INSERT INTO public.organizations (id, name, slug)
  VALUES
    (org_a, 'Tenant Foundation A', 'tenant-foundation-a'),
    (org_b, 'Tenant Foundation B', 'tenant-foundation-b');

  INSERT INTO public.users (
    id,
    email,
    password_hash,
    role,
    platform_role
  )
  VALUES
    (
      non_platform_user,
      'tenant-foundation-user@example.invalid',
      'test-only',
      'user',
      NULL
    ),
    (
      platform_user,
      'tenant-foundation-platform@example.invalid',
      'test-only',
      'user',
      'platform_admin'
    );

  INSERT INTO public.carrier_rulesets (
    organization_id,
    carrier_key,
    display_name,
    ruleset
  )
  VALUES
    (org_a, 'foundation-a', 'Foundation A', '{}'::jsonb),
    (org_b, 'foundation-b', 'Foundation B', '{}'::jsonb);

  blocked := false;
  BEGIN
    INSERT INTO public.carrier_rulesets (
      organization_id,
      carrier_key,
      display_name,
      ruleset
    )
    VALUES (org_a, 'foundation-a-duplicate', 'Duplicate', '{}'::jsonb);
  EXCEPTION
    WHEN unique_violation THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'One carrier profile per organization was not enforced';
  END IF;

  INSERT INTO public.carrier_entities (
    id,
    organization_id,
    entity_key,
    display_name,
    is_primary
  )
  VALUES
    (entity_a, org_a, 'foundation-a', 'Foundation A', true),
    (entity_b, org_b, 'foundation-b', 'Foundation B', true);

  blocked := false;
  BEGIN
    INSERT INTO public.carrier_entities (
      organization_id,
      entity_key,
      display_name,
      is_primary
    )
    VALUES (org_a, 'foundation-a-subsidiary', 'Duplicate Primary', true);
  EXCEPTION
    WHEN unique_violation THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'One primary carrier entity per organization was not enforced';
  END IF;

  blocked := false;
  BEGIN
    UPDATE public.carrier_entities
    SET is_primary = false
    WHERE id = entity_a;

    SET CONSTRAINTS trg_carrier_entities_profile_bundle IMMEDIATE;
  EXCEPTION
    WHEN check_violation THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'Configured tenant was allowed to lose its primary entity';
  END IF;

  INSERT INTO public.organization_memberships (
    id,
    organization_id,
    user_id,
    role
  )
  VALUES (membership_a, org_a, non_platform_user, 'member');

  blocked := false;
  BEGIN
    INSERT INTO public.organization_memberships (
      organization_id,
      user_id,
      role
    )
    VALUES (org_b, non_platform_user, 'member');
  EXCEPTION
    WHEN check_violation THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'Non-platform multi-tenant membership was not rejected';
  END IF;

  INSERT INTO public.organization_memberships (
    organization_id,
    user_id,
    role
  )
  VALUES
    (org_a, platform_user, 'member'),
    (org_b, platform_user, 'member');

  blocked := false;
  BEGIN
    INSERT INTO public.claims (
      organization_id,
      claim_number,
      insured_name,
      carrier_entity_id,
      carrier
    )
    VALUES (
      org_a,
      'TENANT-FOUNDATION-CROSS',
      'Synthetic',
      entity_b,
      'Source Snapshot'
    );
  EXCEPTION
    WHEN foreign_key_violation THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'Cross-tenant carrier entity reference was not rejected';
  END IF;

  INSERT INTO public.claims (
    id,
    organization_id,
    claim_number,
    insured_name,
    carrier_entity_id,
    carrier,
    assignee_user_id
  )
  VALUES (
    claim_a,
    org_a,
    'TENANT-FOUNDATION-VALID',
    'Synthetic',
    entity_a,
    'Historical Foundation A',
    platform_user
  );

  INSERT INTO public.claim_activity (
    organization_id,
    claim_id,
    actor_user_id,
    activity_type
  )
  VALUES (org_a, claim_a, platform_user, 'foundation_test');

  INSERT INTO public.sessions (
    sid,
    sess,
    expire,
    user_id,
    auth_version
  )
  VALUES (
    'tenant-foundation-session',
    '{}'::jsonb,
    now() + interval '1 hour',
    platform_user,
    1
  );

  INSERT INTO public.platform_tenant_access_leases (
    id,
    organization_id,
    platform_user_id,
    session_id,
    reason,
    expires_at
  )
  VALUES (
    lease_id,
    org_a,
    platform_user,
    'tenant-foundation-session',
    'Validate tenant access isolation',
    now() + interval '15 minutes'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.platform_audit_events
    WHERE access_lease_id = lease_id
      AND event_type = 'tenant_access_granted'
      AND actor_user_id = platform_user
  ) THEN
    RAISE EXCEPTION 'Platform lease grant audit event was not written';
  END IF;

  UPDATE public.platform_tenant_access_leases
  SET
    revoked_at = now(),
    revoked_by_user_id = platform_user,
    revocation_reason = 'Validation complete'
  WHERE id = lease_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.platform_audit_events
    WHERE access_lease_id = lease_id
      AND event_type = 'tenant_access_revoked'
      AND actor_user_id = platform_user
  ) THEN
    RAISE EXCEPTION 'Platform lease revocation audit event was not written';
  END IF;

  blocked := false;
  BEGIN
    UPDATE public.platform_audit_events
    SET reason = 'Mutated'
    WHERE access_lease_id = lease_id;
  EXCEPTION
    WHEN sqlstate '55000' THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'Platform audit immutability was not enforced';
  END IF;

  DELETE FROM public.sessions
  WHERE sid = 'tenant-foundation-session';

  IF EXISTS (
    SELECT 1
    FROM public.platform_tenant_access_leases
    WHERE id = lease_id
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.platform_audit_events
    WHERE access_lease_id = lease_id
      AND event_type = 'tenant_access_session_ended'
  ) THEN
    RAISE EXCEPTION 'Session-bound lease cleanup was not audited';
  END IF;

  DELETE FROM public.organization_memberships
  WHERE organization_id = org_a
    AND user_id = platform_user;

  IF (
    SELECT assignee_user_id
    FROM public.claims
    WHERE id = claim_a
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Membership removal did not clear the active claim assignment';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.claim_activity
    WHERE claim_id = claim_a
      AND actor_user_id = platform_user
  ) THEN
    RAISE EXCEPTION 'Membership removal erased historical actor provenance';
  END IF;
END
$$;

ROLLBACK;
