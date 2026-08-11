-- Carrier tenant isolation: schema foundation (expand phase).
--
-- This migration deliberately does not create the Allstate, Andover, or
-- Wawanesa organizations and does not re-home production rows. The later
-- cutover migration must populate ownership columns, move each complete claim
-- graph, and validate the NOT VALID constraints added here.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $$
BEGIN
  CREATE TYPE public.platform_role AS ENUM ('platform_admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS platform_role public.platform_role;

COMMENT ON COLUMN public.users.role IS
  'Legacy application role. Tenant authorization comes from organization_memberships; cross-tenant authority comes only from platform_role.';
COMMENT ON COLUMN public.users.platform_role IS
  'Nullable platform-plane role. platform_admin is distinct from every tenant membership role.';

ALTER TABLE public.carrier_rulesets
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.carrier_ruleset_versions
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS carrier_entity_id uuid;

COMMENT ON COLUMN public.carrier_rulesets.organization_id IS
  'Carrier-profile owner. Nullable only during the expand/cutover window.';
COMMENT ON COLUMN public.carrier_ruleset_versions.organization_id IS
  'Tenant owner copied from the parent carrier ruleset. Nullable only during the expand/cutover window.';
COMMENT ON COLUMN public.claims.carrier_entity_id IS
  'Authoritative tenant-owned carrier entity. Populated by the later carrier cutover.';
COMMENT ON COLUMN public.claims.carrier IS
  'Historical/source display snapshot; never authoritative for tenant or ruleset selection.';

CREATE TABLE IF NOT EXISTS public.carrier_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,
  entity_key text NOT NULL,
  display_name text NOT NULL,
  legal_name text,
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.carrier_entities IS
  'Tenant-owned legal/brand entities. Cutover keys: allstate; andover; bay-state-insurance-company; cambridge-mutual; merrimack-mutual; wawanesa.';
COMMENT ON COLUMN public.carrier_entities.entity_key IS
  'Stable normalized key scoped to one organization; display names may change without changing this key.';

CREATE TABLE IF NOT EXISTS public.platform_tenant_access_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,
  platform_user_id varchar NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  session_id varchar NOT NULL,
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by_user_id varchar
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,
  actor_user_id varchar NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  session_id varchar NOT NULL,
  access_lease_id uuid,
  event_type text NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_tenant_access_leases IS
  'Short-lived, reason-required tenant access bound to one authenticated platform-admin session.';
COMMENT ON TABLE public.platform_audit_events IS
  'Append-only platform-plane audit history. Actor references do not depend on tenant membership.';

-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS. Keep reruns safe by checking
-- each table-local constraint explicitly.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT *
    FROM (
      VALUES
        ('sessions', 'uq_sessions_user_sid', 'UNIQUE (user_id, sid)'),
        ('organization_memberships', 'uq_organization_memberships_org_id', 'UNIQUE (organization_id, id)'),
        ('organization_invitations', 'uq_organization_invitations_org_id', 'UNIQUE (organization_id, id)'),
        ('saved_views', 'uq_saved_views_org_id', 'UNIQUE (organization_id, id)'),
        ('organization_audit_events', 'uq_organization_audit_events_org_id', 'UNIQUE (organization_id, id)'),
        ('carrier_entities', 'uq_carrier_entities_org_id', 'UNIQUE (organization_id, id)'),
        ('carrier_entities', 'uq_carrier_entities_org_key', 'UNIQUE (organization_id, entity_key)'),
        ('carrier_rulesets', 'uq_carrier_rulesets_org_id', 'UNIQUE (organization_id, id)'),
        ('carrier_rulesets', 'uq_carrier_rulesets_organization', 'UNIQUE (organization_id)'),
        ('carrier_rulesets', 'uq_carrier_rulesets_org_key', 'UNIQUE (organization_id, carrier_key)'),
        ('carrier_ruleset_versions', 'uq_carrier_ruleset_versions_org_id', 'UNIQUE (organization_id, id)'),
        ('claims', 'uq_claims_org_id', 'UNIQUE (organization_id, id)'),
        ('documents', 'uq_documents_org_id', 'UNIQUE (organization_id, id)'),
        ('processing_jobs', 'uq_processing_jobs_org_id', 'UNIQUE (organization_id, id)'),
        ('processing_job_attempts', 'uq_processing_job_attempts_org_id', 'UNIQUE (organization_id, id)'),
        ('audit_runs', 'uq_audit_runs_org_id', 'UNIQUE (organization_id, id)'),
        ('audits', 'uq_audits_org_id', 'UNIQUE (organization_id, id)'),
        ('audits', 'uq_audits_org_claim_id', 'UNIQUE (organization_id, claim_id, id)'),
        ('audit_sections', 'uq_audit_sections_org_id', 'UNIQUE (organization_id, id)'),
        ('audit_findings', 'uq_audit_findings_org_id', 'UNIQUE (organization_id, id)'),
        ('audit_structured', 'uq_audit_structured_org_id', 'UNIQUE (organization_id, id)'),
        ('audit_versions', 'uq_audit_versions_org_id', 'UNIQUE (organization_id, id)'),
        ('evidence_anchors', 'uq_evidence_anchors_org_id', 'UNIQUE (organization_id, id)'),
        ('claim_activity', 'uq_claim_activity_org_id', 'UNIQUE (organization_id, id)'),
        ('prompt_settings', 'uq_prompt_settings_org_id', 'UNIQUE (organization_id, id)'),
        ('platform_tenant_access_leases', 'uq_platform_tenant_access_leases_org_id', 'UNIQUE (organization_id, id)'),
        ('platform_audit_events', 'uq_platform_audit_events_org_id', 'UNIQUE (organization_id, id)')
    ) AS constraints_to_add(table_name, constraint_name, definition)
  LOOP
    IF to_regclass(format('public.%I', item.table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required table public.% is missing', item.table_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = format('public.%I', item.table_name)::regclass
        AND conname = item.constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I %s',
        item.table_name,
        item.constraint_name,
        item.definition
      );
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT *
    FROM (
      VALUES
        (
          'carrier_entities',
          'ck_carrier_entities_normalized_key',
          $definition$CHECK (entity_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$') NOT VALID$definition$
        ),
        (
          'carrier_entities',
          'ck_carrier_entities_display_name',
          $definition$CHECK (nullif(btrim(display_name), '') IS NOT NULL) NOT VALID$definition$
        ),
        (
          'platform_tenant_access_leases',
          'ck_platform_tenant_access_leases_reason',
          $definition$CHECK (nullif(btrim(reason), '') IS NOT NULL) NOT VALID$definition$
        ),
        (
          'platform_tenant_access_leases',
          'ck_platform_tenant_access_leases_expiry',
          $definition$CHECK (
            expires_at > created_at
            AND expires_at <= created_at + interval '1 hour'
          ) NOT VALID$definition$
        ),
        (
          'platform_tenant_access_leases',
          'ck_platform_tenant_access_leases_revocation',
          $definition$CHECK (
            (
              revoked_at IS NULL
              AND revoked_by_user_id IS NULL
              AND revocation_reason IS NULL
            )
            OR
            (
              revoked_at IS NOT NULL
              AND revoked_by_user_id IS NOT NULL
              AND nullif(btrim(revocation_reason), '') IS NOT NULL
              AND revoked_at >= created_at
            )
          ) NOT VALID$definition$
        ),
        (
          'platform_audit_events',
          'ck_platform_audit_events_event_type',
          $definition$CHECK (event_type ~ '^[a-z][a-z0-9_]*$') NOT VALID$definition$
        ),
        (
          'platform_audit_events',
          'ck_platform_audit_events_reason',
          $definition$CHECK (nullif(btrim(reason), '') IS NOT NULL) NOT VALID$definition$
        ),
        (
          'platform_audit_events',
          'ck_platform_audit_events_metadata',
          $definition$CHECK (jsonb_typeof(metadata) = 'object') NOT VALID$definition$
        )
    ) AS constraints_to_add(table_name, constraint_name, definition)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = format('public.%I', item.table_name)::regclass
        AND conname = item.constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I %s',
        item.table_name,
        item.constraint_name,
        item.definition
      );
    END IF;
  END LOOP;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_carrier_entities_primary
  ON public.carrier_entities (organization_id)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_carrier_entities_org_active
  ON public.carrier_entities (organization_id, active);
CREATE INDEX IF NOT EXISTS idx_carrier_rulesets_organization
  ON public.carrier_rulesets (organization_id);
CREATE INDEX IF NOT EXISTS idx_carrier_ruleset_versions_org_key
  ON public.carrier_ruleset_versions (organization_id, carrier_key);
CREATE INDEX IF NOT EXISTS idx_claims_org_carrier_entity
  ON public.claims (organization_id, carrier_entity_id);
CREATE INDEX IF NOT EXISTS idx_claims_org_owner
  ON public.claims (organization_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_claims_org_current_audit
  ON public.claims (organization_id, current_audit_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_org_document
  ON public.processing_jobs (organization_id, document_id);
CREATE INDEX IF NOT EXISTS idx_audit_runs_org_job
  ON public.audit_runs (organization_id, processing_job_id);
CREATE INDEX IF NOT EXISTS idx_audits_org_run
  ON public.audits (organization_id, audit_run_id);
CREATE INDEX IF NOT EXISTS idx_audits_org_supersedes
  ON public.audits (organization_id, supersedes_audit_id);
CREATE INDEX IF NOT EXISTS idx_audits_org_job
  ON public.audits (organization_id, processing_job_id);
CREATE INDEX IF NOT EXISTS idx_findings_org_source_document
  ON public.audit_findings (organization_id, source_document_id);
CREATE INDEX IF NOT EXISTS idx_audit_versions_org_run
  ON public.audit_versions (organization_id, audit_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_versions_org_supersedes
  ON public.audit_versions (organization_id, supersedes_audit_id);
CREATE INDEX IF NOT EXISTS idx_evidence_anchors_org_source_document
  ON public.evidence_anchors (organization_id, source_document_id);
CREATE INDEX IF NOT EXISTS idx_platform_tenant_access_leases_active
  ON public.platform_tenant_access_leases (
    organization_id,
    platform_user_id,
    session_id,
    expires_at
  );
CREATE INDEX IF NOT EXISTS idx_platform_tenant_access_leases_session
  ON public.platform_tenant_access_leases (session_id);
CREATE INDEX IF NOT EXISTS idx_platform_audit_events_org_created
  ON public.platform_audit_events (organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_platform_audit_events_lease
  ON public.platform_audit_events (access_lease_id);

-- Fail with a relation-specific report before installing constraints. This
-- migration never repairs or guesses at cross-tenant ownership.
DO $$
DECLARE
  anomalies text[];
BEGIN
  SELECT array_agg(relation_name ORDER BY relation_name)
  INTO anomalies
  FROM (
    SELECT 'audit_findings.audit_id' AS relation_name
    WHERE EXISTS (
      SELECT 1
      FROM public.audit_findings child
      WHERE child.audit_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.audits parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.audit_id
        )
    )
    UNION ALL
    SELECT 'audit_findings.source_document_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.audit_findings child
      WHERE child.source_document_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.documents parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.source_document_id
        )
    )
    UNION ALL
    SELECT 'audit_runs.claim_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.audit_runs child
      WHERE child.claim_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.claims parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.claim_id
        )
    )
    UNION ALL
    SELECT 'audit_runs.processing_job_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.audit_runs child
      WHERE child.processing_job_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.processing_jobs parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.processing_job_id
        )
    )
    UNION ALL
    SELECT 'audit_sections.audit_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.audit_sections child
      WHERE child.audit_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.audits parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.audit_id
        )
    )
    UNION ALL
    SELECT 'audit_structured.audit_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.audit_structured child
      WHERE child.audit_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.audits parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.audit_id
        )
    )
    UNION ALL
    SELECT 'audit_versions.audit_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.audit_versions child
      WHERE child.audit_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.audits parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.audit_id
        )
    )
    UNION ALL
    SELECT 'audit_versions.audit_run_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.audit_versions child
      WHERE child.audit_run_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.audit_runs parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.audit_run_id
        )
    )
    UNION ALL
    SELECT 'audit_versions.claim_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.audit_versions child
      WHERE child.claim_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.claims parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.claim_id
        )
    )
    UNION ALL
    SELECT 'audit_versions.supersedes_audit_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.audit_versions child
      WHERE child.supersedes_audit_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.audits parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.supersedes_audit_id
        )
    )
    UNION ALL
    SELECT 'audits.audit_run_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.audits child
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.audit_runs parent
        WHERE parent.organization_id = child.organization_id
          AND parent.id = child.audit_run_id
      )
    )
    UNION ALL
    SELECT 'audits.claim_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.audits child
      WHERE child.claim_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.claims parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.claim_id
        )
    )
    UNION ALL
    SELECT 'audits.processing_job_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.audits child
      WHERE child.processing_job_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.processing_jobs parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.processing_job_id
        )
    )
    UNION ALL
    SELECT 'audits.supersedes_audit_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.audits child
      WHERE child.supersedes_audit_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.audits parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.supersedes_audit_id
        )
    )
    UNION ALL
    SELECT 'carrier_ruleset_versions.carrier_key'
    WHERE EXISTS (
      SELECT 1
      FROM public.carrier_ruleset_versions child
      WHERE child.organization_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.carrier_rulesets parent
          WHERE parent.organization_id = child.organization_id
            AND parent.carrier_key = child.carrier_key
        )
    )
    UNION ALL
    SELECT 'carrier_rulesets.organization_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.carrier_rulesets child
      WHERE child.organization_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.organizations parent
          WHERE parent.id = child.organization_id
        )
    )
    UNION ALL
    SELECT 'carrier_ruleset_versions.supersedes_version_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.carrier_ruleset_versions child
      WHERE child.organization_id IS NOT NULL
        AND child.supersedes_version_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.carrier_ruleset_versions parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.supersedes_version_id
        )
    )
    UNION ALL
    SELECT 'claim_activity.claim_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.claim_activity child
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.claims parent
        WHERE parent.organization_id = child.organization_id
          AND parent.id = child.claim_id
      )
    )
    UNION ALL
    SELECT 'claims.assignee_user_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.claims child
      WHERE child.assignee_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.organization_memberships parent
          WHERE parent.organization_id = child.organization_id
            AND parent.user_id = child.assignee_user_id
        )
    )
    UNION ALL
    SELECT 'claims.carrier_entity_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.claims child
      WHERE child.carrier_entity_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.carrier_entities parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.carrier_entity_id
        )
    )
    UNION ALL
    SELECT 'claims.current_audit_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.claims child
      WHERE child.current_audit_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.audits parent
          WHERE parent.organization_id = child.organization_id
            AND parent.claim_id = child.id
            AND parent.id = child.current_audit_id
        )
    )
    UNION ALL
    SELECT 'claims.owner_user_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.claims child
      WHERE child.owner_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.organization_memberships parent
          WHERE parent.organization_id = child.organization_id
            AND parent.user_id = child.owner_user_id
        )
    )
    UNION ALL
    SELECT 'documents.claim_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.documents child
      WHERE child.claim_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.claims parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.claim_id
        )
    )
    UNION ALL
    SELECT 'evidence_anchors.finding_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.evidence_anchors child
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.audit_findings parent
        WHERE parent.organization_id = child.organization_id
          AND parent.id = child.finding_id
      )
    )
    UNION ALL
    SELECT 'evidence_anchors.source_document_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.evidence_anchors child
      WHERE child.source_document_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.documents parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.source_document_id
        )
    )
    UNION ALL
    SELECT 'processing_job_attempts.job_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.processing_job_attempts child
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.processing_jobs parent
        WHERE parent.organization_id = child.organization_id
          AND parent.id = child.job_id
      )
    )
    UNION ALL
    SELECT 'processing_jobs.claim_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.processing_jobs child
      WHERE child.claim_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.claims parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.claim_id
        )
    )
    UNION ALL
    SELECT 'processing_jobs.document_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.processing_jobs child
      WHERE child.document_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.documents parent
          WHERE parent.organization_id = child.organization_id
            AND parent.id = child.document_id
        )
    )
    UNION ALL
    SELECT 'saved_views.user_id'
    WHERE EXISTS (
      SELECT 1
      FROM public.saved_views child
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.organization_memberships parent
        WHERE parent.organization_id = child.organization_id
          AND parent.user_id = child.user_id
      )
    )
  ) AS detected_anomalies;

  IF coalesce(cardinality(anomalies), 0) > 0 THEN
    RAISE EXCEPTION
      'Carrier tenant isolation preflight found cross-tenant or missing parents: %',
      array_to_string(anomalies, ', ')
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_memberships membership
    JOIN public.users app_user
      ON app_user.id = membership.user_id
    WHERE app_user.platform_role IS DISTINCT FROM 'platform_admin'::public.platform_role
    GROUP BY membership.user_id
    HAVING count(DISTINCT membership.organization_id) > 1
  ) THEN
    RAISE EXCEPTION
      'Carrier tenant isolation preflight found a non-platform user in multiple organizations'
      USING ERRCODE = '23514';
  END IF;
