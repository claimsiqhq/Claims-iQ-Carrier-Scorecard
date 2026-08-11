-- Restricted database roles and row-level tenant isolation.
--
-- Runtime credentials are intentionally not created here. Provision a
-- NOINHERIT LOGIN role per deployed service with a managed SCRAM secret, then
-- grant exactly one capability role below (or both claims_iq_platform_admin
-- and claims_iq_tenant_api to a NOINHERIT platform login that explicitly
-- SET ROLEs into the tenant plane only while a valid lease is active).
-- Passwords belong in the deployment secret manager, never in migrations.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

DO $roles$
DECLARE
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
      FROM pg_catalog.pg_roles
      WHERE rolname = runtime_role
    ) THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',
        runtime_role
      );
    END IF;

    EXECUTE format(
      'ALTER ROLE %I WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',
      runtime_role
    );
  END LOOP;
END
$roles$;

COMMENT ON ROLE claims_iq_identity IS
  'NOLOGIN capability for account, credential, session, and password-token operations. Grant to a separately provisioned NOINHERIT login.';
COMMENT ON ROLE claims_iq_tenant_api IS
  'NOLOGIN tenant data capability. The server must set app.user_id, app.organization_id, and app.session_id on every checked-out connection/transaction and clear them before pooling.';
COMMENT ON ROLE claims_iq_worker IS
  'NOLOGIN worker capability. Claim work only through private.claim_processing_job, then set app.worker_id, app.job_id, and app.organization_id on every checked-out leased-job connection/transaction and clear them before pooling.';
COMMENT ON ROLE claims_iq_platform_admin IS
  'NOLOGIN platform-plane capability. Tenant summaries and access leases are exposed only through audited private functions; tenant data requires an explicit SET ROLE claims_iq_tenant_api and a valid lease.';

