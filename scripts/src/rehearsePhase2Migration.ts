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
const files = [
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
];

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  for (const relativePath of files) {
    const filePath = resolve(migrationDir, relativePath);
    const sql = await readFile(filePath, "utf8");
    await client.query(sql);
    await client.query("SET search_path TO public");
    process.stdout.write(`Applied ${relativePath}\n`);
  }
  process.stdout.write("Phase 2 migration rehearsal passed.\n");
} finally {
  await client.end();
}