END
$$;

-- Composite foreign keys are installed NOT VALID so the later cutover can
-- update an entire tenant graph in one deferred transaction, then validate.
-- They still reject invalid new or changed rows immediately.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT *
    FROM (
      VALUES
        (
          'carrier_rulesets',
          'fk_carrier_rulesets_organization',
          'FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'carrier_ruleset_versions',
          'fk_carrier_ruleset_versions_organization',
          'FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'carrier_ruleset_versions',
          'fk_carrier_ruleset_versions_ruleset_tenant',
          'FOREIGN KEY (organization_id, carrier_key) REFERENCES public.carrier_rulesets(organization_id, carrier_key) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'carrier_ruleset_versions',
          'fk_carrier_ruleset_versions_supersedes_tenant',
          'FOREIGN KEY (organization_id, supersedes_version_id) REFERENCES public.carrier_ruleset_versions(organization_id, id) ON DELETE SET NULL (supersedes_version_id) DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'claims',
          'fk_claims_carrier_entity_tenant',
          'FOREIGN KEY (organization_id, carrier_entity_id) REFERENCES public.carrier_entities(organization_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'claims',
          'fk_claims_owner_membership_tenant',
          'FOREIGN KEY (organization_id, owner_user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE SET NULL (owner_user_id) DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'claims',
          'fk_claims_assignee_membership_tenant',
          'FOREIGN KEY (organization_id, assignee_user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE SET NULL (assignee_user_id) DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'claims',
          'fk_claims_current_audit_tenant',
          'FOREIGN KEY (organization_id, id, current_audit_id) REFERENCES public.audits(organization_id, claim_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'documents',
          'fk_documents_claim_tenant',
          'FOREIGN KEY (organization_id, claim_id) REFERENCES public.claims(organization_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'processing_jobs',
          'fk_processing_jobs_claim_tenant',
          'FOREIGN KEY (organization_id, claim_id) REFERENCES public.claims(organization_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'processing_jobs',
          'fk_processing_jobs_document_tenant',
          'FOREIGN KEY (organization_id, document_id) REFERENCES public.documents(organization_id, id) ON DELETE SET NULL (document_id) DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'processing_job_attempts',
          'fk_processing_job_attempts_job_tenant',
          'FOREIGN KEY (organization_id, job_id) REFERENCES public.processing_jobs(organization_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audit_runs',
          'fk_audit_runs_claim_tenant',
          'FOREIGN KEY (organization_id, claim_id) REFERENCES public.claims(organization_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audit_runs',
          'fk_audit_runs_processing_job_tenant',
          'FOREIGN KEY (organization_id, processing_job_id) REFERENCES public.processing_jobs(organization_id, id) ON DELETE SET NULL (processing_job_id) DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audits',
          'fk_audits_claim_tenant',
          'FOREIGN KEY (organization_id, claim_id) REFERENCES public.claims(organization_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audits',
          'fk_audits_run_tenant',
          'FOREIGN KEY (organization_id, audit_run_id) REFERENCES public.audit_runs(organization_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audits',
          'fk_audits_supersedes_tenant',
          'FOREIGN KEY (organization_id, supersedes_audit_id) REFERENCES public.audits(organization_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audits',
          'fk_audits_processing_job_tenant',
          'FOREIGN KEY (organization_id, processing_job_id) REFERENCES public.processing_jobs(organization_id, id) ON DELETE SET NULL (processing_job_id) DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audit_sections',
          'fk_audit_sections_audit_tenant',
          'FOREIGN KEY (organization_id, audit_id) REFERENCES public.audits(organization_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audit_findings',
          'fk_audit_findings_audit_tenant',
          'FOREIGN KEY (organization_id, audit_id) REFERENCES public.audits(organization_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audit_findings',
          'fk_audit_findings_source_document_tenant',
          'FOREIGN KEY (organization_id, source_document_id) REFERENCES public.documents(organization_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audit_structured',
          'fk_audit_structured_audit_tenant',
          'FOREIGN KEY (organization_id, audit_id) REFERENCES public.audits(organization_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audit_versions',
          'fk_audit_versions_claim_tenant',
          'FOREIGN KEY (organization_id, claim_id) REFERENCES public.claims(organization_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audit_versions',
          'fk_audit_versions_audit_tenant',
          'FOREIGN KEY (organization_id, audit_id) REFERENCES public.audits(organization_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audit_versions',
          'fk_audit_versions_run_tenant',
          'FOREIGN KEY (organization_id, audit_run_id) REFERENCES public.audit_runs(organization_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'audit_versions',
          'fk_audit_versions_supersedes_tenant',
          'FOREIGN KEY (organization_id, supersedes_audit_id) REFERENCES public.audits(organization_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'evidence_anchors',
          'fk_evidence_anchors_finding_tenant',
          'FOREIGN KEY (organization_id, finding_id) REFERENCES public.audit_findings(organization_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'evidence_anchors',
          'fk_evidence_anchors_source_document_tenant',
          'FOREIGN KEY (organization_id, source_document_id) REFERENCES public.documents(organization_id, id) ON DELETE SET NULL (source_document_id) DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'claim_activity',
          'fk_claim_activity_claim_tenant',
          'FOREIGN KEY (organization_id, claim_id) REFERENCES public.claims(organization_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'saved_views',
          'fk_saved_views_membership_tenant',
          'FOREIGN KEY (organization_id, user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        ),
        (
          'platform_tenant_access_leases',
          'fk_platform_tenant_access_leases_session_owner',
          'FOREIGN KEY (platform_user_id, session_id) REFERENCES public.sessions(user_id, sid) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE NOT VALID'
        )
    ) AS constraints_to_add(table_name, constraint_name, definition)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = format('public.%I', item.table_name)::regclass
        AND conname = item.constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I %s',
        item.table_name,
        item.constraint_name,
        item.definition
      );
    END IF;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.enforce_configured_carrier_tenant_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  tenant_id uuid;
  profile_count integer;
  entity_count integer;
  primary_entity_count integer;
