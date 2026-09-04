import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getMigrationPool } from "@workspace/db";
import logger from "./lib/logger";
import {
  runCarrierTenantStorageCutover,
  type MigrationDatabaseClient,
} from "./migrations/carrierTenantStorageCutover";
import {
  isMigrationFilename,
  removeOuterTransaction,
} from "./migrations/migrationFiles";
import {
  runTenantStoragePurge,
  TENANT_PURGE_MIGRATION,
} from "./migrations/tenantStoragePurge";

const MIGRATION_LOCK = "complete_iq_schema_migrations";
const CARRIER_TENANT_CUTOVER_MIGRATION =
  "20260810232004_carrier_tenant_data_cutover.sql";
// pnpm runs filtered scripts from the package directory, while the migrations
// live at the repository root. The production CJS bundle is emitted to dist/,
// so resolve from the bundle directory instead of the working directory.
const MIGRATION_DIRECTORY = path.resolve(
  __dirname,
  "../../../lib/db/migrations",
);
let migrationPool: ReturnType<typeof getMigrationPool> | undefined;

function checksum(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function migrate(): Promise<void> {
  const pool = getMigrationPool();
  migrationPool = pool;

  const migrationFiles = (await readdir(MIGRATION_DIRECTORY))
    // Keep the original ordered migrations and accept Supabase CLI timestamped
    // migrations. Directories and helper SQL names do not match.
    .filter(isMigrationFilename)
    .sort();

  if (migrationFiles.length === 0) {
    throw new Error(`No migrations found in ${MIGRATION_DIRECTORY}.`);
  }

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [
      MIGRATION_LOCK,
    ]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.complete_iq_schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.complete_iq_schema_migrations ENABLE ROW LEVEL SECURITY;
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          REVOKE ALL ON TABLE public.complete_iq_schema_migrations FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE ALL ON TABLE public.complete_iq_schema_migrations FROM authenticated;
        END IF;
      END
      $$;
    `);

    for (const filename of migrationFiles) {
      const filePath = path.join(MIGRATION_DIRECTORY, filename);
      const contents = await readFile(filePath, "utf8");
      const fileChecksum = checksum(contents);
      const existing = await client.query<{ checksum: string }>(
        `
          SELECT checksum
          FROM public.complete_iq_schema_migrations
          WHERE filename = $1
        `,
        [filename],
      );

      if (existing.rowCount) {
        if (existing.rows[0]?.checksum !== fileChecksum) {
          throw new Error(
            `Applied migration ${filename} has changed; refusing to continue.`,
          );
        }
        logger.info({ filename }, "Schema migration already applied");
        continue;
      }

      if (filename === CARRIER_TENANT_CUTOVER_MIGRATION) {
        const storageResult = await runCarrierTenantStorageCutover(
          client as unknown as MigrationDatabaseClient,
          { mode: "copy" },
        );
        logger.info(
          storageResult,
          "Carrier tenant storage copy verified before SQL cutover",
        );
      }

      if (filename === TENANT_PURGE_MIGRATION) {
        // Storage objects are removed before the SQL purge so a failed deploy
        // retries cleanly: the purge is idempotent and an empty prefix is fine.
        const purgeResult = await runTenantStoragePurge(
          client as unknown as MigrationDatabaseClient,
        );
        logger.info(
          purgeResult,
          "Retired tenant storage purge verified before SQL purge",
        );
      }

      await client.query("BEGIN");
      try {
        await client.query(removeOuterTransaction(contents));
        await client.query(
          `
            INSERT INTO public.complete_iq_schema_migrations (filename, checksum)
            VALUES ($1, $2)
          `,
          [filename, fileChecksum],
        );
        await client.query("COMMIT");
        logger.info({ filename }, "Schema migration applied");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK])
      .catch(() => undefined);
    client.release();
  }
}

migrate()
  .then(async () => {
    logger.info("Database schema is current");
    await migrationPool?.end();
  })
  .catch(async (error) => {
    logger.error({ error }, "Database migration failed");
    await migrationPool?.end().catch(() => undefined);
    process.exitCode = 1;
  });
