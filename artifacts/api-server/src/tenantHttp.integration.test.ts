import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { Client, type ClientConfig } from "pg";
import request, { type Response } from "supertest";
import sgMail from "@sendgrid/mail";

const integrationDatabaseUrl =
  process.env.TENANT_INTEGRATION_DATABASE_URL?.trim();

const PASSWORD = "TenantIntegration!2026";
const LOGIN_ROLE_PASSWORD = "tenant-integration-role-password";

const IDS = {
  allstate: {
    organization: "a11a0000-0000-4000-8000-000000000001",
    entity: "e11e0000-0000-4000-8000-000000000001",
    user: "integration-allstate-owner",
    membership: "b1000000-0000-4000-8000-000000000001",
    rulesetVersion: "b1100000-0000-4000-8000-000000000001",
    claim: "b2000000-0000-4000-8000-000000000001",
    document: "b3000000-0000-4000-8000-000000000001",
    job: "b4000000-0000-4000-8000-000000000001",
    attempt: "b4100000-0000-4000-8000-000000000001",
    workerJob: "b4200000-0000-4000-8000-000000000001",
    auditRun: "b5000000-0000-4000-8000-000000000001",
    audit: "b6000000-0000-4000-8000-000000000001",
    section: "b7000000-0000-4000-8000-000000000001",
    finding: "b8000000-0000-4000-8000-000000000001",
    structured: "b9000000-0000-4000-8000-000000000001",
    version: "ba000000-0000-4000-8000-000000000001",
    evidence: "bb000000-0000-4000-8000-000000000001",
    activity: "bc000000-0000-4000-8000-000000000001",
    invitation: "bd000000-0000-4000-8000-000000000001",
    savedView: "be000000-0000-4000-8000-000000000001",
    auditEvent: "bf000000-0000-4000-8000-000000000001",
  },
  andover: {
    organization: "a11a0000-0000-4000-8000-000000000002",
    entity: "e11e0000-0000-4000-8000-000000000002",
    user: "integration-andover-owner",
    membership: "b1000000-0000-4000-8000-000000000002",
    rulesetVersion: "b1100000-0000-4000-8000-000000000002",
    claim: "b2000000-0000-4000-8000-000000000002",
    document: "b3000000-0000-4000-8000-000000000002",
    job: "b4000000-0000-4000-8000-000000000002",
    attempt: "b4100000-0000-4000-8000-000000000002",
    workerJob: "b4200000-0000-4000-8000-000000000002",
    auditRun: "b5000000-0000-4000-8000-000000000002",
    audit: "b6000000-0000-4000-8000-000000000002",
    section: "b7000000-0000-4000-8000-000000000002",
    finding: "b8000000-0000-4000-8000-000000000002",
    structured: "b9000000-0000-4000-8000-000000000002",
    version: "ba000000-0000-4000-8000-000000000002",
    evidence: "bb000000-0000-4000-8000-000000000002",
    activity: "bc000000-0000-4000-8000-000000000002",
    invitation: "bd000000-0000-4000-8000-000000000002",
    savedView: "be000000-0000-4000-8000-000000000002",
    auditEvent: "bf000000-0000-4000-8000-000000000002",
  },
} as const;

const MIGRATIONS = [
  "0001_phase2_multitenancy_jobs.sql",
  "0002_organization_prompt_settings.sql",
  "0003_organization_audit_events.sql",
  "0004_organization_settings.sql",
  "0005_membership_owner_guard.sql",
  "0006_carrier_ruleset_versions.sql",
  "0006_email_normalization_preflight.sql",
  "0007_secure_account_administration.sql",
  "0008_credential_versioning.sql",
  "0009_revoke_legacy_credentials.sql",
  "20260810221123_carrier_tenant_isolation.sql",
  "20260810222350_carrier_tenant_rls.sql",
  "20260810225039_carrier_tenant_storage.sql",
  "20260810232004_carrier_tenant_data_cutover.sql",
  "20260812001000_frictionless_tenant_switching.sql",
] as const;

const PHASE_TWO_MIGRATIONS = MIGRATIONS.slice(0, 10);
const ALLSTATE_STORAGE_PATH =
  `organizations/${IDS.allstate.organization}/claims/${IDS.allstate.claim}` +
  `/documents/${IDS.allstate.document}/allstate-secret.pdf`;
const ANDOVER_STORAGE_PATH =
  `organizations/${IDS.andover.organization}/claims/${IDS.andover.claim}` +
  `/documents/${IDS.andover.document}/andover-secret.pdf`;

const ANDOVER_FOREIGN_VALUES = [
  ...Object.values(IDS.andover),
  ANDOVER_STORAGE_PATH,
  "ANDOVER-TENANT-SECRET-002",
  "Andover Integration Secret",
  "AND-POLICY-SECRET",
  "2 Andover Secret Lane",
  "Andover audit summary secret",
  "Andover finding secret",
  "Andover evidence secret",
  "Andover structured secret",
  "Andover private view",
  "andover-owner@example.invalid",
  "andover-invite@example.invalid",
  "ANDOVER DOCUMENT SECRET",
] as const;

const ALLSTATE_FOREIGN_VALUES = [
  ...Object.values(IDS.allstate),
  ALLSTATE_STORAGE_PATH,
  "ALLSTATE-TENANT-SECRET-001",
  "Allstate Integration Secret",
  "ALL-POLICY-SECRET",
  "1 Allstate Secret Way",
  "Allstate audit summary secret",
  "Allstate finding secret",
  "Allstate evidence secret",
  "Allstate structured secret",
  "Allstate private view",
  "allstate-owner@example.invalid",
  "allstate-invite@example.invalid",
  "ALLSTATE DOCUMENT SECRET",
] as const;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationDirectory = join(repoRoot, "lib/db/migrations");

interface LoggedInAgent {
  agent: ReturnType<typeof request.agent>;
  databaseSessionId: string;
}

interface RuntimeUrls {
  identity: string;
  tenant: string;
  platform: string;
  worker: string;
}

function responseSurface(response: Response): string {
  return [
    response.text ?? "",
    JSON.stringify(response.body ?? null),
    JSON.stringify(response.headers ?? null),
  ].join("\n");
}

function assertNoValues(
  response: Response,
  forbiddenValues: readonly string[],
  context: string,
): void {
  const surface = responseSurface(response);
  for (const value of forbiddenValues) {
    assert.equal(
      surface.includes(value),
      false,
      `${context} disclosed forbidden value ${value}`,
    );
  }
}

function assertResponse(
  response: Response,
  status: number,
  forbiddenValues: readonly string[],
  context: string,
): void {
  assert.equal(
    response.status,
    status,
    `${context}: ${response.status} ${response.text}`,
  );
  assertNoValues(response, forbiddenValues, context);
}

function sessionDatabaseId(rawSessionId: string): string {
  return createHash("sha256").update(rawSessionId).digest("hex");
}