BEGIN
  FOREACH tenant_id IN ARRAY ARRAY[
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.organization_id ELSE NULL END,
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.organization_id ELSE NULL END
  ]
  LOOP
    CONTINUE WHEN tenant_id IS NULL;

    SELECT count(*)
    INTO profile_count
    FROM public.carrier_rulesets ruleset
    WHERE ruleset.organization_id = tenant_id;

    SELECT
      count(*),
      count(*) FILTER (WHERE entity.is_primary)
    INTO entity_count, primary_entity_count
    FROM public.carrier_entities entity
    WHERE entity.organization_id = tenant_id;

    -- Legacy/unconfigured organizations remain allowed during expansion. As
    -- soon as either side is configured, the tenant must have one profile and
    -- exactly one primary entity; subsidiaries remain unrestricted.
    IF profile_count > 0 OR entity_count > 0 THEN
      IF profile_count <> 1 OR primary_entity_count <> 1 THEN
        RAISE EXCEPTION
          'Configured carrier organization % requires exactly one profile and one primary carrier entity',
          tenant_id
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;

DROP TRIGGER IF EXISTS trg_carrier_rulesets_profile_bundle
  ON public.carrier_rulesets;
CREATE CONSTRAINT TRIGGER trg_carrier_rulesets_profile_bundle
AFTER INSERT OR UPDATE OR DELETE
ON public.carrier_rulesets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.enforce_configured_carrier_tenant_profile();

