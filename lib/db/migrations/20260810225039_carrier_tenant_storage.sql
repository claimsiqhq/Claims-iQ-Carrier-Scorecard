-- Tenant-scoped Supabase Storage and authenticated inbound-email boundaries.
--
-- Runtime code uses a publishable key plus a short-lived, server-signed
-- authenticated JWT. The service-role key is deliberately not part of this
-- runtime design.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $required_storage_schema$
BEGIN
  IF pg_catalog.to_regclass('storage.buckets') IS NULL
     OR pg_catalog.to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION
      'Supabase Storage must be installed before carrier tenant storage';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'authenticated'
  ) THEN
    RAISE EXCEPTION
      'The Supabase authenticated database role is required';
  END IF;
END
$required_storage_schema$;

DO $claim_documents_bucket$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE name = 'claim-documents'
      AND id <> 'claim-documents'
  ) THEN
    RAISE EXCEPTION
      'A conflicting claim-documents bucket name already exists';
  END IF;

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
  ON CONFLICT (id)
  DO UPDATE SET
    name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'claim-documents'
      AND name = 'claim-documents'
      AND public = false
      AND file_size_limit = 104857600
  ) THEN
    RAISE EXCEPTION
      'The claim-documents bucket could not be validated as private';
  END IF;
END
$claim_documents_bucket$;

DO $migration_quarantine_bucket$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE name = 'carrier-tenant-migration-quarantine'
      AND id <> 'carrier-tenant-migration-quarantine'
  ) THEN
    RAISE EXCEPTION
      'A conflicting carrier-tenant-migration-quarantine bucket name already exists';
  END IF;

  INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit
  )
  VALUES (
    'carrier-tenant-migration-quarantine',
    'carrier-tenant-migration-quarantine',
    false,
    104857600
  )
  ON CONFLICT (id)
  DO UPDATE SET
    name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'carrier-tenant-migration-quarantine'
      AND name = 'carrier-tenant-migration-quarantine'
      AND public = false
      AND file_size_limit = 104857600
  ) THEN
    RAISE EXCEPTION
      'The carrier tenant migration quarantine bucket could not be validated as private';
  END IF;
END
$migration_quarantine_bucket$;

