import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for migration rehearsal.");
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationDir = resolve(rootDir, "lib/db/migrations");
const foundationFiles = [
  "testing/legacy_baseline.sql",
  "testing/legacy_seed.sql",
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
  "testing/validate_phase2.sql",
  "20260810221123_carrier_tenant_isolation.sql",
  "20260810222350_carrier_tenant_rls.sql",
];
const fixtureAndStorageFiles = [
  "testing/storage_test_support.sql",
  "testing/carrier_tenant_cutover_legacy_fixture.sql",
  "20260810225039_carrier_tenant_storage.sql",
];
const cutoverFile = "20260810232004_carrier_tenant_data_cutover.sql";
const manifestFile = "testing/prepare_carrier_tenant_storage_manifest.sql";
const validationFile = "testing/validate_carrier_tenant_cutover.sql";

const client = new Client({ connectionString: databaseUrl });

async function apply(relativePath: string, announce = true): Promise<void> {
  const filePath = resolve(migrationDir, relativePath);
  const sql = await readFile(filePath, "utf8");
  await client.query(sql);
  await client.query("SET search_path TO public");
  if (announce) process.stdout.write(`Applied ${relativePath}\n`);
}

async function resetFixture(): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.query("RESET ROLE");
  await client.query(`
    DROP SCHEMA IF EXISTS private CASCADE;
    DROP SCHEMA IF EXISTS storage CASCADE;
    DROP SCHEMA IF EXISTS auth CASCADE;
  `);
  for (const relativePath of foundationFiles) {
    await apply(relativePath);
  }
  await apply("testing/validate_carrier_tenant_foundation.sql");
  await apply("testing/validate_carrier_tenant_rls.sql");
  for (const relativePath of fixtureAndStorageFiles) {
    await apply(relativePath);
  }
}

async function expectCutoverFailure(
  expected: RegExp,
  label: string,
): Promise<void> {
  const sql = await readFile(resolve(migrationDir, cutoverFile), "utf8");
  let caught: unknown;
  try {
    await client.query(sql);
  } catch (error) {
    caught = error;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query("SET search_path TO public");
  }
  if (!caught) {
    throw new Error(`${label} unexpectedly succeeded.`);
  }
  const message = caught instanceof Error ? caught.message : String(caught);
  if (!expected.test(message)) {
    throw new Error(`${label} failed for the wrong reason: ${message}`, {
      cause: caught,
    });
  }
  process.stdout.write(`Verified ${label}: ${message}\n`);
}

async function assertFailedCutoverRolledBack(label: string): Promise<void> {
  const result = await client.query<{
    legacy_organizations: string;
    legacy_claims: string;
    disabled_guards: string;
    target_organizations: string;
  }>(`
    SELECT
      (
        SELECT count(*)::text
        FROM public.organizations
        WHERE id = '00000000-0000-4000-8000-000000000001'
      ) AS legacy_organizations,
      (
        SELECT count(*)::text
        FROM public.claims
        WHERE organization_id =
          '00000000-0000-4000-8000-000000000001'
      ) AS legacy_claims,
      (
        SELECT count(*)::text
        FROM pg_catalog.pg_trigger AS trigger_record
        JOIN pg_catalog.pg_class AS relation
          ON relation.oid = trigger_record.tgrelid
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND trigger_record.tgname IN (
            'audit_runs_immutable',
            'audits_immutable',
            'audit_versions_immutable',
            'trg_carrier_ruleset_versions_history_guard',
            'trg_organization_memberships_owner_guard'
          )
          AND trigger_record.tgenabled <> 'O'
      ) AS disabled_guards,
      (
        SELECT count(*)::text
        FROM public.organizations
        WHERE id IN (
          'a11a0000-0000-4000-8000-000000000001',
          'a11a0000-0000-4000-8000-000000000002',
          'a11a0000-0000-4000-8000-000000000003'
        )
      ) AS target_organizations
  `);
  const row = result.rows[0];
  if (
    row?.legacy_organizations !== "1" ||
    row.legacy_claims !== "5" ||
    row.disabled_guards !== "0" ||
    row.target_organizations !== "0"
  ) {
    throw new Error(
      `${label} did not roll back atomically: ${JSON.stringify(row)}`,
    );
  }
}

try {
  await client.connect();

  await resetFixture();
  await apply("testing/validate_carrier_tenant_storage.sql");
  await apply(manifestFile);
  await apply(cutoverFile);
  await apply(validationFile);
  await apply(cutoverFile);
  await apply(validationFile);
  process.stdout.write(
    "Verified successful carrier tenant cutover and SQL idempotency.\n",
  );

  await resetFixture();
  await apply(manifestFile);
  await client.query(`
    UPDATE public.claims
    SET carrier = 'Unmapped Model Carrier'
    WHERE id = '10000000-0000-4000-8000-000000000005'
  `);
  await expectCutoverFailure(/Unmapped carrier/i, "unmapped carrier abort");
  await assertFailedCutoverRolledBack("Unmapped carrier abort");

  await resetFixture();
  await apply(manifestFile);
  await client.query(`
    DELETE FROM private.carrier_tenant_storage_manifest
    WHERE document_id = '20000000-0000-4000-8000-000000000002'
  `);
  await expectCutoverFailure(
    /absent or unverified|missing or stale/i,
    "missing manifest abort",
  );
  await assertFailedCutoverRolledBack("Missing manifest abort");

  process.stdout.write(
    "Carrier tenant migration rehearsal passed: success, constraints, exact counts, memberships, storage mapping, idempotency, unmapped-carrier abort, and missing-manifest abort.\n",
  );
} finally {
  await client.end();
}