DROP TRIGGER IF EXISTS trg_carrier_entities_profile_bundle
  ON public.carrier_entities;
CREATE CONSTRAINT TRIGGER trg_carrier_entities_profile_bundle
AFTER INSERT OR UPDATE OR DELETE
ON public.carrier_entities
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.enforce_configured_carrier_tenant_profile();

CREATE OR REPLACE FUNCTION public.enforce_single_carrier_tenant_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  user_platform_role public.platform_role;
BEGIN
  SELECT app_user.platform_role
  INTO user_platform_role
  FROM public.users app_user
  WHERE app_user.id = NEW.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership user % does not exist', NEW.user_id
      USING ERRCODE = '23503';
  END IF;

  IF user_platform_role = 'platform_admin'::public.platform_role THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_memberships existing
    WHERE existing.user_id = NEW.user_id
      AND existing.organization_id <> NEW.organization_id
      AND existing.id <> NEW.id
  ) THEN
    RAISE EXCEPTION
      'Non-platform user % cannot belong to multiple carrier organizations',
      NEW.user_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_single_carrier_tenant_membership
  ON public.organization_memberships;
CREATE TRIGGER trg_single_carrier_tenant_membership
BEFORE INSERT OR UPDATE OF organization_id, user_id
ON public.organization_memberships
FOR EACH ROW
EXECUTE FUNCTION public.enforce_single_carrier_tenant_membership();