CREATE TABLE IF NOT EXISTS private.carrier_tenant_storage_manifest (
  source_bucket text NOT NULL,
  source_path text NOT NULL,
  destination_bucket text NOT NULL,
  destination_path text NOT NULL,
  disposition text NOT NULL,
  document_id uuid,
  organization_id uuid,
  claim_id uuid,
  source_size bigint NOT NULL,
  source_sha256 varchar(64) NOT NULL,
  destination_size bigint NOT NULL,
  destination_sha256 varchar(64) NOT NULL,
  copied_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL,
  source_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_carrier_tenant_storage_manifest
    PRIMARY KEY (source_bucket, source_path),
  CONSTRAINT uq_carrier_tenant_storage_manifest_destination
    UNIQUE (destination_bucket, destination_path),
  CONSTRAINT ck_carrier_tenant_storage_manifest_disposition
    CHECK (disposition IN ('referenced', 'quarantine')),
  CONSTRAINT ck_carrier_tenant_storage_manifest_paths
    CHECK (
      nullif(btrim(source_bucket), '') IS NOT NULL
      AND nullif(btrim(source_path), '') IS NOT NULL
      AND nullif(btrim(destination_bucket), '') IS NOT NULL
      AND nullif(btrim(destination_path), '') IS NOT NULL
    ),
  CONSTRAINT ck_carrier_tenant_storage_manifest_hashes
    CHECK (
      source_sha256 ~ '^[0-9a-f]{64}$'
      AND destination_sha256 ~ '^[0-9a-f]{64}$'
      AND source_sha256 = destination_sha256
      AND source_size >= 0
      AND source_size = destination_size
    ),
  CONSTRAINT ck_carrier_tenant_storage_manifest_ownership
    CHECK (
      (
        disposition = 'referenced'
        AND document_id IS NOT NULL
        AND organization_id IS NOT NULL
        AND claim_id IS NOT NULL
        AND destination_bucket = 'claim-documents'
      )
      OR
      (
        disposition = 'quarantine'
        AND document_id IS NULL
        AND organization_id IS NULL
        AND claim_id IS NULL
        AND destination_bucket =
          'carrier-tenant-migration-quarantine'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  uq_carrier_tenant_storage_manifest_document
  ON private.carrier_tenant_storage_manifest (document_id)
  WHERE disposition = 'referenced';

CREATE TABLE IF NOT EXISTS private.carrier_tenant_storage_runs (
  run_key text PRIMARY KEY,
  source_bucket text NOT NULL,
  referenced_count integer NOT NULL,
  quarantine_count integer NOT NULL,
  inventory_count integer NOT NULL,
  inventory_sha256 varchar(64) NOT NULL,
  copy_completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_carrier_tenant_storage_runs_key
    CHECK (run_key = 'carrier-tenant-cutover-v1'),
  CONSTRAINT ck_carrier_tenant_storage_runs_counts
    CHECK (
      referenced_count >= 0
      AND quarantine_count >= 0
      AND inventory_count =
        referenced_count + quarantine_count
    ),
  CONSTRAINT ck_carrier_tenant_storage_runs_hash
    CHECK (inventory_sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE private.carrier_tenant_storage_manifest IS
  'Migration-only durable copy manifest. Normal runtime roles receive no access.';
COMMENT ON TABLE private.carrier_tenant_storage_runs IS
  'Completed carrier tenant storage inventories that gate the data cutover.';

REVOKE ALL
  ON TABLE
    private.carrier_tenant_storage_manifest,
    private.carrier_tenant_storage_runs
  FROM PUBLIC;

DO $revoke_migration_manifest_data_api$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon'
  ) THEN
    REVOKE ALL
      ON TABLE
        private.carrier_tenant_storage_manifest,
        private.carrier_tenant_storage_runs
      FROM anon;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'
  ) THEN
    REVOKE ALL
      ON TABLE
        private.carrier_tenant_storage_manifest,
        private.carrier_tenant_storage_runs
      FROM authenticated;
  END IF;
END
$revoke_migration_manifest_data_api$;

CREATE OR REPLACE FUNCTION storage.claim_document_path_is_authorized(
  object_name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  claims jsonb;
  path_segments text[];
  expires_at numeric;
BEGIN
  claims := auth.jwt();
  path_segments := pg_catalog.string_to_array(object_name, '/');

  IF claims IS NULL
     OR pg_catalog.jsonb_typeof(claims) <> 'object'
     OR claims ->> 'role' <> 'authenticated'
     OR NULLIF(claims ->> 'sub', '') IS NULL
     OR claims ->> 'user_id' <> claims ->> 'sub'
     OR NULLIF(claims ->> 'session_id', '') IS NULL
     OR pg_catalog.length(claims ->> 'session_id') > 512
     OR (claims ->> 'organization_id') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR (claims ->> 'exp') !~ '^[0-9]{1,12}$' THEN
    RETURN false;
  END IF;

  expires_at := (claims ->> 'exp')::numeric;
  IF expires_at <= EXTRACT(
       EPOCH FROM pg_catalog.statement_timestamp()
     ) THEN
    RETURN false;
  END IF;

  RETURN object_name IS NOT NULL
    AND pg_catalog.length(object_name) <= 1024
    AND object_name !~ '[[:cntrl:]]'
    AND pg_catalog.strpos(object_name, E'\\') = 0
    AND object_name !~ '%[0-9A-Fa-f]{2}'
    AND pg_catalog.array_length(path_segments, 1) = 7
    AND path_segments[1] = 'organizations'
    AND path_segments[2] = claims ->> 'organization_id'
    AND path_segments[3] = 'claims'
    AND path_segments[4] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND path_segments[5] = 'documents'
    AND path_segments[6] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND path_segments[7] ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$'
    AND path_segments[7] NOT IN ('.', '..');
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END
$function$;

REVOKE ALL ON FUNCTION storage.claim_document_path_is_authorized(text)
  FROM PUBLIC;
GRANT EXECUTE
  ON FUNCTION storage.claim_document_path_is_authorized(text)
  TO authenticated;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Any permissive policy granted to a Data API role can combine with another
-- permissive policy and expose this bucket. Remove those policies first,
-- including policies created outside this repository, then install the
-- complete claim-document policy set.
DO $drop_permissive_storage_policies$
DECLARE
  existing_policy text;
BEGIN
  FOR existing_policy IN
    SELECT policy.policyname
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
      AND policy.permissive = 'PERMISSIVE'
      AND policy.roles
        && ARRAY['public', 'anon', 'authenticated']::name[]
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON storage.objects',
      existing_policy
    );
  END LOOP;
END
$drop_permissive_storage_policies$;

DROP POLICY IF EXISTS claim_documents_tenant_select
  ON storage.objects;
DROP POLICY IF EXISTS claim_documents_tenant_insert
  ON storage.objects;
DROP POLICY IF EXISTS claim_documents_tenant_update
  ON storage.objects;
DROP POLICY IF EXISTS claim_documents_tenant_delete
  ON storage.objects;

CREATE POLICY claim_documents_tenant_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'claim-documents'
    AND (
      SELECT storage.claim_document_path_is_authorized(name)
    )
  );

CREATE POLICY claim_documents_tenant_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'claim-documents'
    AND (
      SELECT storage.claim_document_path_is_authorized(name)
    )
  );

CREATE POLICY claim_documents_tenant_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'claim-documents'
    AND (
      SELECT storage.claim_document_path_is_authorized(name)
    )
  )
  WITH CHECK (
    bucket_id = 'claim-documents'
    AND (
      SELECT storage.claim_document_path_is_authorized(name)
    )
  );