function loginDatabaseUrl(baseUrl: string, login: string): string {
  const url = new URL(baseUrl);
  url.username = login;
  url.password = LOGIN_ROLE_PASSWORD;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function roleBoundDatabaseUrl(baseUrl: string, role: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("options", `-c role=${role}`);
  return url.toString();
}

async function applySqlFile(
  client: Client,
  relativePath: string,
): Promise<void> {
  const sqlText = await readFile(
    join(migrationDirectory, relativePath),
    "utf8",
  );
  await client.query(sqlText);
  await client.query("SET search_path TO public");
}

async function provisionDatabase(
  client: Client,
  databaseUrl: string,
): Promise<RuntimeUrls> {
  const versionResult = await client.query<{
    server_version_num: string;
    database_name: string;
  }>(
    `SELECT
      current_setting('server_version_num') AS server_version_num,
      current_database() AS database_name`,
  );
  const database = versionResult.rows[0];
  assert.ok(database, "PostgreSQL did not report its version/database");
  assert.ok(
    Number(database.server_version_num) >= 160_000,
    `PostgreSQL 16+ is required; got ${database.server_version_num}`,
  );
  assert.match(
    database.database_name,
    /tenant.*integration|integration.*tenant/i,
    "Refusing to reset a database whose name is not clearly integration-only",
  );
  assert.equal(
    process.env.TENANT_INTEGRATION_ALLOW_RESET,
    "1",
    "TENANT_INTEGRATION_ALLOW_RESET=1 is required because the suite resets schemas",
  );

  const productionFiles = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.deepEqual(
    productionFiles,
    [...MIGRATIONS].sort(),
    "The integration chain must be updated when a production migration is added",
  );

  await applySqlFile(client, "testing/legacy_baseline.sql");
  await applySqlFile(client, "testing/legacy_seed.sql");
  for (const migration of PHASE_TWO_MIGRATIONS) {
    await applySqlFile(client, migration);
  }
  await applySqlFile(client, "testing/validate_phase2.sql");
  await applySqlFile(client, "20260810221123_carrier_tenant_isolation.sql");
  await applySqlFile(client, "20260810222350_carrier_tenant_rls.sql");
  await applySqlFile(client, "testing/validate_carrier_tenant_foundation.sql");
  await applySqlFile(client, "testing/validate_carrier_tenant_rls.sql");
  await applySqlFile(client, "testing/storage_test_support.sql");
  await applySqlFile(
    client,
    "testing/carrier_tenant_cutover_legacy_fixture.sql",
  );
  await applySqlFile(client, "20260810225039_carrier_tenant_storage.sql");
  await applySqlFile(client, "testing/validate_carrier_tenant_storage.sql");
  await applySqlFile(
    client,
    "testing/prepare_carrier_tenant_storage_manifest.sql",
  );
  await applySqlFile(client, "20260810232004_carrier_tenant_data_cutover.sql");
  await applySqlFile(client, "testing/validate_carrier_tenant_cutover.sql");
  await applySqlFile(
    client,
    "20260812001000_frictionless_tenant_switching.sql",
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const seedTemplate = await readFile(
    join(migrationDirectory, "testing/tenant_http_integration_seed.sql"),
    "utf8",
  );
  assert.equal(
    seedTemplate.includes("__TENANT_INTEGRATION_PASSWORD_HASH__"),
    true,
    "Integration seed password marker is missing",
  );
  await client.query(
    seedTemplate.replaceAll(
      "__TENANT_INTEGRATION_PASSWORD_HASH__",
      passwordHash,
    ),
  );

  await client.query(`
    DO $provision_roles$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = 'claims_iq_integration_identity_login'
      ) THEN
        CREATE ROLE claims_iq_integration_identity_login
          LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = 'claims_iq_integration_tenant_login'
      ) THEN
        CREATE ROLE claims_iq_integration_tenant_login
          LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = 'claims_iq_integration_platform_login'
      ) THEN
        CREATE ROLE claims_iq_integration_platform_login
          LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = 'claims_iq_integration_worker_login'
      ) THEN
        CREATE ROLE claims_iq_integration_worker_login
          LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
      END IF;
    END
    $provision_roles$;

    ALTER ROLE claims_iq_integration_identity_login
      WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION PASSWORD '${LOGIN_ROLE_PASSWORD}';
    ALTER ROLE claims_iq_integration_tenant_login
      WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION PASSWORD '${LOGIN_ROLE_PASSWORD}';
    ALTER ROLE claims_iq_integration_platform_login
      WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION PASSWORD '${LOGIN_ROLE_PASSWORD}';
    ALTER ROLE claims_iq_integration_worker_login
      WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION PASSWORD '${LOGIN_ROLE_PASSWORD}';

    REVOKE claims_iq_identity, claims_iq_tenant_api,
      claims_iq_platform_admin, claims_iq_worker
      FROM claims_iq_integration_identity_login,
        claims_iq_integration_tenant_login,
        claims_iq_integration_platform_login,
        claims_iq_integration_worker_login;
    GRANT claims_iq_identity TO claims_iq_integration_identity_login;
    GRANT claims_iq_tenant_api TO claims_iq_integration_tenant_login;
    GRANT claims_iq_platform_admin TO claims_iq_integration_platform_login;
    GRANT claims_iq_worker TO claims_iq_integration_worker_login;
  `);

  const membershipResult = await client.query<{
    login_role: string;
    capabilities: string[];
  }>(`
    SELECT
      member_role.rolname AS login_role,
      pg_catalog.jsonb_agg(
        capability_role.rolname ORDER BY capability_role.rolname
      )
        AS capabilities
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles member_role
      ON member_role.oid = membership.member
    JOIN pg_catalog.pg_roles capability_role
      ON capability_role.oid = membership.roleid
    WHERE member_role.rolname LIKE 'claims_iq_integration_%_login'
      AND capability_role.rolname LIKE 'claims_iq_%'
    GROUP BY member_role.rolname
    ORDER BY member_role.rolname
  `);
  assert.deepEqual(membershipResult.rows, [
    {
      login_role: "claims_iq_integration_identity_login",
      capabilities: ["claims_iq_identity"],
    },
    {
      login_role: "claims_iq_integration_platform_login",
      capabilities: ["claims_iq_platform_admin"],
    },
    {
      login_role: "claims_iq_integration_tenant_login",
      capabilities: ["claims_iq_tenant_api"],
    },
    {
      login_role: "claims_iq_integration_worker_login",
      capabilities: ["claims_iq_worker"],
    },
  ]);

  return {
    identity: loginDatabaseUrl(
      databaseUrl,
      "claims_iq_integration_identity_login",
    ),
    tenant: loginDatabaseUrl(databaseUrl, "claims_iq_integration_tenant_login"),
    platform: loginDatabaseUrl(
      databaseUrl,
      "claims_iq_integration_platform_login",
    ),
    worker: loginDatabaseUrl(databaseUrl, "claims_iq_integration_worker_login"),
  };
}

async function login(
  app: Parameters<typeof request.agent>[0],
  email: string,
  expectedOrganizationId: string | null,
  password = PASSWORD,
): Promise<LoggedInAgent> {
  const agent = request.agent(app);
  const response = await agent
    .post("/api/auth/login")
    .send({ email, password });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.user?.email, email);
  // Organization context is attached by middleware on the first request made
  // with the newly issued cookie, not retroactively on the login request.
  assert.equal(response.body.organization ?? null, null);

  const setCookieValue = response.headers["set-cookie"];
  const cookies = Array.isArray(setCookieValue)
    ? setCookieValue
    : setCookieValue
      ? [setCookieValue]
      : [];
  const sidCookie = cookies.find((cookie) => cookie.startsWith("sid="));
  assert.ok(sidCookie, `Login for ${email} did not set a sid cookie`);
  const rawSessionId = sidCookie.slice("sid=".length).split(";")[0];
  assert.ok(rawSessionId, `Login for ${email} set an empty sid cookie`);

  const authenticated = await agent.get("/api/auth/user");
  assert.equal(authenticated.status, 200, authenticated.text);
  assert.equal(authenticated.body.user?.email, email);
  assert.equal(
    authenticated.body.organization?.id ?? null,
    expectedOrganizationId,
  );
  return {
    agent,
    databaseSessionId: sessionDatabaseId(rawSessionId),
  };
}

async function tenantSnapshot(
  client: Client,
  organizationId: string,
): Promise<unknown> {
  const result = await client.query<{ snapshot: unknown }>(
    `
      SELECT pg_catalog.jsonb_build_object(
        'claims', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.claims row_data
          WHERE row_data.organization_id = $1
        ),
        'documents', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.documents row_data
          WHERE row_data.organization_id = $1
        ),
        'jobs', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.processing_jobs row_data
          WHERE row_data.organization_id = $1
        ),
        'attempts', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.processing_job_attempts row_data
          WHERE row_data.organization_id = $1
        ),
        'auditRuns', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.audit_runs row_data
          WHERE row_data.organization_id = $1
        ),
        'audits', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.audits row_data
          WHERE row_data.organization_id = $1
        ),
        'sections', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.audit_sections row_data
          WHERE row_data.organization_id = $1
        ),
        'findings', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.audit_findings row_data
          WHERE row_data.organization_id = $1
        ),
        'structured', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.audit_structured row_data
          WHERE row_data.organization_id = $1
        ),
        'versions', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.audit_versions row_data
          WHERE row_data.organization_id = $1
        ),
        'evidence', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.evidence_anchors row_data
          WHERE row_data.organization_id = $1
        ),
        'activity', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.claim_activity row_data
          WHERE row_data.organization_id = $1
        ),
        'memberships', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.organization_memberships row_data
          WHERE row_data.organization_id = $1
        ),
        'invitations', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.organization_invitations row_data
          WHERE row_data.organization_id = $1
        ),
        'savedViews', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.saved_views row_data
          WHERE row_data.organization_id = $1
        ),
        'settings', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.organization_id), '[]'::jsonb)
          FROM public.organization_settings row_data
          WHERE row_data.organization_id = $1
        ),
        'promptSettings', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.prompt_settings row_data
          WHERE row_data.organization_id = $1
        ),
        'carrierRulesets', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.carrier_rulesets row_data
          WHERE row_data.organization_id = $1
        ),
        'carrierVersions', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.carrier_ruleset_versions row_data
          WHERE row_data.organization_id = $1
        ),
        'carrierEntities', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.carrier_entities row_data
          WHERE row_data.organization_id = $1
        ),
        'organizationAudit', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM public.organization_audit_events row_data
          WHERE row_data.organization_id = $1
        ),
        'storageObjects', (
          SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)
            ORDER BY row_data.id), '[]'::jsonb)
          FROM storage.objects row_data
          WHERE row_data.name LIKE 'organizations/' || $1::text || '/%'
        )
      ) AS snapshot
    `,
    [organizationId],
  );
  return result.rows[0]?.snapshot;
}

async function runForeignProbe(
  responsePromise: Promise<Response>,
  context: string,
  foreignValues: readonly string[],
  status = 404,
): Promise<void> {
  const response = await responsePromise;
  assertResponse(response, status, foreignValues, context);
}

async function verifyTenantConnectionRls(input: {
  tenantDatabaseUrl: string;
  userId: string;
  organizationId: string;
  sessionId: string;
  ownClaimId: string;
  foreignClaimId: string;
  foreignOrganizationId: string;
  foreignEntityId: string;
}): Promise<void> {
  const client = new Client({
    connectionString: roleBoundDatabaseUrl(
      input.tenantDatabaseUrl,
      "claims_iq_tenant_api",
    ),
  });
  await client.connect();
  try {
    await client.query(
      `SELECT
        pg_catalog.set_config('app.user_id', $1, false),
        pg_catalog.set_config('app.organization_id', $2, false),
        pg_catalog.set_config('app.session_id', $3, false),
        pg_catalog.set_config('app.platform_role', '', false),
        pg_catalog.set_config('app.access_lease_id', '', false)`,
      [input.userId, input.organizationId, input.sessionId],
    );
    const role = await client.query<{ current_user: string }>(
      "SELECT current_user",
    );
    assert.equal(role.rows[0]?.current_user, "claims_iq_tenant_api");

    const counts = await client.query<{
      own_claims: number;
      foreign_claims: number;
      foreign_graph: number;
    }>(
      `SELECT
        (SELECT pg_catalog.count(*)::int
          FROM public.claims WHERE id = $1) AS own_claims,
        (SELECT pg_catalog.count(*)::int
          FROM public.claims WHERE id = $2) AS foreign_claims,
        (
          (SELECT pg_catalog.count(*) FROM public.documents
            WHERE organization_id = $3)
          + (SELECT pg_catalog.count(*) FROM public.audit_runs
            WHERE organization_id = $3)
          + (SELECT pg_catalog.count(*) FROM public.audits
            WHERE organization_id = $3)
          + (SELECT pg_catalog.count(*) FROM public.audit_sections
            WHERE organization_id = $3)
          + (SELECT pg_catalog.count(*) FROM public.audit_findings
            WHERE organization_id = $3)
          + (SELECT pg_catalog.count(*) FROM public.audit_structured
            WHERE organization_id = $3)
          + (SELECT pg_catalog.count(*) FROM public.audit_versions
            WHERE organization_id = $3)
          + (SELECT pg_catalog.count(*) FROM public.evidence_anchors
            WHERE organization_id = $3)
          + (SELECT pg_catalog.count(*) FROM public.claim_activity
            WHERE organization_id = $3)
          + (SELECT pg_catalog.count(*) FROM public.processing_jobs
            WHERE organization_id = $3)
          + (SELECT pg_catalog.count(*) FROM public.processing_job_attempts
            WHERE organization_id = $3)
        )::int AS foreign_graph`,
      [input.ownClaimId, input.foreignClaimId, input.foreignOrganizationId],
    );
    assert.deepEqual(counts.rows[0], {
      own_claims: 1,
      foreign_claims: 0,
      foreign_graph: 0,
    });

    const hiddenUpdate = await client.query(
      `UPDATE public.claims
      SET insured_name = 'FORBIDDEN-RLS-UPDATE'
      WHERE id = $1`,
      [input.foreignClaimId],
    );
    assert.equal(hiddenUpdate.rowCount, 0);

    let rejectedInsert: unknown;
    try {
      await client.query(
        `INSERT INTO public.claims (
          organization_id,
          claim_number,
          insured_name,
          carrier_entity_id,
          carrier,
          status,
          system_status,
          ai_status,
          human_review_status
        )
        VALUES ($1, 'FORBIDDEN-RLS-INSERT', 'Forbidden', $2, 'Foreign',
          'uploaded', 'ready', 'not_started', 'unassigned')`,
        [input.foreignOrganizationId, input.foreignEntityId],
      );
    } catch (error) {
      rejectedInsert = error;
    }
    assert.ok(
      rejectedInsert,
      "RLS allowed an insert into another organization",
    );
    assert.equal(
      typeof rejectedInsert === "object" &&
        rejectedInsert !== null &&
        "code" in rejectedInsert
        ? rejectedInsert.code
        : undefined,
      "42501",
      `Unexpected cross-tenant insert error: ${
        rejectedInsert instanceof Error
          ? rejectedInsert.message
          : String(rejectedInsert)
      }`,
    );
  } finally {
    await client.end();
  }
}

test(
  "real HTTP requests preserve two-tenant isolation",
  {
    skip: integrationDatabaseUrl
      ? false
      : "TENANT_INTEGRATION_DATABASE_URL is not set",
    timeout: 240_000,
  },
  async (t: TestContext) => {
    assert.ok(integrationDatabaseUrl);
    const owner = new Client({ connectionString: integrationDatabaseUrl });
    let closeRuntimePools: (() => Promise<void>) | undefined;
    const sentEmails: Array<{ text?: string }> = [];
    await owner.connect();

    try {
      const runtimeUrls = await provisionDatabase(
        owner,
        integrationDatabaseUrl,
      );
      process.env.NODE_ENV = "development";
      process.env.SUPABASE_DATABASE_URL = integrationDatabaseUrl;
      process.env.IDENTITY_DATABASE_URL = runtimeUrls.identity;
      process.env.TENANT_DATABASE_URL = runtimeUrls.tenant;
      process.env.PLATFORM_DATABASE_URL = runtimeUrls.platform;
      process.env.OPERATIONS_DATABASE_URL = runtimeUrls.worker;
      process.env.SUPABASE_URL = "http://127.0.0.1:9";
      process.env.SUPABASE_PUBLISHABLE_KEY = "integration-not-used";
      process.env.SUPABASE_JWT_SECRET =
        "tenant-integration-storage-secret-not-used";
      process.env.GEMINI_API_KEY = "";
      process.env.SENDGRID_API_KEY =
        "SG.integration-test-key-that-must-never-be-used";
      process.env.SENDGRID_FROM_EMAIL = "integration@example.invalid";
      process.env.PLATFORM_TENANT_ACCESS_TTL_MINUTES = "60";
      process.env.APP_PUBLIC_URL = "http://127.0.0.1";
      process.env.ALLOWED_ORIGINS = "http://127.0.0.1";
      (
        sgMail as unknown as {
          send(message: { text?: string }): Promise<unknown>;
        }
      ).send = async (message) => {
        sentEmails.push(message);
        return [];
      };

      const [{ default: app }, databaseModule] = await Promise.all([
        import("./app"),
        import("@workspace/db"),
      ]);
      closeRuntimePools = databaseModule.closeRuntimePools;

      const allstate = await login(
        app,
        "allstate-owner@example.invalid",
        IDS.allstate.organization,
      );
      const andover = await login(
        app,
        "andover-owner@example.invalid",
        IDS.andover.organization,
      );
      // Platform administrators are placed into a tenant workspace at
      // sign-in; the seeded tenants sort alphabetically, so Allstate opens.
      const platform = await login(
        app,
        "platform-admin@example.invalid",
        IDS.allstate.organization,
      );

      await t.test(
        "real cookie sessions scope aggregate and report routes",
        async () => {
          for (const [path, includesOwnClaim] of [
            ["/api/claims", true],
            ["/api/claims/queue", true],
            ["/api/dashboard", true],
            ["/api/insights", false],
            ["/api/settings/overview", false],
            ["/api/saved-views", false],
          ] as const) {
            const response = await allstate.agent.get(path);
            assert.equal(response.status, 200, `${path}: ${response.text}`);
            assertNoValues(response, ANDOVER_FOREIGN_VALUES, path);
            if (includesOwnClaim) {
              assert.match(
                responseSurface(response),
                new RegExp(IDS.allstate.claim),
              );
            }
          }

          const claim = await allstate.agent.get(
            `/api/claims/${IDS.allstate.claim}`,
          );
          assert.equal(claim.status, 200, claim.text);
          assert.match(
            responseSurface(claim),
            new RegExp(IDS.allstate.document),
          );
          assert.match(responseSurface(claim), new RegExp(IDS.allstate.audit));
          assert.match(
            responseSurface(claim),
            new RegExp(IDS.allstate.finding),
          );
          assertNoValues(claim, ANDOVER_FOREIGN_VALUES, "Allstate claim graph");

          const report = await allstate.agent.get(
            `/api/claims/${IDS.allstate.claim}/download`,
          );
          assert.equal(report.status, 200, report.text);
          assertNoValues(report, ANDOVER_FOREIGN_VALUES, "Allstate report");

          const emailPreview = await allstate.agent.get(
            `/api/claims/${IDS.allstate.claim}/email`,
          );
          assert.equal(emailPreview.status, 200, emailPreview.text);
          assertNoValues(
            emailPreview,
            ANDOVER_FOREIGN_VALUES,
            "Allstate email preview",
          );
        },
      );

      await t.test(
        "Allstate guesses every Andover HTTP identifier without disclosure or mutation",
        async () => {
          const before = await tenantSnapshot(owner, IDS.andover.organization);
          const a = IDS.andover;
          const agent = allstate.agent;

          const probes: Array<{
            name: string;
            run: () => Promise<Response>;
            status?: number;
          }> = [
            {
              name: "claim GET",
              run: () => agent.get(`/api/claims/${a.claim}`),
            },
            {
              name: "document download",
              run: () => agent.get(`/api/documents/${a.document}/download`),
            },
            {
              name: "document signed URL",
              run: () => agent.get(`/api/documents/${a.document}/signed-url`),
            },
            {
              name: "document extract",
              run: () =>
                agent.post(
                  `/api/claims/${a.claim}/documents/${a.document}/extract`,
                ),
            },
            {
              name: "audit enqueue",
              run: () => agent.post(`/api/claims/${a.claim}/audit`).send({}),
            },
            {
              name: "report",
              run: () => agent.get(`/api/claims/${a.claim}/download`),
            },
            {
              name: "email preview",
              run: () => agent.get(`/api/claims/${a.claim}/email`),
            },
            {
              name: "finding update and evidence lookup",
              run: () =>
                agent
                  .patch(`/api/claims/${a.claim}/findings/${a.finding}`)
                  .send({ disposition: "accepted", notes: "forbidden" }),
            },
            {
              name: "claim activity",
              run: () => agent.get(`/api/claims/${a.claim}/activity`),
            },
            {
              name: "processing job GET",
              run: () => agent.get(`/api/processing-jobs/${a.job}`),
            },
            {
              name: "worker job GET",
              run: () => agent.get(`/api/processing-jobs/${a.workerJob}`),
            },
            {
              name: "claim job list",
              run: () => agent.get(`/api/claims/${a.claim}/processing-jobs`),
            },
            {
              name: "job cancel",
              run: () =>
                agent.post(`/api/processing-jobs/${a.job}/cancel`).send({}),
            },
            {
              name: "job retry",
              run: () =>
                agent.post(`/api/processing-jobs/${a.job}/retry`).send({}),
            },
            {
              name: "assignment",
              run: () =>
                agent
                  .patch(`/api/claims/${a.claim}/assignment`)
                  .send({ assigneeUserId: IDS.allstate.user }),
            },
            {
              name: "review status",
              run: () =>
                agent
                  .patch(`/api/claims/${a.claim}/review-status`)
                  .send({ status: "in_review" }),
            },
            {
              name: "individual archive",
              run: () => agent.delete(`/api/claims/${a.claim}`),
            },
            {
              name: "bulk archive",
              run: () =>
                agent.post("/api/claims/archive").send({ claimIds: [a.claim] }),
            },
            {
              name: "membership update",
              run: () =>
                agent
                  .patch(`/api/settings/members/${a.membership}`)
                  .send({ role: "reviewer" }),
            },
            {
              name: "membership password reset",
              run: () =>
                agent.post(
                  `/api/settings/members/${a.membership}/password-reset`,
                ),
            },
            {
              name: "invitation resend",
              run: () =>
                agent.post(`/api/settings/invitations/${a.invitation}/resend`),
            },
            {
              name: "invitation delete",
              run: () =>
                agent.delete(`/api/settings/invitations/${a.invitation}`),
            },
            {
              name: "saved view update",
              run: () =>
                agent
                  .put(`/api/saved-views/${a.savedView}`)
                  .send({ name: "forbidden" }),
            },
            {
              name: "saved view delete",
              run: () => agent.delete(`/api/saved-views/${a.savedView}`),
            },
          ];

          for (const probe of probes) {
            await runForeignProbe(
              probe.run(),
              probe.name,
              ANDOVER_FOREIGN_VALUES,
              probe.status,
            );
          }

          const forgedHeader = await agent
            .get("/api/auth/user")
            .set("X-Organization-Id", a.organization);
          assertResponse(
            forgedHeader,
            403,
            ANDOVER_FOREIGN_VALUES,
            "forged X-Organization-Id",
          );

          const attemptedTenantSwitch = await agent
            .post("/api/platform/tenant-access")
            .send({
              organizationId: a.organization,
              reason: "attempted session switch",
            });
          assertResponse(
            attemptedTenantSwitch,
            403,
            ANDOVER_FOREIGN_VALUES,
            "normal user platform lease attempt",
          );

          const attemptedMembershipSwitch = await agent
            .post("/api/auth/active-organization")
            .send({ organizationId: a.organization });
          assertResponse(
            attemptedMembershipSwitch,
            403,
            ANDOVER_FOREIGN_VALUES,
            "non-member organization switch attempt",
          );

          const stillAllstate = await agent.get("/api/auth/user");
          assert.equal(stillAllstate.status, 200, stillAllstate.text);
          assert.equal(
            stillAllstate.body.organization?.id,
            IDS.allstate.organization,
          );
          assertNoValues(
            stillAllstate,
            ANDOVER_FOREIGN_VALUES,
            "session stayed Allstate-bound",
          );

          const beforeBodyAttempts = await owner.query<{
            assignee_user_id: string | null;
            carrier_entity_id: string | null;
            claim_count: number;
            job_count: number;
          }>(
            `SELECT
              (SELECT assignee_user_id FROM public.claims WHERE id = $1)
                AS assignee_user_id,
              (SELECT carrier_entity_id::text FROM public.claims WHERE id = $1)
                AS carrier_entity_id,
              (SELECT pg_catalog.count(*)::int FROM public.claims)
                AS claim_count,
              (SELECT pg_catalog.count(*)::int FROM public.processing_jobs)
                AS job_count`,
            [IDS.allstate.claim],
          );

          await runForeignProbe(
            agent.post("/api/claims").send({
              claimNumber: "FORBIDDEN-FOREIGN-ENTITY-CREATE",
              insuredName: "Forbidden foreign entity",
              carrierEntityId: a.entity,
            }),
            "claim insert with foreign carrier entity",
            ANDOVER_FOREIGN_VALUES,
            400,
          );
          await runForeignProbe(
            agent
              .patch(`/api/claims/${IDS.allstate.claim}/assignment`)
              .send({ assigneeUserId: a.user }),
            "assignment update with foreign user",
            ANDOVER_FOREIGN_VALUES,
            404,
          );
          await runForeignProbe(
            agent.post(`/api/claims/${IDS.allstate.claim}/reprocess`).send({
              carrierEntityId: a.entity,
            }),
            "reprocess with foreign carrier entity",
            ANDOVER_FOREIGN_VALUES,
            400,
          );
          await runForeignProbe(
            agent.post(`/api/claims/${IDS.allstate.claim}/audit`).send({
              carrierEntityId: a.entity,
            }),
            "audit with foreign carrier entity",
            ANDOVER_FOREIGN_VALUES,
            400,
          );
          await runForeignProbe(
            agent.post(`/api/processing-jobs/${IDS.allstate.job}/cancel`).send({
              organizationId: a.organization,
            }),
            "job update with foreign organization body",
            ANDOVER_FOREIGN_VALUES,
            400,
          );

          const afterBodyAttempts = await owner.query<{
            assignee_user_id: string | null;
            carrier_entity_id: string | null;
            claim_count: number;
            job_count: number;
          }>(
            `SELECT
              (SELECT assignee_user_id FROM public.claims WHERE id = $1)
                AS assignee_user_id,
              (SELECT carrier_entity_id::text FROM public.claims WHERE id = $1)
                AS carrier_entity_id,
              (SELECT pg_catalog.count(*)::int FROM public.claims)
                AS claim_count,
              (SELECT pg_catalog.count(*)::int FROM public.processing_jobs)
                AS job_count`,
            [IDS.allstate.claim],
          );
          assert.deepEqual(
            afterBodyAttempts.rows[0],
            beforeBodyAttempts.rows[0],
          );

          const after = await tenantSnapshot(owner, IDS.andover.organization);
          assert.deepEqual(
            after,
            before,
            "Andover graph changed after foreign HTTP probes",
          );
        },
      );

      await t.test(
        "restricted tenant LOGIN role enforces RLS independently",
        async () => {
          await verifyTenantConnectionRls({
            tenantDatabaseUrl: runtimeUrls.tenant,
            userId: IDS.allstate.user,
            organizationId: IDS.allstate.organization,
            sessionId: allstate.databaseSessionId,
            ownClaimId: IDS.allstate.claim,
            foreignClaimId: IDS.andover.claim,
            foreignOrganizationId: IDS.andover.organization,
            foreignEntityId: IDS.andover.entity,
          });
          await verifyTenantConnectionRls({
            tenantDatabaseUrl: runtimeUrls.tenant,
            userId: IDS.andover.user,
            organizationId: IDS.andover.organization,
            sessionId: andover.databaseSessionId,
            ownClaimId: IDS.andover.claim,
            foreignClaimId: IDS.allstate.claim,
            foreignOrganizationId: IDS.allstate.organization,
            foreignEntityId: IDS.allstate.entity,
          });
        },
      );

      await t.test(
        "Andover cannot read or mutate representative Allstate resources",
        async () => {
          const before = await tenantSnapshot(owner, IDS.allstate.organization);
          const agent = andover.agent;
          for (const [name, run] of [
            ["claim", () => agent.get(`/api/claims/${IDS.allstate.claim}`)],
            [
              "document",
              () =>
                agent.get(`/api/documents/${IDS.allstate.document}/signed-url`),
            ],
            [
              "job",
              () => agent.get(`/api/processing-jobs/${IDS.allstate.job}`),
            ],
            [
              "assignment",
              () =>
                agent
                  .patch(`/api/claims/${IDS.allstate.claim}/assignment`)
                  .send({ assigneeUserId: IDS.andover.user }),
            ],
            [
              "membership",
              () =>
                agent
                  .patch(`/api/settings/members/${IDS.allstate.membership}`)
                  .send({ role: "reviewer" }),
            ],
          ] as const) {
            await runForeignProbe(
              run(),
              `reverse ${name}`,
              ALLSTATE_FOREIGN_VALUES,
            );
          }

          const foreignEntity = await agent.post("/api/claims").send({
            claimNumber: "FORBIDDEN-REVERSE-ENTITY-CREATE",
            insuredName: "Forbidden reverse entity",
            carrierEntityId: IDS.allstate.entity,
          });
          assertResponse(
            foreignEntity,
            400,
            ALLSTATE_FOREIGN_VALUES,
            "reverse foreign carrier entity",
          );

          const list = await agent.get("/api/claims");
          assert.equal(list.status, 200, list.text);
          assert.match(responseSurface(list), new RegExp(IDS.andover.claim));
          assertNoValues(list, ALLSTATE_FOREIGN_VALUES, "Andover claim list");

          const after = await tenantSnapshot(owner, IDS.allstate.organization);
          assert.deepEqual(
            after,
            before,
            "Allstate graph changed after reverse foreign probes",
          );
        },
      );

      await t.test(
        "platform access is audited, single-tenant, revocable, and renewing",
        async () => {
          const agent = platform.agent;

          // Sign-in opened the first tenant automatically with an audited
          // workspace-switch reason; no reason prompt was involved.
          const autoEntered = await agent.get("/api/claims");
          assert.equal(autoEntered.status, 200, autoEntered.text);
          assert.match(
            responseSurface(autoEntered),
            new RegExp(IDS.allstate.claim),
          );
          assertNoValues(
            autoEntered,
            ANDOVER_FOREIGN_VALUES,
            "auto-entered platform tenant",
          );
          const autoLease = await owner.query<{ reason: string }>(
            `SELECT reason
            FROM public.platform_tenant_access_leases
            WHERE platform_user_id = $1 AND session_id = $2
              AND revoked_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1`,
            ["integration-platform-admin", platform.databaseSessionId],
          );
          assert.equal(
            autoLease.rows[0]?.reason,
            "Tenant session via workspace switcher",
          );

          const organizationsList = await agent.get("/api/auth/organizations");
          assert.equal(organizationsList.status, 200, organizationsList.text);
          const listedOrganizations = organizationsList.body as Array<{
            id: string;
            role: string;
          }>;
          for (const expectedId of [
            IDS.allstate.organization,
            IDS.andover.organization,
          ]) {
            const listed = listedOrganizations.find(
              ({ id }) => id === expectedId,
            );
            assert.ok(listed, `Platform list is missing ${expectedId}`);
            assert.equal(listed.role, "platform_admin");
          }

          const summaries = await agent.get("/api/platform/tenants");
          assert.equal(summaries.status, 200, summaries.text);
          assert.ok(Array.isArray(summaries.body));
          assert.ok(summaries.body.length >= 2);
          for (const summary of summaries.body as Array<
            Record<string, unknown>
          >) {
            assert.deepEqual(Object.keys(summary).sort(), [
              "id",
              "name",
              "slug",
            ]);
          }
          const summarySurface = responseSurface(summaries);
          assert.equal(summarySurface.includes(IDS.allstate.claim), false);
          assert.equal(summarySurface.includes(IDS.andover.claim), false);
          assert.equal(summarySurface.includes("totalClaims"), false);
          assert.equal(summarySurface.includes("metrics"), false);

          // Reasons are optional: switching without one records the automatic
          // workspace-switch reason in the audit trail.
          const reasonlessSwitch = await agent
            .post("/api/auth/active-organization")
            .send({ organizationId: IDS.andover.organization });
          assert.equal(reasonlessSwitch.status, 200, reasonlessSwitch.text);
          assert.equal(
            reasonlessSwitch.body.organization?.id,
            IDS.andover.organization,
          );

          const enterAllstate = await agent
            .post("/api/platform/tenant-access")
            .send({
              organizationId: IDS.allstate.organization,
              reason: "Investigating support ticket CIQ-100",
            });
          assert.equal(enterAllstate.status, 200, enterAllstate.text);
          assert.equal(
            enterAllstate.body.organization?.id,
            IDS.allstate.organization,
          );
          assert.equal(
            enterAllstate.body.organization?.accessMode,
            "platform_lease",
          );
          assert.equal(
            enterAllstate.body.organization?.permissions?.includes(
              "settings:manage",
            ),
            true,
          );
          const leaseBoundary = await owner.query<{
            created_at: Date;
            expires_at: Date;
          }>(
            `SELECT created_at, expires_at
            FROM public.platform_tenant_access_leases
            WHERE platform_user_id = $1
              AND session_id = $2
              AND organization_id = $3
              AND revoked_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1`,
            [
              "integration-platform-admin",
              platform.databaseSessionId,
              IDS.allstate.organization,
            ],
          );
          const boundaryRow = leaseBoundary.rows[0];
          assert.ok(boundaryRow);
          assert.equal(
            boundaryRow.expires_at.getTime() - boundaryRow.created_at.getTime(),
            60 * 60 * 1000,
          );
          assert.equal(
            enterAllstate.body.organization?.accessExpiresAt,
            boundaryRow.expires_at.toISOString(),
          );

          const allstateClaim = await agent.get(
            `/api/claims/${IDS.allstate.claim}`,
          );
          assert.equal(allstateClaim.status, 200, allstateClaim.text);
          assertNoValues(
            allstateClaim,
            ANDOVER_FOREIGN_VALUES,
            "platform Allstate lease",
          );
          await runForeignProbe(
            agent.get(`/api/claims/${IDS.andover.claim}`),
            "platform Allstate lease cannot read Andover",
            ANDOVER_FOREIGN_VALUES,
          );

          const enterAndover = await agent
            .post("/api/platform/tenant-access")
            .send({
              organizationId: IDS.andover.organization,
              reason: "Investigating support ticket CIQ-101",
            });
          assert.equal(enterAndover.status, 200, enterAndover.text);
          assert.equal(
            enterAndover.body.organization?.id,
            IDS.andover.organization,
          );

          const activeLeases = await owner.query<{
            active_count: number;
            revoked_count: number;
          }>(
            `SELECT
              pg_catalog.count(*) FILTER (
                WHERE revoked_at IS NULL AND expires_at > pg_catalog.clock_timestamp()
              )::int AS active_count,
              pg_catalog.count(*) FILTER (WHERE revoked_at IS NOT NULL)::int
                AS revoked_count
            FROM public.platform_tenant_access_leases
            WHERE platform_user_id = $1 AND session_id = $2`,
            ["integration-platform-admin", platform.databaseSessionId],
          );
          assert.equal(activeLeases.rows[0]?.active_count, 1);
          assert.ok((activeLeases.rows[0]?.revoked_count ?? 0) >= 1);

          await runForeignProbe(
            agent.get(`/api/claims/${IDS.allstate.claim}`),
            "replacement Andover lease cannot read Allstate",
            ALLSTATE_FOREIGN_VALUES,
          );
          const andoverClaim = await agent.get(
            `/api/claims/${IDS.andover.claim}`,
          );
          assert.equal(andoverClaim.status, 200, andoverClaim.text);
          assertNoValues(
            andoverClaim,
            ALLSTATE_FOREIGN_VALUES,
            "platform Andover lease",
          );

          const revoke = await agent.delete("/api/platform/tenant-access");
          assert.equal(revoke.status, 200, revoke.text);
          assert.equal(revoke.body.organization, null);
          const afterRevoke = await agent.get("/api/claims");
          assert.equal(afterRevoke.status, 403, afterRevoke.text);

          const expiringLease = await agent
            .post("/api/platform/tenant-access")
            .send({
              organizationId: IDS.allstate.organization,
              reason: "Expiry behavior integration test",
            });
          assert.equal(expiringLease.status, 200, expiringLease.text);
          await new Promise((resolve) => setTimeout(resolve, 10));
          await owner.query(
            `ALTER TABLE public.platform_tenant_access_leases
              DISABLE TRIGGER trg_protect_platform_tenant_access_lease`,
          );
          try {
            await owner.query(
              `UPDATE public.platform_tenant_access_leases
              SET expires_at = created_at + interval '1 millisecond'
              WHERE id = (
                SELECT id
                FROM public.platform_tenant_access_leases
                WHERE platform_user_id = $1 AND session_id = $2
                  AND revoked_at IS NULL
                ORDER BY created_at DESC
                LIMIT 1
              )`,
              ["integration-platform-admin", platform.databaseSessionId],
            );
          } finally {
            await owner.query(
              `ALTER TABLE public.platform_tenant_access_leases
                ENABLE TRIGGER trg_protect_platform_tenant_access_lease`,
            );
          }

          // Expired leases are renewed silently so administrators are never
          // bounced mid-session; the replacement lease is audited with the
          // automatic workspace-switch reason.
          const afterExpiry = await agent.get("/api/claims");
          assert.equal(afterExpiry.status, 200, afterExpiry.text);
          assertNoValues(
            afterExpiry,
            ANDOVER_FOREIGN_VALUES,
            "renewed Allstate lease after expiry",
          );
          const renewedLease = await owner.query<{
            reason: string;
            expires_at: Date;
          }>(
            `SELECT reason, expires_at
            FROM public.platform_tenant_access_leases
            WHERE platform_user_id = $1 AND session_id = $2
              AND organization_id = $3
              AND revoked_at IS NULL
              AND expires_at > pg_catalog.clock_timestamp()
            ORDER BY created_at DESC
            LIMIT 1`,
            [
              "integration-platform-admin",
              platform.databaseSessionId,
              IDS.allstate.organization,
            ],
          );
          assert.ok(renewedLease.rows[0], "Expired lease was not renewed");
          assert.equal(
            renewedLease.rows[0].reason,
            "Tenant session via workspace switcher",
          );
          const renewedSession = await agent.get("/api/auth/user");
          assert.equal(renewedSession.status, 200, renewedSession.text);
          assert.equal(
            renewedSession.body.organization?.id,
            IDS.allstate.organization,
          );
        },
      );

      await t.test(
        "leased platform admin bootstraps an ownerless tenant",
        async () => {
          await owner.query(
            `ALTER TABLE public.organization_memberships
              DISABLE TRIGGER trg_organization_memberships_owner_guard`,
          );
          try {
            await owner.query(
              `DELETE FROM public.organization_memberships
              WHERE organization_id = $1`,
              [IDS.allstate.organization],
            );
          } finally {
            await owner.query(
              `ALTER TABLE public.organization_memberships
                ENABLE TRIGGER trg_organization_memberships_owner_guard`,
            );
          }
          const membershipBefore = await owner.query<{ count: number }>(
            `SELECT pg_catalog.count(*)::int AS count
            FROM public.organization_memberships
            WHERE organization_id = $1`,
            [IDS.allstate.organization],
          );
          assert.equal(membershipBefore.rows[0]?.count, 0);

          // Explicitly exit the renewed workspace so the lease requirement is
          // observable before re-entering to bootstrap the tenant.
          const detach = await platform.agent.delete(
            "/api/platform/tenant-access",
          );
          assert.equal(detach.status, 200, detach.text);

          const withoutLease = await platform.agent.get(
            "/api/settings/overview",
          );
          assert.equal(withoutLease.status, 403, withoutLease.text);

          const enter = await platform.agent
            .post("/api/platform/tenant-access")
            .send({
              organizationId: IDS.allstate.organization,
              reason: "Bootstrap Allstate tenant owner",
            });
          assert.equal(enter.status, 200, enter.text);
          assert.equal(
            enter.body.organization?.permissions?.includes("settings:manage"),
            true,
          );

          const activeOverview = await platform.agent.get(
            "/api/settings/overview",
          );
          assert.equal(activeOverview.status, 200, activeOverview.text);
          assert.deepEqual(activeOverview.body.members, []);

          sentEmails.length = 0;
          const invitation = await platform.agent
            .post("/api/settings/invitations")
            .send({
              email: "allstate-bootstrap-owner@example.invalid",
              role: "owner",
            });
          assert.equal(invitation.status, 201, invitation.text);
          assert.equal(invitation.body.role, "owner");
          const invitationText = sentEmails.at(-1)?.text ?? "";
          const tokenMatch = invitationText.match(
            /accept-invitation#token=([^\s]+)/,
          );
          assert.ok(tokenMatch?.[1], "Invitation email did not contain a token");
          const invitationToken = decodeURIComponent(tokenMatch[1]);

          const revoke = await platform.agent.delete(
            "/api/platform/tenant-access",
          );
          assert.equal(revoke.status, 200, revoke.text);
          const afterRevoke = await platform.agent.get(
            "/api/settings/overview",
          );
          assert.equal(afterRevoke.status, 403, afterRevoke.text);

          const bootstrapPassword = "AllstateOwner!2026";
          const accepted = await request(app)
            .post("/api/auth/invitations/accept")
            .send({
              token: invitationToken,
              password: bootstrapPassword,
              firstName: "Alex",
              lastName: "Owner",
            });
          assert.equal(accepted.status, 200, accepted.text);
          assert.equal(
            accepted.body.organizationId,
            IDS.allstate.organization,
          );

          const ownerMembership = await owner.query<{
            membership_id: string;
            membership_count: number;
            organization_id: string;
            role: string;
            invited_by_user_id: string;
            accepted_by_user_id: string;
            acceptance_audit_count: number;
          }>(
            `SELECT
              membership.id AS membership_id,
              (
                SELECT pg_catalog.count(*)::int
                FROM public.organization_memberships AS owned_membership
                WHERE owned_membership.user_id = app_user.id
              ) AS membership_count,
              membership.organization_id,
              membership.role::text AS role,
              invitation.invited_by_user_id,
              invitation.accepted_by_user_id,
              (
                SELECT pg_catalog.count(*)::int
                FROM public.organization_audit_events AS event
                WHERE event.organization_id = membership.organization_id
                  AND event.actor_user_id = app_user.id
                  AND event.event_type = 'membership.invitation_accepted'
                  AND event.target_type = 'organization_membership'
                  AND event.target_id = membership.id::text
                  AND event.metadata ->> 'invitationId' =
                    invitation.id::text
                  AND event.metadata ->> 'role' = invitation.role::text
              ) AS acceptance_audit_count
            FROM public.organization_memberships AS membership
            JOIN public.users AS app_user ON app_user.id = membership.user_id
            JOIN public.organization_invitations AS invitation
              ON invitation.id = $3
            WHERE membership.organization_id = $1
              AND app_user.email = $2`,
            [
              IDS.allstate.organization,
              "allstate-bootstrap-owner@example.invalid",
              invitation.body.id,
            ],
          );
          const acceptedMembership = ownerMembership.rows[0];
          assert.ok(acceptedMembership);
          assert.equal(acceptedMembership.membership_count, 1);
          assert.equal(
            acceptedMembership.organization_id,
            IDS.allstate.organization,
          );
          assert.equal(acceptedMembership.role, "owner");
          assert.equal(
            acceptedMembership.invited_by_user_id,
            "integration-platform-admin",
          );
          assert.equal(
            acceptedMembership.accepted_by_user_id,
            accepted.body.user.id,
          );
          assert.equal(acceptedMembership.acceptance_audit_count, 1);

          const platformMembership = await owner.query<{ count: number }>(
            `SELECT pg_catalog.count(*)::int AS count
            FROM public.organization_memberships
            WHERE user_id = $1`,
            ["integration-platform-admin"],
          );
          assert.equal(platformMembership.rows[0]?.count, 0);

          const ordinaryOwner = await login(
            app,
            "allstate-bootstrap-owner@example.invalid",
            IDS.allstate.organization,
            bootstrapPassword,
          );
          const ordinaryOwnerSettings = await ordinaryOwner.agent.get(
            "/api/settings/overview",
          );
          assert.equal(
            ordinaryOwnerSettings.status,
            200,
            ordinaryOwnerSettings.text,
          );
          const ownClaim = await ordinaryOwner.agent.get(
            `/api/claims/${IDS.allstate.claim}`,
          );
          assert.equal(ownClaim.status, 200, ownClaim.text);
          assertNoValues(
            ownClaim,
            ANDOVER_FOREIGN_VALUES,
            "bootstrapped Allstate owner claim",
          );
          await runForeignProbe(
            ordinaryOwner.agent.get(`/api/claims/${IDS.andover.claim}`),
            "bootstrapped Allstate owner cannot read Andover",
            ANDOVER_FOREIGN_VALUES,
          );
        },
      );

      await t.test(
        "multi-membership users switch tenants without a reason",
        async () => {
          const agent = andover.agent;

          const singleTenant = await agent.get("/api/auth/organizations");
          assert.equal(singleTenant.status, 200, singleTenant.text);
          assert.deepEqual(
            (singleTenant.body as Array<{ id: string }>).map(({ id }) => id),
            [IDS.andover.organization],
          );

          // Role-based access: a second membership makes the tenant
          // switchable. The database no longer restricts users to one tenant.
          await owner.query(
            `INSERT INTO public.organization_memberships
              (organization_id, user_id, role)
            VALUES ($1, $2, 'reviewer')`,
            [IDS.allstate.organization, IDS.andover.user],
          );
          try {
            const bothTenants = await agent.get("/api/auth/organizations");
            assert.equal(bothTenants.status, 200, bothTenants.text);
            assert.deepEqual(
              (bothTenants.body as Array<{ id: string; role: string }>)
                .map(({ id, role }) => ({ id, role }))
                .sort((left, right) => left.id.localeCompare(right.id)),
              [
                { id: IDS.allstate.organization, role: "reviewer" },
                { id: IDS.andover.organization, role: "owner" },
              ],
            );

            // The session stays bound to Andover until an explicit switch.
            const beforeSwitch = await agent.get("/api/auth/user");
            assert.equal(
              beforeSwitch.body.organization?.id,
              IDS.andover.organization,
            );

            const switched = await agent
              .post("/api/auth/active-organization")
              .send({ organizationId: IDS.allstate.organization });
            assert.equal(switched.status, 200, switched.text);
            assert.equal(
              switched.body.organization?.id,
              IDS.allstate.organization,
            );
            assert.equal(switched.body.organization?.accessMode, "membership");
            assert.equal(switched.body.organization?.role, "reviewer");

            const allstateClaim = await agent.get(
              `/api/claims/${IDS.allstate.claim}`,
            );
            assert.equal(allstateClaim.status, 200, allstateClaim.text);
            assertNoValues(
              allstateClaim,
              ANDOVER_FOREIGN_VALUES,
              "membership-switched Allstate context",
            );
            await runForeignProbe(
              agent.get(`/api/claims/${IDS.andover.claim}`),
              "Allstate-bound session cannot read Andover",
              ANDOVER_FOREIGN_VALUES,
            );

            // The last active tenant is remembered for future sign-ins.
            const lastActive = await owner.query<{
              last_active_organization_id: string | null;
            }>(
              `SELECT last_active_organization_id
              FROM public.users
              WHERE id = $1`,
              [IDS.andover.user],
            );
            assert.equal(
              lastActive.rows[0]?.last_active_organization_id,
              IDS.allstate.organization,
            );

            const switchedBack = await agent
              .post("/api/auth/active-organization")
              .send({ organizationId: IDS.andover.organization });
            assert.equal(switchedBack.status, 200, switchedBack.text);
            assert.equal(
              switchedBack.body.organization?.id,
              IDS.andover.organization,
            );
            assert.equal(switchedBack.body.organization?.role, "owner");
          } finally {
            await owner.query(
              `DELETE FROM public.organization_memberships
              WHERE organization_id = $1 AND user_id = $2`,
              [IDS.allstate.organization, IDS.andover.user],
            );
          }

          const afterCleanup = await agent.get("/api/auth/user");
          assert.equal(afterCleanup.status, 200, afterCleanup.text);
          assert.equal(
            afterCleanup.body.organization?.id,
            IDS.andover.organization,
          );
        },
      );

      await t.test(
        "worker control claims globally only through its private function",
        async () => {
          const workerConfig: ClientConfig = {
            connectionString: roleBoundDatabaseUrl(
              runtimeUrls.worker,
              "claims_iq_worker",
            ),
          };
          const workerControl = new Client(workerConfig);
          await workerControl.connect();
          let claimedJobId: string | undefined;
          try {
            const currentRole = await workerControl.query<{
              current_user: string;
            }>("SELECT current_user");
            assert.equal(currentRole.rows[0]?.current_user, "claims_iq_worker");
            await workerControl.query(
              "SELECT pg_catalog.set_config('app.worker_id', $1, false)",
              ["tenant-http-worker-control"],
            );

            const invisibleQueue = await workerControl.query<{ count: number }>(
              "SELECT pg_catalog.count(*)::int AS count FROM public.processing_jobs",
            );
            assert.equal(invisibleQueue.rows[0]?.count, 0);
            await assert.rejects(
              workerControl.query(
                `UPDATE public.processing_jobs
                SET status = 'running'
                WHERE id = $1`,
                [IDS.allstate.workerJob],
              ),
              (error: unknown) =>
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                error.code === "42501",
              "worker role must not update the queue table directly",
            );

            const claimed = await workerControl.query<{
              id: string;
              organization_id: string;
            }>(
              "SELECT id, organization_id FROM private.claim_processing_job($1)",
              [60_000],
            );
            assert.equal(claimed.rows.length, 1);
            claimedJobId = claimed.rows[0]?.id;
            assert.equal(claimedJobId, IDS.allstate.workerJob);
            assert.equal(
              claimed.rows[0]?.organization_id,
              IDS.allstate.organization,
            );

            const stillInvisible = await workerControl.query<{ count: number }>(
              "SELECT pg_catalog.count(*)::int AS count FROM public.processing_jobs",
            );
            assert.equal(
              stillInvisible.rows[0]?.count,
              0,
              "control-plane function-local job binding must not leak",
            );
          } finally {
            await workerControl.end();
          }

          assert.ok(claimedJobId);
          const jobBoundWorker = new Client(workerConfig);
          await jobBoundWorker.connect();
          try {
            await jobBoundWorker.query(
              `SELECT
                pg_catalog.set_config('app.worker_id', $1, false),
                pg_catalog.set_config('app.job_id', $2, false),
                pg_catalog.set_config('app.organization_id', $3, false)`,
              [
                "tenant-http-worker-control",
                claimedJobId,
                IDS.allstate.organization,
              ],
            );
            const visible = await jobBoundWorker.query<{
              bound_jobs: number;
              own_claims: number;
              other_claims: number;
              other_evidence: number;
            }>(
              `SELECT
                (SELECT pg_catalog.count(*)::int FROM public.processing_jobs)
                  AS bound_jobs,
                (SELECT pg_catalog.count(*)::int FROM public.claims
                  WHERE id = $1) AS own_claims,
                (SELECT pg_catalog.count(*)::int FROM public.claims
                  WHERE organization_id = $2) AS other_claims,
                (SELECT pg_catalog.count(*)::int FROM public.evidence_anchors
                  WHERE organization_id = $2) AS other_evidence`,
              [IDS.allstate.claim, IDS.andover.organization],
            );
            assert.deepEqual(visible.rows[0], {
              bound_jobs: 1,
              own_claims: 1,
              other_claims: 0,
              other_evidence: 0,
            });
          } finally {
            await jobBoundWorker.end();
          }
        },
      );
    } finally {
      if (closeRuntimePools) {
        await closeRuntimePools();
      }
      await owner.end();
    }
  },
);