CREATE OR REPLACE FUNCTION public.enforce_platform_role_membership_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.platform_role IS DISTINCT FROM OLD.platform_role
     AND NEW.platform_role IS DISTINCT FROM 'platform_admin'::public.platform_role
     AND (
       SELECT count(DISTINCT membership.organization_id)
       FROM public.organization_memberships membership
       WHERE membership.user_id = NEW.id
     ) > 1 THEN
    RAISE EXCEPTION
      'Platform admin % must be reduced to at most one carrier membership before demotion',
      NEW.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_platform_role_membership_limit
  ON public.users;
CREATE TRIGGER trg_platform_role_membership_limit
BEFORE UPDATE OF platform_role
ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.enforce_platform_role_membership_limit();

CREATE OR REPLACE FUNCTION public.protect_platform_tenant_access_lease()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  user_platform_role public.platform_role;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT app_user.platform_role
    INTO user_platform_role
    FROM public.users app_user
    WHERE app_user.id = NEW.platform_user_id
    FOR UPDATE;

    IF user_platform_role IS DISTINCT FROM 'platform_admin'::public.platform_role THEN
      RAISE EXCEPTION 'Tenant access leases require a platform admin'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'Tenant access lease must expire in the future'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.platform_user_id IS DISTINCT FROM OLD.platform_user_id
     OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Tenant access lease identity and grant terms are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.revoked_at IS NOT NULL
     AND (
       NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       OR NEW.revoked_by_user_id IS DISTINCT FROM OLD.revoked_by_user_id
       OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason
     ) THEN
    RAISE EXCEPTION 'Tenant access lease revocation is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_protect_platform_tenant_access_lease
  ON public.platform_tenant_access_leases;