CREATE POLICY claim_documents_tenant_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'claim-documents'
    AND (
      SELECT storage.claim_document_path_is_authorized(name)
    )
  );

CREATE OR REPLACE FUNCTION private.enforce_claim_document_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  path_segments text[];
BEGIN
  IF NEW.file_url IS NULL THEN
    RETURN NEW;
  END IF;

  path_segments := pg_catalog.string_to_array(NEW.file_url, '/');
  IF NEW.claim_id IS NULL
     OR pg_catalog.array_length(path_segments, 1) <> 7
     OR path_segments[1] <> 'organizations'
     OR path_segments[2] <> NEW.organization_id::text
     OR path_segments[3] <> 'claims'
     OR path_segments[4] <> NEW.claim_id::text
     OR path_segments[5] <> 'documents'
     OR path_segments[6] <> NEW.id::text
     OR path_segments[7] !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$'
     OR path_segments[7] IN ('.', '..')
     OR NEW.file_url ~ '[[:cntrl:]]'
     OR pg_catalog.strpos(NEW.file_url, E'\\') > 0
     OR NEW.file_url ~ '%[0-9A-Fa-f]{2}' THEN
    RAISE EXCEPTION
      'Document storage path does not match its organization/claim/document tuple'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.metadata IS NULL
     OR pg_catalog.jsonb_typeof(NEW.metadata) <> 'object'
     OR NEW.metadata ->> 'organizationId' <> NEW.organization_id::text
     OR NEW.metadata ->> 'claimId' <> NEW.claim_id::text
     OR NEW.metadata ->> 'documentId' <> NEW.id::text
     OR NEW.metadata ->> 'storagePath' <> NEW.file_url THEN
    RAISE EXCEPTION
      'Document storage metadata does not match its ownership tuple'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects AS object_record
    WHERE object_record.bucket_id = 'claim-documents'
      AND object_record.name = NEW.file_url
  ) THEN
    RAISE EXCEPTION
      'Document storage object must exist before database registration'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.enforce_claim_document_registration()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_enforce_claim_document_registration
  ON public.documents;