CREATE OR REPLACE FUNCTION private.context_text(
  setting_name text,
  maximum_length integer
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  context_value text;
BEGIN
  IF setting_name IS NULL
     OR setting_name NOT IN (
       'app.user_id',
       'app.organization_id',
       'app.session_id',
       'app.job_id',
       'app.worker_id'
     )
     OR maximum_length < 1
     OR maximum_length > 4096 THEN
    RETURN NULL;
  END IF;

  context_value := pg_catalog.current_setting(setting_name, true);

  IF context_value IS NULL
     OR context_value = ''
     OR context_value IS DISTINCT FROM pg_catalog.btrim(context_value)
     OR pg_catalog.length(context_value) > maximum_length
     OR context_value ~ '[[:cntrl:]]' THEN
    RETURN NULL;
  END IF;

  RETURN context_value;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION private.current_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.context_text('app.user_id', 512)
$function$;

CREATE OR REPLACE FUNCTION private.current_session_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.context_text('app.session_id', 2048)
$function$;

CREATE OR REPLACE FUNCTION private.current_worker_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.context_text('app.worker_id', 512)
$function$;

CREATE OR REPLACE FUNCTION private.current_organization_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  context_value text;
BEGIN
  context_value := private.context_text('app.organization_id', 36);
  IF context_value IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN context_value::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN NULL;
  END;
END
$function$;

CREATE OR REPLACE FUNCTION private.current_job_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  context_value text;
BEGIN
  context_value := private.context_text('app.job_id', 36);
  IF context_value IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN context_value::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN NULL;
  END;
END
$function$;

CREATE OR REPLACE FUNCTION private.has_active_session(
  requested_user_id text,
  requested_session_id text
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    requested_user_id IS NOT NULL
    AND requested_session_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.sessions AS session_record
      JOIN public.users AS app_user
        ON app_user.id = session_record.user_id
      WHERE session_record.sid = requested_session_id
        AND session_record.user_id = requested_user_id
        AND session_record.auth_version = app_user.auth_version
        AND session_record.expire >
          pg_catalog.clock_timestamp()::timestamp without time zone
    )
$function$;

CREATE OR REPLACE FUNCTION private.is_platform_admin_session()
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    private.has_active_session(
      private.current_user_id(),
      private.current_session_id()
    )
    AND EXISTS (
      SELECT 1
      FROM public.users AS app_user
      WHERE app_user.id = private.current_user_id()
        AND app_user.platform_role =
          'platform_admin'::public.platform_role
    )
$function$;

CREATE OR REPLACE FUNCTION private.has_tenant_access(
  requested_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    requested_organization_id IS NOT NULL
    AND requested_organization_id = private.current_organization_id()
    AND EXISTS (
      SELECT 1
      FROM public.users AS app_user
      JOIN public.sessions AS session_record
        ON session_record.user_id = app_user.id
      WHERE app_user.id = private.current_user_id()
        AND session_record.sid = private.current_session_id()
        AND session_record.auth_version = app_user.auth_version
        AND session_record.expire >
          pg_catalog.clock_timestamp()::timestamp without time zone
        AND (
          (
            app_user.platform_role IS DISTINCT FROM
              'platform_admin'::public.platform_role
            AND EXISTS (
              SELECT 1
              FROM public.organization_memberships AS membership
              WHERE membership.organization_id = requested_organization_id
                AND membership.user_id = app_user.id
            )
          )
          OR
          (
            app_user.platform_role =
              'platform_admin'::public.platform_role
            AND EXISTS (
              SELECT 1
              FROM public.platform_tenant_access_leases AS access_lease
              WHERE access_lease.organization_id =
                    requested_organization_id
                AND access_lease.platform_user_id = app_user.id
                AND access_lease.session_id = session_record.sid
                AND access_lease.revoked_at IS NULL
                AND access_lease.expires_at >
                  pg_catalog.clock_timestamp()
            )
          )
        )
    )
$function$;

CREATE OR REPLACE FUNCTION private.has_tenant_admin_access(
  requested_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    private.has_tenant_access(requested_organization_id)
    AND (
      private.is_platform_admin_session()
      OR EXISTS (
        SELECT 1
        FROM public.users AS app_user
        JOIN public.organization_memberships AS membership
          ON membership.user_id = app_user.id
        WHERE app_user.id = private.current_user_id()
          AND app_user.platform_role IS DISTINCT FROM
            'platform_admin'::public.platform_role
          AND membership.organization_id = requested_organization_id
          AND membership.role IN (
            'owner'::public.organization_role,
            'admin'::public.organization_role
          )
        )
      )
$function$;

CREATE OR REPLACE FUNCTION private.can_view_user(
  requested_user_id text
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    requested_user_id IS NOT NULL
    AND private.has_tenant_access(private.current_organization_id())
    AND (
      requested_user_id = private.current_user_id()
      OR EXISTS (
        SELECT 1
        FROM public.organization_memberships AS membership
        WHERE membership.organization_id =
              private.current_organization_id()
          AND membership.user_id = requested_user_id
      )
    )
$function$;

CREATE OR REPLACE FUNCTION private.identity_invitation_is_active(
  requested_invitation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    requested_invitation_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_invitations AS invitation
      WHERE invitation.id = requested_invitation_id
        AND invitation.accepted_at IS NULL
        AND invitation.revoked_at IS NULL
        AND invitation.expires_at >
          pg_catalog.statement_timestamp()
    )
$function$;

CREATE OR REPLACE FUNCTION private.identity_can_accept_membership(
  requested_organization_id uuid,
  requested_user_id text,
  requested_role public.organization_role
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    requested_organization_id IS NOT NULL
    AND requested_user_id IS NOT NULL
    AND requested_role IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.users AS app_user
      JOIN public.organization_invitations AS invitation
        ON invitation.organization_id = requested_organization_id
       AND invitation.email =
         pg_catalog.lower(pg_catalog.btrim(app_user.email))
       AND invitation.role = requested_role
      WHERE app_user.id = requested_user_id
        AND invitation.accepted_at IS NULL
        AND invitation.revoked_at IS NULL
        AND invitation.expires_at >
          pg_catalog.statement_timestamp()
    )
$function$;

CREATE OR REPLACE FUNCTION private.identity_can_mark_invitation_accepted(
  requested_organization_id uuid,
  requested_email text,
  requested_role public.organization_role,
  requested_accepted_user_id text,
  requested_accepted_at timestamptz,
  requested_revoked_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    requested_organization_id IS NOT NULL
    AND requested_email IS NOT NULL
    AND requested_role IS NOT NULL
    AND requested_accepted_user_id IS NOT NULL
    AND requested_accepted_at IS NOT NULL
    AND requested_revoked_at IS NULL
    AND requested_accepted_at >=
      pg_catalog.statement_timestamp() - interval '5 minutes'
    AND requested_accepted_at <=
      pg_catalog.statement_timestamp() + interval '5 minutes'
    AND EXISTS (
      SELECT 1
      FROM public.users AS app_user
      JOIN public.organization_memberships AS membership
        ON membership.organization_id = requested_organization_id
       AND membership.user_id = app_user.id
       AND membership.role = requested_role
      WHERE app_user.id = requested_accepted_user_id
        AND pg_catalog.lower(pg_catalog.btrim(app_user.email)) =
          requested_email
    )
$function$;

CREATE OR REPLACE FUNCTION private.identity_can_insert_organization_audit_event(
  requested_organization_id uuid,
  requested_actor_user_id text,
  requested_event_type text,
  requested_target_type text,
  requested_target_id text,
  requested_metadata jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    requested_organization_id IS NOT NULL
    AND requested_actor_user_id IS NOT NULL
    AND requested_metadata IS NOT NULL
    AND pg_catalog.jsonb_typeof(requested_metadata) = 'object'
    AND (
      (
        requested_event_type = 'account.password_changed'
        AND requested_target_type = 'user'
        AND requested_target_id = requested_actor_user_id
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships AS membership
          WHERE membership.organization_id = requested_organization_id
            AND membership.user_id = requested_actor_user_id
        )
      )
      OR
      (
        requested_event_type = 'membership.invitation_accepted'
        AND requested_target_type = 'organization_membership'
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships AS membership
          JOIN public.organization_invitations AS invitation
            ON invitation.organization_id = membership.organization_id
           AND invitation.id::text =
             requested_metadata ->> 'invitationId'
           AND invitation.accepted_by_user_id = membership.user_id
           AND invitation.accepted_at IS NOT NULL
          WHERE membership.organization_id = requested_organization_id
            AND membership.user_id = requested_actor_user_id
            AND membership.id::text = requested_target_id
            AND membership.role::text =
              requested_metadata ->> 'role'
        )
      )
    )
$function$;

CREATE OR REPLACE FUNCTION private.worker_has_job_access(
  requested_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    requested_organization_id IS NOT NULL
    AND requested_organization_id = private.current_organization_id()
    AND private.current_job_id() IS NOT NULL
    AND private.current_worker_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.processing_jobs AS job
      WHERE job.id = private.current_job_id()
        AND job.organization_id = requested_organization_id
        AND job.status = 'running'::public.processing_job_state
        AND job.lease_owner = private.current_worker_id()
        AND job.lease_expires_at >
          pg_catalog.clock_timestamp()
    )
$function$;

COMMENT ON FUNCTION private.has_tenant_access(uuid) IS
  'Fail-closed tenant authorization. Normal users require an active version-matched session and same-tenant membership; platform admins require an active session-bound, unexpired, nonrevoked lease.';
COMMENT ON FUNCTION private.worker_has_job_access(uuid) IS
  'Fail-closed worker authorization bound to app.organization_id, app.job_id, app.worker_id, and the currently running unexpired database lease.';

-- Repair mutable-search-path advisor warnings on the three pre-existing
-- trigger helpers and fully qualify the one helper that reads a table.
CREATE OR REPLACE FUNCTION public.reject_immutable_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END
$function$;

CREATE OR REPLACE FUNCTION public.prevent_last_organization_owner_removal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF OLD.role = 'owner'::public.organization_role
     AND (
       TG_OP = 'DELETE'
       OR NEW.role IS DISTINCT FROM
          'owner'::public.organization_role
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     ) THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(OLD.organization_id::text, 0)
    );

    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_memberships AS membership
      WHERE membership.organization_id = OLD.organization_id
        AND membership.id <> OLD.id
        AND membership.role = 'owner'::public.organization_role
    ) THEN
      RAISE EXCEPTION 'The last organization owner cannot be removed'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;

CREATE OR REPLACE FUNCTION public.protect_carrier_ruleset_version_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND OLD.status <>
       'draft'::public.carrier_ruleset_version_state THEN
    RAISE EXCEPTION 'Published carrier ruleset history is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status IN (
       'published'::public.carrier_ruleset_version_state,
       'archived'::public.carrier_ruleset_version_state
     ) THEN
    IF OLD.status =
         'archived'::public.carrier_ruleset_version_state
       OR NEW.status NOT IN (
         'published'::public.carrier_ruleset_version_state,
         'archived'::public.carrier_ruleset_version_state
       )
       OR NEW.carrier_key IS DISTINCT FROM OLD.carrier_key
       OR NEW.version_number IS DISTINCT FROM OLD.version_number
       OR NEW.version_label IS DISTINCT FROM OLD.version_label
       OR NEW.display_name IS DISTINCT FROM OLD.display_name
       OR NEW.logo_url IS DISTINCT FROM OLD.logo_url
       OR NEW.ruleset IS DISTINCT FROM OLD.ruleset
       OR NEW.validation IS DISTINCT FROM OLD.validation
       OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
       OR NEW.source_references IS DISTINCT FROM OLD.source_references
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.supersedes_version_id IS DISTINCT FROM OLD.supersedes_version_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
    THEN
      RAISE EXCEPTION 'Published carrier ruleset history is immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;

ALTER FUNCTION public.enforce_configured_carrier_tenant_profile()
  SET search_path = '';
ALTER FUNCTION public.enforce_single_carrier_tenant_membership()
  SET search_path = '';
ALTER FUNCTION public.enforce_platform_role_membership_limit()
  SET search_path = '';
ALTER FUNCTION public.protect_platform_tenant_access_lease()
  SET search_path = '';
ALTER FUNCTION public.audit_platform_tenant_access_lease()
  SET search_path = '';
ALTER FUNCTION public.reject_platform_audit_event_mutation()
  SET search_path = '';

REVOKE ALL ON FUNCTION public.reject_immutable_audit_mutation()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_last_organization_owner_removal()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_carrier_ruleset_version_history()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_configured_carrier_tenant_profile()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_single_carrier_tenant_membership()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_platform_role_membership_limit()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_platform_tenant_access_lease()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_platform_tenant_access_lease()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_platform_audit_event_mutation()
  FROM PUBLIC;

DROP FUNCTION IF EXISTS private.platform_list_tenant_summaries();
CREATE FUNCTION private.platform_list_tenant_summaries()
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  organization_slug text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT private.is_platform_admin_session() THEN
    RAISE EXCEPTION 'An active platform-admin session is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    organization.id,
    organization.name,
    organization.slug
  FROM public.organizations AS organization
  ORDER BY organization.name, organization.id;
END
$function$;

CREATE OR REPLACE FUNCTION private.platform_create_tenant_access(
  requested_organization_id uuid,
  access_reason text,
  requested_ttl interval
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_user_id text;
  actor_session_id text;
  new_lease_id uuid;
BEGIN
  IF NOT private.is_platform_admin_session() THEN
    RAISE EXCEPTION 'An active platform-admin session is required'
      USING ERRCODE = '42501';
  END IF;

  IF requested_organization_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.organizations AS organization
       WHERE organization.id = requested_organization_id
     ) THEN
    RAISE EXCEPTION 'The requested organization does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF access_reason IS NULL
     OR NULLIF(pg_catalog.btrim(access_reason), '') IS NULL
     OR pg_catalog.length(access_reason) > 2000 THEN
    RAISE EXCEPTION 'A nonblank access reason is required'
      USING ERRCODE = '22023';
  END IF;

  IF requested_ttl IS NULL
     OR requested_ttl <= interval '0 seconds'
     OR requested_ttl > interval '1 hour' THEN
    RAISE EXCEPTION 'Tenant access duration must be greater than zero and at most one hour'
      USING ERRCODE = '22023';
  END IF;

  actor_user_id := private.current_user_id();
  actor_session_id := private.current_session_id();

  INSERT INTO public.platform_tenant_access_leases (
    organization_id,
    platform_user_id,
    session_id,
    reason,
    expires_at,
    created_at
  )
  VALUES (
    requested_organization_id,
    actor_user_id,
    actor_session_id,
    pg_catalog.btrim(access_reason),
    pg_catalog.statement_timestamp() + requested_ttl,
    pg_catalog.statement_timestamp()
  )
  RETURNING id INTO new_lease_id;

  RETURN new_lease_id;
END
$function$;

CREATE OR REPLACE FUNCTION private.platform_revoke_tenant_access(
  requested_lease_id uuid,
  revocation_reason text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT private.is_platform_admin_session() THEN
    RAISE EXCEPTION 'An active platform-admin session is required'
      USING ERRCODE = '42501';
  END IF;

  IF $2 IS NULL
     OR NULLIF(pg_catalog.btrim($2), '') IS NULL
     OR pg_catalog.length($2) > 2000 THEN
    RAISE EXCEPTION 'A nonblank revocation reason is required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.platform_tenant_access_leases AS access_lease
  SET
    revoked_at = pg_catalog.clock_timestamp(),
    revoked_by_user_id = private.current_user_id(),
    revocation_reason = pg_catalog.btrim($2)
  WHERE access_lease.id = requested_lease_id
    AND access_lease.revoked_at IS NULL;

  RETURN FOUND;
END
$function$;

CREATE OR REPLACE FUNCTION private.platform_upsert_carrier_profile(
  requested_organization_id uuid,
  requested_carrier_key text,
  requested_display_name text,
  requested_ruleset jsonb,
  requested_logo_url text,
  requested_primary_entity_key text,
  requested_primary_entity_name text,
  requested_primary_legal_name text,
  change_reason text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  profile_id uuid;
  existing_carrier_key text;
  primary_entity_id uuid;
  normalized_entity_key text;
BEGIN
  IF NOT private.is_platform_admin_session() THEN
    RAISE EXCEPTION 'An active platform-admin session is required'
      USING ERRCODE = '42501';
  END IF;

  IF requested_organization_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.organizations AS organization
       WHERE organization.id = requested_organization_id
     ) THEN
    RAISE EXCEPTION 'The requested organization does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF requested_carrier_key IS NULL
     OR requested_carrier_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     OR requested_display_name IS NULL
     OR NULLIF(pg_catalog.btrim(requested_display_name), '') IS NULL
     OR requested_ruleset IS NULL
     OR pg_catalog.jsonb_typeof(requested_ruleset) <> 'object'
     OR change_reason IS NULL
     OR NULLIF(pg_catalog.btrim(change_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Carrier key, display name, object ruleset, and change reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT ruleset.carrier_key
  INTO existing_carrier_key
  FROM public.carrier_rulesets AS ruleset
  WHERE ruleset.organization_id = requested_organization_id
  FOR UPDATE;

  IF existing_carrier_key IS NOT NULL
     AND existing_carrier_key <> requested_carrier_key THEN
    RAISE EXCEPTION 'An established carrier key cannot be changed'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.carrier_rulesets (
    organization_id,
    carrier_key,
    display_name,
    logo_url,
    active,
    ruleset
  )
  VALUES (
    requested_organization_id,
    requested_carrier_key,
    pg_catalog.btrim(requested_display_name),
    requested_logo_url,
    true,
    requested_ruleset
  )
  ON CONFLICT (organization_id)
  DO UPDATE SET
    display_name = EXCLUDED.display_name,
    logo_url = EXCLUDED.logo_url,
    active = true,
    ruleset = EXCLUDED.ruleset,
    updated_at = pg_catalog.clock_timestamp()
  RETURNING id INTO profile_id;

  normalized_entity_key := COALESCE(
    NULLIF(pg_catalog.btrim(requested_primary_entity_key), ''),
    requested_carrier_key
  );

  IF normalized_entity_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'The primary carrier entity key is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT entity.id
  INTO primary_entity_id
  FROM public.carrier_entities AS entity
  WHERE entity.organization_id = requested_organization_id
    AND entity.is_primary
  FOR UPDATE;

  IF primary_entity_id IS NULL THEN
    INSERT INTO public.carrier_entities (
      organization_id,
      entity_key,
      display_name,
      legal_name,
      is_primary,
      active
    )
    VALUES (
      requested_organization_id,
      normalized_entity_key,
      COALESCE(
        NULLIF(
          pg_catalog.btrim(requested_primary_entity_name),
          ''
        ),
        pg_catalog.btrim(requested_display_name)
      ),
      requested_primary_legal_name,
      true,
      true
    );
  ELSE
    UPDATE public.carrier_entities AS entity
    SET
      entity_key = normalized_entity_key,
      display_name = COALESCE(
        NULLIF(
          pg_catalog.btrim(requested_primary_entity_name),
          ''
        ),
        pg_catalog.btrim(requested_display_name)
      ),
      legal_name = requested_primary_legal_name,
      active = true,
      updated_at = pg_catalog.clock_timestamp()
    WHERE entity.id = primary_entity_id
      AND entity.organization_id = requested_organization_id;
  END IF;

  INSERT INTO public.platform_audit_events (
    organization_id,
    actor_user_id,
    session_id,
    event_type,
    reason,
    metadata
  )
  VALUES (
    requested_organization_id,
    private.current_user_id(),
    private.current_session_id(),
    'carrier_profile_upserted',
    pg_catalog.btrim(change_reason),
    pg_catalog.jsonb_build_object(
      'carrierKey', requested_carrier_key,
      'profileId', profile_id
    )
  );

  RETURN profile_id;
END
$function$;

CREATE OR REPLACE FUNCTION private.platform_upsert_carrier_entity(
  requested_organization_id uuid,
  requested_entity_id uuid,
  requested_entity_key text,
  requested_display_name text,
  requested_legal_name text,
  requested_is_primary boolean,
  requested_active boolean,
  change_reason text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  saved_entity_id uuid;
BEGIN
  IF NOT private.is_platform_admin_session() THEN
    RAISE EXCEPTION 'An active platform-admin session is required'
      USING ERRCODE = '42501';
  END IF;

  IF requested_organization_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.carrier_rulesets AS ruleset
       WHERE ruleset.organization_id = requested_organization_id
     )
     OR requested_entity_key IS NULL
     OR requested_entity_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     OR requested_display_name IS NULL
     OR NULLIF(pg_catalog.btrim(requested_display_name), '') IS NULL
     OR requested_is_primary IS NULL
     OR requested_active IS NULL
     OR change_reason IS NULL
     OR NULLIF(pg_catalog.btrim(change_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A configured organization and valid entity fields are required'
      USING ERRCODE = '22023';
  END IF;

  IF requested_is_primary THEN
    UPDATE public.carrier_entities AS entity
    SET
      is_primary = false,
      updated_at = pg_catalog.clock_timestamp()
    WHERE entity.organization_id = requested_organization_id
      AND entity.is_primary
      AND (
        requested_entity_id IS NULL
        OR entity.id <> requested_entity_id
      );
  END IF;

  IF requested_entity_id IS NULL THEN
    INSERT INTO public.carrier_entities (
      organization_id,
      entity_key,
      display_name,
      legal_name,
      is_primary,
      active
    )
    VALUES (
      requested_organization_id,
      requested_entity_key,
      pg_catalog.btrim(requested_display_name),
      requested_legal_name,
      requested_is_primary,
      requested_active
    )
    RETURNING id INTO saved_entity_id;
  ELSE
    UPDATE public.carrier_entities AS entity
    SET
      entity_key = requested_entity_key,
      display_name = pg_catalog.btrim(requested_display_name),
      legal_name = requested_legal_name,
      is_primary = requested_is_primary,
      active = requested_active,
      updated_at = pg_catalog.clock_timestamp()
    WHERE entity.id = requested_entity_id
      AND entity.organization_id = requested_organization_id
    RETURNING entity.id INTO saved_entity_id;

    IF saved_entity_id IS NULL THEN
      RAISE EXCEPTION 'Carrier entity does not belong to the requested organization'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  INSERT INTO public.platform_audit_events (
    organization_id,
    actor_user_id,
    session_id,
    event_type,
    reason,
    metadata
  )
  VALUES (
    requested_organization_id,
    private.current_user_id(),
    private.current_session_id(),
    'carrier_entity_upserted',
    pg_catalog.btrim(change_reason),
    pg_catalog.jsonb_build_object('entityId', saved_entity_id)
  );

  RETURN saved_entity_id;
END
$function$;

CREATE OR REPLACE FUNCTION private.platform_create_carrier_ruleset_version(
  requested_organization_id uuid,
  requested_version_label text,
  requested_display_name text,
  requested_logo_url text,
  requested_ruleset jsonb,
  requested_validation jsonb,
  requested_change_summary text,
  requested_source_references jsonb,
  change_reason text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  carrier_key_value text;
  next_version_number integer;
  new_version_id uuid;
BEGIN
  IF NOT private.is_platform_admin_session() THEN
    RAISE EXCEPTION 'An active platform-admin session is required'
      USING ERRCODE = '42501';
  END IF;

  IF requested_version_label IS NULL
     OR NULLIF(pg_catalog.btrim(requested_version_label), '') IS NULL
     OR requested_display_name IS NULL
     OR NULLIF(pg_catalog.btrim(requested_display_name), '') IS NULL
     OR requested_ruleset IS NULL
     OR pg_catalog.jsonb_typeof(requested_ruleset) <> 'object'
     OR requested_validation IS NULL
     OR pg_catalog.jsonb_typeof(requested_validation) <> 'object'
     OR requested_source_references IS NULL
     OR pg_catalog.jsonb_typeof(requested_source_references) <> 'array'
     OR change_reason IS NULL
     OR NULLIF(pg_catalog.btrim(change_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Valid ruleset version fields and a change reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT ruleset.carrier_key
  INTO carrier_key_value
  FROM public.carrier_rulesets AS ruleset
  WHERE ruleset.organization_id = requested_organization_id
  FOR UPDATE;

  IF carrier_key_value IS NULL THEN
    RAISE EXCEPTION 'Carrier profile does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(pg_catalog.max(version.version_number), 0) + 1
  INTO next_version_number
  FROM public.carrier_ruleset_versions AS version
  WHERE version.organization_id = requested_organization_id;

  INSERT INTO public.carrier_ruleset_versions (
    organization_id,
    carrier_key,
    version_number,
    version_label,
    status,
    display_name,
    logo_url,
    ruleset,
    validation,
    change_summary,
    source_references,
    created_by_user_id
  )
  VALUES (
    requested_organization_id,
    carrier_key_value,
    next_version_number,
    pg_catalog.btrim(requested_version_label),
    'draft'::public.carrier_ruleset_version_state,
    pg_catalog.btrim(requested_display_name),
    requested_logo_url,
    requested_ruleset,
    requested_validation,
    requested_change_summary,
    requested_source_references,
    private.current_user_id()
  )
  RETURNING id INTO new_version_id;

  INSERT INTO public.platform_audit_events (
    organization_id,
    actor_user_id,
    session_id,
    event_type,
    reason,
    metadata
  )
  VALUES (
    requested_organization_id,
    private.current_user_id(),
    private.current_session_id(),
    'carrier_ruleset_version_created',
    pg_catalog.btrim(change_reason),
    pg_catalog.jsonb_build_object(
      'versionId', new_version_id,
      'versionNumber', next_version_number
    )
  );

  RETURN new_version_id;
END
$function$;

CREATE OR REPLACE FUNCTION private.platform_publish_carrier_ruleset_version(
  requested_organization_id uuid,
  requested_version_id uuid,
  change_reason text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  version_record public.carrier_ruleset_versions%ROWTYPE;
BEGIN
  IF NOT private.is_platform_admin_session() THEN
    RAISE EXCEPTION 'An active platform-admin session is required'
      USING ERRCODE = '42501';
  END IF;

  IF change_reason IS NULL
     OR NULLIF(pg_catalog.btrim(change_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A nonblank publication reason is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT version.*
  INTO version_record
  FROM public.carrier_ruleset_versions AS version
  WHERE version.id = requested_version_id
    AND version.organization_id = requested_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Carrier ruleset version does not belong to the requested organization'
      USING ERRCODE = '23503';
  END IF;

  IF version_record.status =
       'archived'::public.carrier_ruleset_version_state THEN
    RAISE EXCEPTION 'Archived carrier ruleset versions cannot be republished'
      USING ERRCODE = '55000';
  END IF;

  IF version_record.status <>
       'published'::public.carrier_ruleset_version_state THEN
    UPDATE public.carrier_ruleset_versions AS version
    SET status = 'archived'::public.carrier_ruleset_version_state
    WHERE version.organization_id = requested_organization_id
      AND version.status =
        'published'::public.carrier_ruleset_version_state;

    UPDATE public.carrier_ruleset_versions AS version
    SET
      status = 'published'::public.carrier_ruleset_version_state,
      approved_by_user_id = private.current_user_id(),
      published_at = pg_catalog.clock_timestamp()
    WHERE version.id = requested_version_id
      AND version.organization_id = requested_organization_id;

    UPDATE public.carrier_rulesets AS ruleset
    SET
      display_name = version_record.display_name,
      logo_url = version_record.logo_url,
      ruleset = version_record.ruleset,
      active = true,
      updated_at = pg_catalog.clock_timestamp()
    WHERE ruleset.organization_id = requested_organization_id;
  END IF;

  INSERT INTO public.platform_audit_events (
    organization_id,
    actor_user_id,
    session_id,
    event_type,
    reason,
    metadata
  )
  VALUES (
    requested_organization_id,
    private.current_user_id(),
    private.current_session_id(),
    'carrier_ruleset_version_published',
    pg_catalog.btrim(change_reason),
    pg_catalog.jsonb_build_object('versionId', requested_version_id)
  );

  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION private.claim_processing_job(
  lease_duration_ms integer DEFAULT 90000
)
RETURNS SETOF public.processing_jobs
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  worker_identifier text;
  selected_job_id uuid;
  claimed_job public.processing_jobs%ROWTYPE;
  next_attempt integer;
BEGIN
  worker_identifier := private.current_worker_id();

  IF worker_identifier IS NULL THEN
    RAISE EXCEPTION 'app.worker_id must be set to a valid server worker identifier'
      USING ERRCODE = '22023';
  END IF;

  IF lease_duration_ms IS NULL
     OR lease_duration_ms < 1000
     OR lease_duration_ms > 900000 THEN
    RAISE EXCEPTION 'Worker lease duration must be between 1 second and 15 minutes'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('app.job_id', '', true);
  PERFORM pg_catalog.set_config('app.organization_id', '', true);

  UPDATE public.processing_job_attempts AS attempt
  SET
    status = 'lease_expired'::public.processing_attempt_state,
    completed_at = pg_catalog.clock_timestamp(),
    error_code = 'lease_expired',
    error_message = 'Worker lease expired before completion'
  FROM public.processing_jobs AS job
  WHERE job.id = attempt.job_id
    AND job.organization_id = attempt.organization_id
    AND job.status = 'running'::public.processing_job_state
    AND job.lease_expires_at < pg_catalog.clock_timestamp()
    AND attempt.attempt_number = job.attempt_count
    AND attempt.status = 'running'::public.processing_attempt_state;

  UPDATE public.processing_jobs AS job
  SET
    status = CASE
      WHEN job.attempt_count < job.max_attempts
        THEN 'queued'::public.processing_job_state
      ELSE 'failed'::public.processing_job_state
    END,
    stage = CASE
      WHEN job.attempt_count < job.max_attempts
        THEN 'uploaded'::public.processing_job_stage
      ELSE 'failed'::public.processing_job_stage
    END,
    available_at = pg_catalog.clock_timestamp(),
    completed_at = CASE
      WHEN job.attempt_count >= job.max_attempts
        THEN pg_catalog.clock_timestamp()
      ELSE NULL
    END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    error_code = 'lease_expired',
    error_message = 'Worker lease expired before completion',
    updated_at = pg_catalog.clock_timestamp()
  WHERE job.status = 'running'::public.processing_job_state
    AND job.lease_expires_at < pg_catalog.clock_timestamp();

  SELECT job.id
  INTO selected_job_id
  FROM public.processing_jobs AS job
  WHERE job.status = 'queued'::public.processing_job_state
    AND job.available_at <= pg_catalog.clock_timestamp()
    AND job.attempt_count < job.max_attempts
  ORDER BY job.priority, job.created_at, job.id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF selected_job_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.processing_jobs AS job
  SET
    status = 'running'::public.processing_job_state,
    attempt_count = job.attempt_count + 1,
    lease_owner = worker_identifier,
    lease_expires_at =
      pg_catalog.clock_timestamp()
      + lease_duration_ms * interval '1 millisecond',
    heartbeat_at = pg_catalog.clock_timestamp(),
    started_at = COALESCE(
      job.started_at,
      pg_catalog.clock_timestamp()
    ),
    updated_at = pg_catalog.clock_timestamp()
  WHERE job.id = selected_job_id
    AND job.status = 'queued'::public.processing_job_state
  RETURNING job.* INTO claimed_job;

  IF claimed_job.id IS NULL THEN
    RETURN;
  END IF;

  next_attempt := claimed_job.attempt_count;

  INSERT INTO public.processing_job_attempts (
    organization_id,
    job_id,
    attempt_number,
    worker_id,
    status
  )
  VALUES (
    claimed_job.organization_id,
    claimed_job.id,
    next_attempt,
    worker_identifier,
    'running'::public.processing_attempt_state
  );

  PERFORM pg_catalog.set_config(
    'app.job_id',
    claimed_job.id::text,
    true
  );
  PERFORM pg_catalog.set_config(
    'app.organization_id',
    claimed_job.organization_id::text,
    true
  );

  RETURN NEXT claimed_job;
  RETURN;
END
$function$;

CREATE OR REPLACE FUNCTION private.heartbeat_processing_job(
  lease_duration_ms integer DEFAULT 90000,
  requested_stage public.processing_job_stage DEFAULT NULL,
  requested_progress integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF private.current_job_id() IS NULL
     OR private.current_organization_id() IS NULL
     OR private.current_worker_id() IS NULL
     OR lease_duration_ms IS NULL
     OR lease_duration_ms < 1000
     OR lease_duration_ms > 900000
     OR (
       requested_progress IS NOT NULL
       AND (requested_progress < 0 OR requested_progress > 100)
     ) THEN
    RETURN false;
  END IF;

  UPDATE public.processing_jobs AS job
  SET
    stage = COALESCE(requested_stage, job.stage),
    progress = COALESCE(requested_progress, job.progress),
    heartbeat_at = pg_catalog.clock_timestamp(),
    lease_expires_at =
      pg_catalog.clock_timestamp()
      + lease_duration_ms * interval '1 millisecond',
    updated_at = pg_catalog.clock_timestamp()
  WHERE job.id = private.current_job_id()
    AND job.organization_id = private.current_organization_id()
    AND job.lease_owner = private.current_worker_id()
    AND job.status = 'running'::public.processing_job_state
    AND job.lease_expires_at > pg_catalog.clock_timestamp();

  RETURN FOUND;
END
$function$;

CREATE OR REPLACE FUNCTION private.complete_processing_job(
  requested_outcome public.processing_job_state,
  completion_metadata jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  completed_attempt integer;
  completed_stage public.processing_job_stage;
BEGIN
  IF requested_outcome NOT IN (
       'succeeded'::public.processing_job_state,
       'degraded'::public.processing_job_state
     )
     OR private.current_job_id() IS NULL
     OR private.current_organization_id() IS NULL
     OR private.current_worker_id() IS NULL
     OR (
       completion_metadata IS NOT NULL
       AND pg_catalog.jsonb_typeof(completion_metadata) <> 'object'
     ) THEN
    RETURN false;
  END IF;

  completed_stage := CASE requested_outcome
    WHEN 'succeeded'::public.processing_job_state
      THEN 'completed'::public.processing_job_stage
    ELSE 'degraded'::public.processing_job_stage
  END;

  UPDATE public.processing_jobs AS job
  SET
    status = requested_outcome,
    stage = completed_stage,
    progress = 100,
    completed_at = pg_catalog.clock_timestamp(),
    lease_owner = NULL,
    lease_expires_at = NULL,
    heartbeat_at = pg_catalog.clock_timestamp(),
    error_metadata = COALESCE(
      completion_metadata,
      job.error_metadata
    ),
    updated_at = pg_catalog.clock_timestamp()
  WHERE job.id = private.current_job_id()
    AND job.organization_id = private.current_organization_id()
    AND job.lease_owner = private.current_worker_id()
    AND job.status = 'running'::public.processing_job_state
    AND job.lease_expires_at > pg_catalog.clock_timestamp()
  RETURNING job.attempt_count INTO completed_attempt;

  IF completed_attempt IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.processing_job_attempts AS attempt
  SET
    status = CASE requested_outcome
      WHEN 'succeeded'::public.processing_job_state
        THEN 'succeeded'::public.processing_attempt_state
      ELSE 'degraded'::public.processing_attempt_state
    END,
    completed_at = pg_catalog.clock_timestamp()
  WHERE attempt.organization_id = private.current_organization_id()
    AND attempt.job_id = private.current_job_id()
    AND attempt.attempt_number = completed_attempt
    AND attempt.worker_id = private.current_worker_id()
    AND attempt.status = 'running'::public.processing_attempt_state;

  PERFORM pg_catalog.set_config('app.job_id', '', true);
  PERFORM pg_catalog.set_config('app.organization_id', '', true);

  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION private.fail_processing_job(
  requested_error_code text,
  requested_error_message text,
  requested_error_metadata jsonb DEFAULT NULL
)
RETURNS public.processing_job_state
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  job_record public.processing_jobs%ROWTYPE;
  resulting_status public.processing_job_state;
  retry_delay_seconds integer;
BEGIN
  IF private.current_job_id() IS NULL
     OR private.current_organization_id() IS NULL
     OR private.current_worker_id() IS NULL
     OR requested_error_code IS NULL
     OR NULLIF(pg_catalog.btrim(requested_error_code), '') IS NULL
     OR requested_error_message IS NULL
     OR NULLIF(pg_catalog.btrim(requested_error_message), '') IS NULL
     OR (
       requested_error_metadata IS NOT NULL
       AND pg_catalog.jsonb_typeof(requested_error_metadata) <> 'object'
     ) THEN
    RETURN NULL;
  END IF;

  SELECT job.*
  INTO job_record
  FROM public.processing_jobs AS job
  WHERE job.id = private.current_job_id()
    AND job.organization_id = private.current_organization_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF job_record.status = 'cancelled'::public.processing_job_state
     AND EXISTS (
       SELECT 1
       FROM public.processing_job_attempts AS attempt
       WHERE attempt.organization_id = job_record.organization_id
         AND attempt.job_id = job_record.id
         AND attempt.attempt_number = job_record.attempt_count
         AND attempt.worker_id = private.current_worker_id()
         AND attempt.status = 'running'::public.processing_attempt_state
     ) THEN
    UPDATE public.processing_job_attempts AS attempt
    SET
      status = 'cancelled'::public.processing_attempt_state,
      completed_at = pg_catalog.clock_timestamp(),
      error_code = 'cancelled_by_user',
      error_message = 'Cancelled while processing'
    WHERE attempt.organization_id = job_record.organization_id
      AND attempt.job_id = job_record.id
      AND attempt.attempt_number = job_record.attempt_count
      AND attempt.worker_id = private.current_worker_id()
      AND attempt.status = 'running'::public.processing_attempt_state;

    RETURN 'cancelled'::public.processing_job_state;
  END IF;

  IF job_record.status <> 'running'::public.processing_job_state
     OR job_record.lease_owner <> private.current_worker_id()
     OR job_record.lease_expires_at <=
       pg_catalog.clock_timestamp() THEN
    RETURN NULL;
  END IF;

  resulting_status := CASE
    WHEN job_record.attempt_count < job_record.max_attempts
      THEN 'queued'::public.processing_job_state
    ELSE 'failed'::public.processing_job_state
  END;
  retry_delay_seconds := LEAST(
    60,
    pg_catalog.power(
      2::numeric,
      GREATEST(job_record.attempt_count - 1, 0)
    )::integer
  );

  UPDATE public.processing_jobs AS job
  SET
    status = resulting_status,
    stage = 'failed'::public.processing_job_stage,
    progress = CASE
      WHEN resulting_status = 'queued'::public.processing_job_state
        THEN 0
      ELSE job.progress
    END,
    available_at =
      pg_catalog.clock_timestamp()
      + retry_delay_seconds * interval '1 second',
    completed_at = CASE
      WHEN resulting_status = 'failed'::public.processing_job_state
        THEN pg_catalog.clock_timestamp()
      ELSE NULL
    END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    error_code = pg_catalog.left(requested_error_code, 256),
    error_message = pg_catalog.left(requested_error_message, 2000),
    error_metadata = requested_error_metadata,
    updated_at = pg_catalog.clock_timestamp()
  WHERE job.id = job_record.id
    AND job.organization_id = job_record.organization_id;

  UPDATE public.processing_job_attempts AS attempt
  SET
    status = 'failed'::public.processing_attempt_state,
    completed_at = pg_catalog.clock_timestamp(),
    error_code = pg_catalog.left(requested_error_code, 256),
    error_message = pg_catalog.left(requested_error_message, 2000),
    error_metadata = requested_error_metadata
  WHERE attempt.organization_id = job_record.organization_id
    AND attempt.job_id = job_record.id
    AND attempt.attempt_number = job_record.attempt_count
    AND attempt.worker_id = private.current_worker_id()
    AND attempt.status = 'running'::public.processing_attempt_state;

  PERFORM pg_catalog.set_config('app.job_id', '', true);
  PERFORM pg_catalog.set_config('app.organization_id', '', true);

  RETURN resulting_status;
END
$function$;

COMMENT ON FUNCTION private.claim_processing_job(integer) IS
  'Atomically reaps expired leases and claims one queued job. The trusted worker sets app.worker_id before calling and re-applies returned app.job_id/app.organization_id on every checked-out connection/transaction, clearing them before pooling.';
COMMENT ON FUNCTION private.heartbeat_processing_job(
  integer,
  public.processing_job_stage,
  integer
) IS
  'Renews only the running job identified by app.worker_id, app.job_id, and app.organization_id.';
COMMENT ON FUNCTION private.complete_processing_job(
  public.processing_job_state,
  jsonb
) IS
  'Completes only the active context-bound worker lease and its matching attempt.';
COMMENT ON FUNCTION private.fail_processing_job(text, text, jsonb) IS
  'Fails or requeues only the active context-bound worker lease and its matching attempt.';

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Inventory every application table, force RLS, and remove every pre-existing
-- policy (including permissive policies created outside this repository)
-- before installing the named policy set below.
DO $rls_inventory$
DECLARE
  relation_name text;
  existing_policy text;
BEGIN
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
    IF pg_catalog.to_regclass(
      pg_catalog.format('public.%I', relation_name)
    ) IS NULL THEN
      RAISE EXCEPTION 'Required table public.% is missing', relation_name;
    END IF;

    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      relation_name
    );
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',
      relation_name
    );

    FOR existing_policy IN
      SELECT policy.policyname
      FROM pg_catalog.pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = relation_name
    LOOP
      EXECUTE pg_catalog.format(
        'DROP POLICY %I ON public.%I',
        existing_policy,
        relation_name
      );
    END LOOP;

    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC',
      relation_name
    );

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles
      WHERE rolname = 'anon'
    ) THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon',
        relation_name
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles
      WHERE rolname = 'authenticated'
    ) THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated',
        relation_name
      );
    END IF;
  END LOOP;

  IF pg_catalog.to_regclass(
    'public.complete_iq_schema_migrations'
  ) IS NOT NULL THEN
    ALTER TABLE public.complete_iq_schema_migrations
      ENABLE ROW LEVEL SECURITY;

    FOR existing_policy IN
      SELECT policy.policyname
      FROM pg_catalog.pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = 'complete_iq_schema_migrations'
    LOOP
      EXECUTE pg_catalog.format(
        'DROP POLICY %I ON public.complete_iq_schema_migrations',
        existing_policy
      );
    END LOOP;

    REVOKE ALL PRIVILEGES
      ON TABLE public.complete_iq_schema_migrations
      FROM PUBLIC;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles
      WHERE rolname = 'anon'
    ) THEN
      REVOKE ALL PRIVILEGES
        ON TABLE public.complete_iq_schema_migrations
        FROM anon;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles
      WHERE rolname = 'authenticated'
    ) THEN
      REVOKE ALL PRIVILEGES
        ON TABLE public.complete_iq_schema_migrations
        FROM authenticated;
    END IF;
  END IF;
END
$rls_inventory$;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM claims_iq_identity,
       claims_iq_tenant_api,
       claims_iq_worker,
       claims_iq_platform_admin;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA private
  FROM PUBLIC,
       claims_iq_identity,
       claims_iq_tenant_api,
       claims_iq_worker,
       claims_iq_platform_admin;
REVOKE ALL PRIVILEGES ON SCHEMA private
  FROM claims_iq_identity,
       claims_iq_tenant_api,
       claims_iq_worker,
       claims_iq_platform_admin;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM PUBLIC,
       claims_iq_identity,
       claims_iq_tenant_api,
       claims_iq_worker,
       claims_iq_platform_admin;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $revoke_data_api_schema_create$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon'
  ) THEN
    REVOKE CREATE ON SCHEMA public FROM anon;
    REVOKE ALL PRIVILEGES ON SCHEMA private FROM anon;
    REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA private FROM anon;
    REVOKE EXECUTE ON FUNCTION public.reject_immutable_audit_mutation()
      FROM anon;
    REVOKE EXECUTE ON FUNCTION public.prevent_last_organization_owner_removal()
      FROM anon;
    REVOKE EXECUTE ON FUNCTION public.protect_carrier_ruleset_version_history()
      FROM anon;
    REVOKE EXECUTE ON FUNCTION public.enforce_configured_carrier_tenant_profile()
      FROM anon;
    REVOKE EXECUTE ON FUNCTION public.enforce_single_carrier_tenant_membership()
      FROM anon;
    REVOKE EXECUTE ON FUNCTION public.enforce_platform_role_membership_limit()
      FROM anon;
    REVOKE EXECUTE ON FUNCTION public.protect_platform_tenant_access_lease()
      FROM anon;
    REVOKE EXECUTE ON FUNCTION public.audit_platform_tenant_access_lease()
      FROM anon;
    REVOKE EXECUTE ON FUNCTION public.reject_platform_audit_event_mutation()
      FROM anon;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'
  ) THEN
    REVOKE CREATE ON SCHEMA public FROM authenticated;
    REVOKE ALL PRIVILEGES ON SCHEMA private FROM authenticated;
    REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA private
      FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.reject_immutable_audit_mutation()
      FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.prevent_last_organization_owner_removal()
      FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.protect_carrier_ruleset_version_history()
      FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.enforce_configured_carrier_tenant_profile()
      FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.enforce_single_carrier_tenant_membership()
      FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.enforce_platform_role_membership_limit()
      FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.protect_platform_tenant_access_lease()
      FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.audit_platform_tenant_access_lease()
      FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.reject_platform_audit_event_mutation()
      FROM authenticated;
  END IF;
END
$revoke_data_api_schema_create$;

CREATE POLICY users_identity_all
  ON public.users
  FOR ALL
  TO claims_iq_identity
  USING (true)
  WITH CHECK (true);

CREATE POLICY users_tenant_select
  ON public.users
  FOR SELECT
  TO claims_iq_tenant_api
  USING ((SELECT private.can_view_user(id)));

CREATE POLICY users_tenant_update_self
  ON public.users
  FOR UPDATE
  TO claims_iq_tenant_api
  USING (
    id = (SELECT private.current_user_id())
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  )
  WITH CHECK (
    id = (SELECT private.current_user_id())
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY sessions_identity_all
  ON public.sessions
  FOR ALL
  TO claims_iq_identity
  USING (true)
  WITH CHECK (true);

CREATE POLICY password_reset_tokens_identity_all
  ON public.password_reset_tokens
  FOR ALL
  TO claims_iq_identity
  USING (true)
  WITH CHECK (true);

CREATE POLICY organizations_identity_select
  ON public.organizations
  FOR SELECT
  TO claims_iq_identity
  USING (true);

CREATE POLICY organization_memberships_identity_select
  ON public.organization_memberships
  FOR SELECT
  TO claims_iq_identity
  USING (true);

CREATE POLICY organization_memberships_identity_invitation_insert
  ON public.organization_memberships
  FOR INSERT
  TO claims_iq_identity
  WITH CHECK (
    (SELECT private.identity_can_accept_membership(
      organization_id,
      user_id,
      role
    ))
  );

CREATE POLICY organization_invitations_identity_select
  ON public.organization_invitations
  FOR SELECT
  TO claims_iq_identity
  USING (true);

CREATE POLICY organization_invitations_identity_accept
  ON public.organization_invitations
  FOR UPDATE
  TO claims_iq_identity
  USING ((SELECT private.identity_invitation_is_active(id)))
  WITH CHECK (
    (SELECT private.identity_can_mark_invitation_accepted(
      organization_id,
      email,
      role,
      accepted_by_user_id,
      accepted_at,
      revoked_at
    ))
  );

CREATE POLICY organization_audit_events_identity_insert
  ON public.organization_audit_events
  FOR INSERT
  TO claims_iq_identity
  WITH CHECK (
    (SELECT private.identity_can_insert_organization_audit_event(
      organization_id,
      actor_user_id,
      event_type,
      target_type,
      target_id,
      metadata
    ))
  );

CREATE POLICY organizations_tenant_select
  ON public.organizations
  FOR SELECT
  TO claims_iq_tenant_api
  USING (
    id = (SELECT private.current_organization_id())
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY organizations_tenant_update
  ON public.organizations
  FOR UPDATE
  TO claims_iq_tenant_api
  USING ((SELECT private.has_tenant_admin_access(id)))
  WITH CHECK (
    id = (SELECT private.current_organization_id())
    AND (SELECT private.has_tenant_admin_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY organization_memberships_tenant_select
  ON public.organization_memberships
  FOR SELECT
  TO claims_iq_tenant_api
  USING (
    organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY organization_memberships_tenant_admin
  ON public.organization_memberships
  FOR ALL
  TO claims_iq_tenant_api
  USING ((SELECT private.has_tenant_admin_access(organization_id)))
  WITH CHECK (
    organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.has_tenant_admin_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY organization_invitations_tenant_admin
  ON public.organization_invitations
  FOR ALL
  TO claims_iq_tenant_api
  USING ((SELECT private.has_tenant_admin_access(organization_id)))
  WITH CHECK (
    organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.has_tenant_admin_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY saved_views_tenant_owner
  ON public.saved_views
  FOR ALL
  TO claims_iq_tenant_api
  USING (
    organization_id = (SELECT private.current_organization_id())
    AND user_id = (SELECT private.current_user_id())
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  )
  WITH CHECK (
    organization_id = (SELECT private.current_organization_id())
    AND user_id = (SELECT private.current_user_id())
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY organization_audit_events_tenant_select
  ON public.organization_audit_events
  FOR SELECT
  TO claims_iq_tenant_api
  USING (
    organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY organization_audit_events_tenant_insert
  ON public.organization_audit_events
  FOR INSERT
  TO claims_iq_tenant_api
  WITH CHECK (
    organization_id = (SELECT private.current_organization_id())
    AND (
      actor_user_id IS NULL
      OR actor_user_id = (SELECT private.current_user_id())
    )
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY organization_settings_tenant_select
  ON public.organization_settings
  FOR SELECT
  TO claims_iq_tenant_api
  USING (
    organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY organization_settings_tenant_admin
  ON public.organization_settings
  FOR ALL
  TO claims_iq_tenant_api
  USING ((SELECT private.has_tenant_admin_access(organization_id)))
  WITH CHECK (
    organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.has_tenant_admin_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY prompt_settings_tenant_select
  ON public.prompt_settings
  FOR SELECT
  TO claims_iq_tenant_api
  USING (
    organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY prompt_settings_tenant_admin
  ON public.prompt_settings
  FOR ALL
  TO claims_iq_tenant_api
  USING ((SELECT private.has_tenant_admin_access(organization_id)))
  WITH CHECK (
    organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.has_tenant_admin_access(
      private.current_organization_id()
    ))
  );

DO $tenant_profile_policies$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'carrier_entities',
    'carrier_rulesets',
    'carrier_ruleset_versions'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO claims_iq_tenant_api USING (
        organization_id = (SELECT private.current_organization_id())
        AND (SELECT private.has_tenant_access(private.current_organization_id()))
      )',
      'tenant_' || relation_name || '_select',
      relation_name
    );

    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO claims_iq_worker USING (
        organization_id = (SELECT private.current_organization_id())
        AND (SELECT private.worker_has_job_access(private.current_organization_id()))
      )',
      'worker_' || relation_name || '_select',
      relation_name
    );
  END LOOP;
END
$tenant_profile_policies$;

DO $tenant_mutable_graph_policies$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'claims',
    'documents',
    'audit_findings',
    'evidence_anchors'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR ALL TO claims_iq_tenant_api USING (
        organization_id = (SELECT private.current_organization_id())
        AND (SELECT private.has_tenant_access(private.current_organization_id()))
      ) WITH CHECK (
        organization_id = (SELECT private.current_organization_id())
        AND (SELECT private.has_tenant_access(private.current_organization_id()))
      )',
      'tenant_' || relation_name || '_access',
      relation_name
    );
  END LOOP;
END
$tenant_mutable_graph_policies$;

CREATE POLICY processing_jobs_tenant_select
  ON public.processing_jobs
  FOR SELECT
  TO claims_iq_tenant_api
  USING (
    organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY processing_jobs_tenant_insert
  ON public.processing_jobs
  FOR INSERT
  TO claims_iq_tenant_api
  WITH CHECK (
    organization_id = (SELECT private.current_organization_id())
    AND status = 'queued'::public.processing_job_state
    AND stage = 'uploaded'::public.processing_job_stage
    AND progress = 0
    AND attempt_count = 0
    AND lease_owner IS NULL
    AND lease_expires_at IS NULL
    AND heartbeat_at IS NULL
    AND started_at IS NULL
    AND completed_at IS NULL
    AND cancelled_at IS NULL
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY processing_jobs_tenant_update
  ON public.processing_jobs
  FOR UPDATE
  TO claims_iq_tenant_api
  USING (
    organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  )
  WITH CHECK (
    organization_id = (SELECT private.current_organization_id())
    AND (
      (
        status = 'queued'::public.processing_job_state
        AND stage = 'uploaded'::public.processing_job_stage
        AND progress = 0
        AND completed_at IS NULL
        AND cancelled_at IS NULL
      )
      OR
      (
        status = 'cancelled'::public.processing_job_state
        AND stage = 'cancelled'::public.processing_job_stage
        AND completed_at IS NOT NULL
        AND cancelled_at IS NOT NULL
      )
    )
    AND lease_owner IS NULL
    AND lease_expires_at IS NULL
    AND heartbeat_at IS NULL
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY processing_job_attempts_tenant_select
  ON public.processing_job_attempts
  FOR SELECT
  TO claims_iq_tenant_api
  USING (
    organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.has_tenant_access(
      private.current_organization_id()
    ))
  );

DO $tenant_append_graph_policies$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'audit_runs',
    'audits',
    'audit_sections',
    'audit_structured',
    'audit_versions',
    'claim_activity'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO claims_iq_tenant_api USING (
        organization_id = (SELECT private.current_organization_id())
        AND (SELECT private.has_tenant_access(private.current_organization_id()))
      )',
      'tenant_' || relation_name || '_select',
      relation_name
    );

    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO claims_iq_tenant_api WITH CHECK (
        organization_id = (SELECT private.current_organization_id())
        AND (SELECT private.has_tenant_access(private.current_organization_id()))
      )',
      'tenant_' || relation_name || '_insert',
      relation_name
    );
  END LOOP;
END
$tenant_append_graph_policies$;

DO $worker_graph_policies$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'claims',
    'documents',
    'audit_runs',
    'audits',
    'audit_sections',
    'audit_findings',
    'audit_structured',
    'audit_versions',
    'evidence_anchors',
    'claim_activity'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR ALL TO claims_iq_worker USING (
        organization_id = (SELECT private.current_organization_id())
        AND (SELECT private.worker_has_job_access(private.current_organization_id()))
      ) WITH CHECK (
        organization_id = (SELECT private.current_organization_id())
        AND (SELECT private.worker_has_job_access(private.current_organization_id()))
      )',
      'worker_' || relation_name || '_access',
      relation_name
    );
  END LOOP;
END
$worker_graph_policies$;

CREATE POLICY prompt_settings_worker_select
  ON public.prompt_settings
  FOR SELECT
  TO claims_iq_worker
  USING (
    organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.worker_has_job_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY processing_jobs_worker_select
  ON public.processing_jobs
  FOR SELECT
  TO claims_iq_worker
  USING (
    id = (SELECT private.current_job_id())
    AND organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.worker_has_job_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY processing_job_attempts_worker_select
  ON public.processing_job_attempts
  FOR SELECT
  TO claims_iq_worker
  USING (
    job_id = (SELECT private.current_job_id())
    AND organization_id = (SELECT private.current_organization_id())
    AND (SELECT private.worker_has_job_access(
      private.current_organization_id()
    ))
  );

CREATE POLICY platform_tenant_access_leases_context_select
  ON public.platform_tenant_access_leases
  FOR SELECT
  TO claims_iq_tenant_api
  USING (
    organization_id = (SELECT private.current_organization_id())
    AND platform_user_id = (SELECT private.current_user_id())
    AND session_id = (SELECT private.current_session_id())
    AND (SELECT private.is_platform_admin_session())
  );

CREATE POLICY platform_audit_events_context_select
  ON public.platform_audit_events
  FOR SELECT
  TO claims_iq_tenant_api
  USING (
    organization_id = (SELECT private.current_organization_id())
    AND actor_user_id = (SELECT private.current_user_id())
    AND session_id = (SELECT private.current_session_id())
    AND (SELECT private.is_platform_admin_session())
  );

GRANT USAGE ON SCHEMA public TO
  claims_iq_identity,
  claims_iq_tenant_api,
  claims_iq_worker;
GRANT USAGE ON SCHEMA private TO
  claims_iq_identity,
  claims_iq_tenant_api,
  claims_iq_worker,
  claims_iq_platform_admin;

GRANT SELECT ON TABLE public.users TO claims_iq_identity;
GRANT INSERT (
  email,
  password_hash,
  first_name,
  last_name,
  profile_image_url,
  email_verified_at
) ON public.users TO claims_iq_identity;
GRANT UPDATE (
  password_hash,
  auth_version,
  password_changed_at,
  email_verified_at,
  updated_at
) ON public.users TO claims_iq_identity;
GRANT SELECT ON TABLE public.sessions TO claims_iq_identity;
GRANT INSERT (sid, sess, expire, user_id, auth_version)
  ON public.sessions TO claims_iq_identity;
GRANT UPDATE (sess) ON public.sessions TO claims_iq_identity;
GRANT DELETE ON TABLE public.sessions TO claims_iq_identity;
GRANT SELECT ON TABLE public.password_reset_tokens TO claims_iq_identity;
GRANT INSERT (
  user_id,
  token_hash,
  requested_by_user_id,
  requested_for_organization_id,
  expires_at,
  auth_version
) ON public.password_reset_tokens TO claims_iq_identity;
GRANT UPDATE (used_at, revoked_at)
  ON public.password_reset_tokens TO claims_iq_identity;
GRANT SELECT (id, name)
  ON public.organizations TO claims_iq_identity;
GRANT SELECT ON TABLE public.organization_memberships
  TO claims_iq_identity;
GRANT INSERT (organization_id, user_id, role, is_default)
  ON public.organization_memberships TO claims_iq_identity;
GRANT SELECT ON TABLE public.organization_invitations
  TO claims_iq_identity;
GRANT UPDATE (accepted_by_user_id, accepted_at, updated_at)
  ON public.organization_invitations TO claims_iq_identity;
GRANT INSERT (
  organization_id,
  actor_user_id,
  event_type,
  target_type,
  target_id,
  metadata
) ON public.organization_audit_events TO claims_iq_identity;

GRANT SELECT (
  id,
  email,
  first_name,
  last_name,
  profile_image_url,
  role,
  email_verified_at,
  created_at,
  updated_at
) ON public.users TO claims_iq_tenant_api;
GRANT UPDATE (
  first_name,
  last_name,
  profile_image_url,
  updated_at
) ON public.users TO claims_iq_tenant_api;

GRANT SELECT ON TABLE
  public.organizations,
  public.organization_memberships,
  public.organization_invitations,
  public.saved_views,
  public.organization_audit_events,
  public.organization_settings,
  public.carrier_entities,
  public.carrier_rulesets,
  public.carrier_ruleset_versions,
  public.claims,
  public.documents,
  public.processing_jobs,
  public.processing_job_attempts,
  public.audit_runs,
  public.audits,
  public.audit_sections,
  public.audit_findings,
  public.audit_structured,
  public.audit_versions,
  public.evidence_anchors,
  public.claim_activity,
  public.prompt_settings
  TO claims_iq_tenant_api;

GRANT UPDATE (name, slug, updated_at)
  ON public.organizations TO claims_iq_tenant_api;
GRANT INSERT, UPDATE, DELETE
  ON TABLE
    public.organization_memberships,
    public.organization_invitations,
    public.saved_views
  TO claims_iq_tenant_api;
GRANT INSERT ON TABLE public.organization_audit_events
  TO claims_iq_tenant_api;
GRANT INSERT, UPDATE ON TABLE public.organization_settings
  TO claims_iq_tenant_api;
GRANT INSERT, UPDATE, DELETE ON TABLE public.prompt_settings
  TO claims_iq_tenant_api;
GRANT INSERT, UPDATE, DELETE ON TABLE
  public.claims,
  public.documents
  TO claims_iq_tenant_api;
GRANT INSERT, UPDATE ON TABLE
  public.audit_findings,
  public.evidence_anchors
  TO claims_iq_tenant_api;
GRANT INSERT ON TABLE
  public.audit_runs,
  public.audits,
  public.audit_sections,
  public.audit_structured,
  public.audit_versions,
  public.claim_activity
  TO claims_iq_tenant_api;
GRANT INSERT ON TABLE public.processing_jobs
  TO claims_iq_tenant_api;
GRANT UPDATE (
  status,
  stage,
  progress,
  available_at,
  completed_at,
  cancelled_at,
  lease_owner,
  lease_expires_at,
  heartbeat_at,
  error_code,
  error_message,
  error_metadata,
  max_attempts,
  updated_at
) ON public.processing_jobs TO claims_iq_tenant_api;

GRANT SELECT ON TABLE
  public.carrier_entities,
  public.carrier_rulesets,
  public.carrier_ruleset_versions,
  public.claims,
  public.documents,
  public.processing_jobs,
  public.processing_job_attempts,
  public.audit_runs,
  public.audits,
  public.audit_sections,
  public.audit_findings,
  public.audit_structured,
  public.audit_versions,
  public.evidence_anchors,
  public.claim_activity,
  public.prompt_settings
  TO claims_iq_worker;
GRANT UPDATE ON TABLE public.claims, public.documents
  TO claims_iq_worker;
GRANT INSERT ON TABLE
  public.audit_runs,
  public.audits,
  public.audit_sections,
  public.audit_structured,
  public.audit_versions,
  public.claim_activity
  TO claims_iq_worker;
GRANT INSERT, UPDATE ON TABLE
  public.audit_findings,
  public.evidence_anchors
  TO claims_iq_worker;

GRANT EXECUTE ON FUNCTION private.current_user_id()
  TO claims_iq_tenant_api;
GRANT EXECUTE ON FUNCTION private.current_session_id()
  TO claims_iq_tenant_api;
GRANT EXECUTE ON FUNCTION private.current_organization_id()
  TO claims_iq_tenant_api, claims_iq_worker;
GRANT EXECUTE ON FUNCTION private.current_job_id()
  TO claims_iq_worker;
GRANT EXECUTE ON FUNCTION private.current_worker_id()
  TO claims_iq_worker;
GRANT EXECUTE ON FUNCTION private.has_tenant_access(uuid)
  TO claims_iq_tenant_api;
GRANT EXECUTE ON FUNCTION private.has_tenant_admin_access(uuid)
  TO claims_iq_tenant_api;
GRANT EXECUTE ON FUNCTION private.can_view_user(text)
  TO claims_iq_tenant_api;
GRANT EXECUTE ON FUNCTION private.is_platform_admin_session()
  TO claims_iq_tenant_api, claims_iq_platform_admin;
GRANT EXECUTE ON FUNCTION private.worker_has_job_access(uuid)
  TO claims_iq_worker;
GRANT EXECUTE ON FUNCTION private.identity_invitation_is_active(uuid)
  TO claims_iq_identity;
GRANT EXECUTE ON FUNCTION private.identity_can_accept_membership(
  uuid,
  text,
  public.organization_role
) TO claims_iq_identity;
GRANT EXECUTE ON FUNCTION private.identity_can_mark_invitation_accepted(
  uuid,
  text,
  public.organization_role,
  text,
  timestamptz,
  timestamptz
) TO claims_iq_identity;
GRANT EXECUTE ON FUNCTION
  private.identity_can_insert_organization_audit_event(
    uuid,
    text,
    text,
    text,
    text,
    jsonb
  )
  TO claims_iq_identity;

GRANT EXECUTE ON FUNCTION private.claim_processing_job(integer)
  TO claims_iq_worker;
GRANT EXECUTE ON FUNCTION private.heartbeat_processing_job(
  integer,
  public.processing_job_stage,
  integer
) TO claims_iq_worker;
GRANT EXECUTE ON FUNCTION private.complete_processing_job(
  public.processing_job_state,
  jsonb
) TO claims_iq_worker;
GRANT EXECUTE ON FUNCTION private.fail_processing_job(text, text, jsonb)
  TO claims_iq_worker;

GRANT EXECUTE ON FUNCTION private.platform_list_tenant_summaries()
  TO claims_iq_platform_admin;
GRANT EXECUTE ON FUNCTION private.platform_create_tenant_access(
  uuid,
  text,
  interval
) TO claims_iq_platform_admin;
GRANT EXECUTE ON FUNCTION private.platform_revoke_tenant_access(
  uuid,
  text
) TO claims_iq_platform_admin;
GRANT EXECUTE ON FUNCTION private.platform_upsert_carrier_profile(
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text
) TO claims_iq_platform_admin;
GRANT EXECUTE ON FUNCTION private.platform_upsert_carrier_entity(
  uuid,
  uuid,
  text,
  text,
  text,
  boolean,
  boolean,
  text
) TO claims_iq_platform_admin;
GRANT EXECUTE ON FUNCTION private.platform_create_carrier_ruleset_version(
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb,
  text,
  jsonb,
  text
) TO claims_iq_platform_admin;
GRANT EXECUTE ON FUNCTION private.platform_publish_carrier_ruleset_version(
  uuid,
  uuid,
  text
) TO claims_iq_platform_admin;

DO $runtime_role_safety$
DECLARE
  unsafe_role text;
BEGIN
  SELECT runtime_role.rolname
  INTO unsafe_role
  FROM pg_catalog.pg_roles AS runtime_role
  WHERE runtime_role.rolname IN (
      'claims_iq_identity',
      'claims_iq_tenant_api',
      'claims_iq_worker',
      'claims_iq_platform_admin'
    )
    AND (
      runtime_role.rolcanlogin
      OR runtime_role.rolsuper
      OR runtime_role.rolcreatedb
      OR runtime_role.rolcreaterole
      OR runtime_role.rolreplication
      OR runtime_role.rolbypassrls
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members AS inherited_membership
        WHERE inherited_membership.member = runtime_role.oid
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname IN ('public', 'private')
          AND relation.relowner = runtime_role.oid
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS privileged_role
        WHERE (
          privileged_role.rolsuper
          OR privileged_role.rolbypassrls
        )
          AND pg_catalog.pg_has_role(
            runtime_role.oid,
            privileged_role.oid,
            'MEMBER'
          )
      )
    )
  LIMIT 1;

  IF unsafe_role IS NOT NULL THEN
    RAISE EXCEPTION 'Runtime role % violates least-privilege invariants',
      unsafe_role
      USING ERRCODE = '42501';
  END IF;
END
$runtime_role_safety$;

COMMIT;