CREATE TRIGGER trg_protect_platform_tenant_access_lease
BEFORE INSERT OR UPDATE
ON public.platform_tenant_access_leases
FOR EACH ROW
EXECUTE FUNCTION public.protect_platform_tenant_access_lease();

CREATE OR REPLACE FUNCTION public.audit_platform_tenant_access_lease()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.platform_audit_events (
      organization_id,
      actor_user_id,
      session_id,
      access_lease_id,
      event_type,
      reason,
      metadata
    )
    VALUES (
      NEW.organization_id,
      NEW.platform_user_id,
      NEW.session_id,
      NEW.id,
      'tenant_access_granted',
      NEW.reason,
      jsonb_build_object('expiresAt', NEW.expires_at)
    );
  ELSIF TG_OP = 'UPDATE'
        AND OLD.revoked_at IS NULL
        AND NEW.revoked_at IS NOT NULL THEN
    INSERT INTO public.platform_audit_events (
      organization_id,
      actor_user_id,
      session_id,
      access_lease_id,
      event_type,
      reason,
      metadata
    )
    VALUES (
      NEW.organization_id,
      NEW.revoked_by_user_id,
      NEW.session_id,
      NEW.id,
      'tenant_access_revoked',
      NEW.revocation_reason,
      jsonb_build_object(
        'grantedReason', NEW.reason,
        'expiresAt', NEW.expires_at,
        'revokedAt', NEW.revoked_at
      )
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.platform_audit_events (
      organization_id,
      actor_user_id,
      session_id,
      access_lease_id,
      event_type,
      reason,
      metadata
    )
    VALUES (
      OLD.organization_id,
      OLD.platform_user_id,
      OLD.session_id,
      OLD.id,
      'tenant_access_session_ended',
      'Session ended or access lease removed',
      jsonb_build_object(
        'grantedReason', OLD.reason,
        'expiresAt', OLD.expires_at,
        'revokedAt', OLD.revoked_at
      )
    );
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;

DROP TRIGGER IF EXISTS trg_audit_platform_tenant_access_lease
  ON public.platform_tenant_access_leases;
CREATE TRIGGER trg_audit_platform_tenant_access_lease
AFTER INSERT OR UPDATE OF revoked_at, revoked_by_user_id, revocation_reason OR DELETE
ON public.platform_tenant_access_leases
FOR EACH ROW
EXECUTE FUNCTION public.audit_platform_tenant_access_lease();

CREATE OR REPLACE FUNCTION public.reject_platform_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'platform_audit_events is append-only; % is not permitted', TG_OP
    USING ERRCODE = '55000';
END
$function$;

DROP TRIGGER IF EXISTS trg_platform_audit_events_immutable
  ON public.platform_audit_events;
CREATE TRIGGER trg_platform_audit_events_immutable
BEFORE UPDATE OR DELETE
ON public.platform_audit_events
FOR EACH ROW
EXECUTE FUNCTION public.reject_platform_audit_event_mutation();

COMMIT;