CREATE TRIGGER trg_enforce_claim_document_registration
BEFORE INSERT OR UPDATE OF
  id,
  organization_id,
  claim_id,
  file_url,
  metadata
ON public.documents
FOR EACH ROW
EXECUTE FUNCTION private.enforce_claim_document_registration();

CREATE TABLE IF NOT EXISTS public.inbound_email_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,
  recipient_address text NOT NULL,
  route_key_hash varchar(64) NOT NULL,
  webhook_secret_hash varchar(64) NOT NULL,
  provider_public_key text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_inbound_email_routes_org_id
    UNIQUE (organization_id, id),
  CONSTRAINT uq_inbound_email_routes_recipient
    UNIQUE (recipient_address),
  CONSTRAINT uq_inbound_email_routes_route_key_hash
    UNIQUE (route_key_hash),
  CONSTRAINT ck_inbound_email_routes_recipient_normalized
    CHECK (
      recipient_address = lower(btrim(recipient_address))
      AND recipient_address ~
        '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    ),
  CONSTRAINT ck_inbound_email_routes_hashes
    CHECK (
      route_key_hash ~ '^[0-9a-f]{64}$'
      AND webhook_secret_hash ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT ck_inbound_email_routes_public_key
    CHECK (nullif(btrim(provider_public_key), '') IS NOT NULL)
);

COMMENT ON TABLE public.inbound_email_routes IS
  'Migration-managed tenant-specific SendGrid routes. Store only SHA-256 route/secret hashes and the route security-policy public key.';
COMMENT ON COLUMN public.inbound_email_routes.recipient_address IS
  'Exact tenant-specific recipient accepted for this route; sender content never selects tenancy.';

CREATE TABLE IF NOT EXISTS public.inbound_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,
  route_id uuid NOT NULL,
  provider_message_id text NOT NULL,
  sender_email text NOT NULL,
  recipient_address text NOT NULL,
  requested_by_user_id varchar NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  claim_id uuid NOT NULL,
  document_id uuid NOT NULL,
  processing_job_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  subject text,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_inbound_email_deliveries_provider_message
    UNIQUE (route_id, provider_message_id),
  CONSTRAINT fk_inbound_email_deliveries_route_tenant
    FOREIGN KEY (organization_id, route_id)
    REFERENCES public.inbound_email_routes(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_inbound_email_deliveries_claim_tenant
    FOREIGN KEY (organization_id, claim_id)
    REFERENCES public.claims(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_inbound_email_deliveries_document_tenant
    FOREIGN KEY (organization_id, document_id)
    REFERENCES public.documents(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_inbound_email_deliveries_job_tenant
    FOREIGN KEY (organization_id, processing_job_id)
    REFERENCES public.processing_jobs(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_inbound_email_deliveries_status
    CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  CONSTRAINT ck_inbound_email_deliveries_message_id
    CHECK (
      nullif(btrim(provider_message_id), '') IS NOT NULL
      AND length(provider_message_id) <= 998
      AND provider_message_id !~ '[[:cntrl:]]'
    ),
  CONSTRAINT ck_inbound_email_deliveries_addresses
    CHECK (
      sender_email = lower(btrim(sender_email))
      AND recipient_address = lower(btrim(recipient_address))
    )
);

CREATE INDEX IF NOT EXISTS idx_inbound_email_deliveries_org_received
  ON public.inbound_email_deliveries (organization_id, received_at);
CREATE INDEX IF NOT EXISTS idx_inbound_email_deliveries_job
  ON public.inbound_email_deliveries (
    organization_id,
    processing_job_id
  );

CREATE OR REPLACE FUNCTION private.resolve_inbound_email_route(
  requested_route_key_hash text,
  requested_webhook_secret_hash text
)
RETURNS TABLE (
  route_id uuid,
  organization_id uuid,
  recipient_address text,
  provider_public_key text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    route.id,
    route.organization_id,
    route.recipient_address,
    route.provider_public_key
  FROM public.inbound_email_routes AS route
  WHERE route.active
    AND route.route_key_hash = requested_route_key_hash
    AND route.webhook_secret_hash = requested_webhook_secret_hash
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION private.authorize_inbound_email_sender(
  requested_route_id uuid,
  requested_sender_email text
)
RETURNS TABLE (
  organization_id uuid,
  user_id text,
  auth_version integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    route.organization_id,
    app_user.id,
    app_user.auth_version
  FROM public.inbound_email_routes AS route
  JOIN public.organization_memberships AS membership
    ON membership.organization_id = route.organization_id
  JOIN public.users AS app_user
    ON app_user.id = membership.user_id
  WHERE route.id = requested_route_id
    AND route.active
    AND pg_catalog.lower(pg_catalog.btrim(app_user.email)) =
      pg_catalog.lower(pg_catalog.btrim(requested_sender_email))
    AND app_user.email_verified_at IS NOT NULL
    AND membership.permissions ? 'email:ingest'
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION private.resolve_inbound_email_route(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION private.authorize_inbound_email_sender(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE
  ON FUNCTION private.resolve_inbound_email_route(text, text)
  TO claims_iq_identity;
GRANT EXECUTE
  ON FUNCTION private.authorize_inbound_email_sender(uuid, text)
  TO claims_iq_identity;

ALTER TABLE public.inbound_email_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_email_routes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_email_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_email_deliveries FORCE ROW LEVEL SECURITY;

DO $drop_inbound_email_policies$
DECLARE
  relation_name text;
  existing_policy text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'inbound_email_routes',
    'inbound_email_deliveries'
  ]
  LOOP
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
  END LOOP;
END
$drop_inbound_email_policies$;

CREATE POLICY inbound_email_deliveries_tenant_select
  ON public.inbound_email_deliveries
  FOR SELECT
  TO claims_iq_tenant_api
  USING (
    organization_id = (
      SELECT private.current_organization_id()
    )
    AND (
      SELECT private.has_tenant_access(
        private.current_organization_id()
      )
    )
  );

CREATE POLICY inbound_email_deliveries_tenant_insert
  ON public.inbound_email_deliveries
  FOR INSERT
  TO claims_iq_tenant_api
  WITH CHECK (
    organization_id = (
      SELECT private.current_organization_id()
    )
    AND requested_by_user_id = (
      SELECT private.current_user_id()
    )
    AND status = 'queued'
    AND (
      SELECT private.has_tenant_access(
        private.current_organization_id()
      )
    )
  );

CREATE POLICY inbound_email_deliveries_worker_access
  ON public.inbound_email_deliveries
  FOR ALL
  TO claims_iq_worker
  USING (
    organization_id = (
      SELECT private.current_organization_id()
    )
    AND processing_job_id = (
      SELECT private.current_job_id()
    )
    AND (
      SELECT private.worker_has_job_access(
        private.current_organization_id()
      )
    )
  )
  WITH CHECK (
    organization_id = (
      SELECT private.current_organization_id()
    )
    AND processing_job_id = (
      SELECT private.current_job_id()
    )
    AND (
      SELECT private.worker_has_job_access(
        private.current_organization_id()
      )
    )
  );

REVOKE ALL PRIVILEGES
  ON TABLE
    public.inbound_email_routes,
    public.inbound_email_deliveries
  FROM PUBLIC;

DO $revoke_inbound_data_api$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon'
  ) THEN
    REVOKE ALL PRIVILEGES
      ON TABLE
        public.inbound_email_routes,
        public.inbound_email_deliveries
      FROM anon;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'
  ) THEN
    REVOKE ALL PRIVILEGES
      ON TABLE
        public.inbound_email_routes,
        public.inbound_email_deliveries
      FROM authenticated;
  END IF;
END
$revoke_inbound_data_api$;

GRANT SELECT, INSERT
  ON TABLE public.inbound_email_deliveries
  TO claims_iq_tenant_api;
GRANT SELECT, UPDATE
  ON TABLE public.inbound_email_deliveries
  TO claims_iq_worker;

COMMIT;
