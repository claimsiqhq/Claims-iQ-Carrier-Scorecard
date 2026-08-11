import { getMigrationPool } from "@workspace/db";
import logger from "./lib/logger";
import {
  deleteLegacyCarrierTenantStorage,
  RETENTION_APPROVAL,
  runCarrierTenantStorageCutover,
  type MigrationDatabaseClient,
} from "./migrations/carrierTenantStorageCutover";

const MIGRATION_LOCK = "complete_iq_schema_migrations";
const command = process.argv[2];
let pool: ReturnType<typeof getMigrationPool> | undefined;

async function run(): Promise<void> {
  if (!["preflight", "copy", "delete-legacy"].includes(command ?? "")) {
    throw new Error(
      "Expected carrier tenant storage command: preflight, copy, or delete-legacy",
    );
  }

  pool = getMigrationPool();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [
      MIGRATION_LOCK,
    ]);
    const migrationClient = client as unknown as MigrationDatabaseClient;

    if (command === "delete-legacy") {
      const result = await deleteLegacyCarrierTenantStorage(migrationClient, {
        retentionApproval: process.env.MIGRATION_RETENTION_APPROVED?.trim(),
      });
      logger.info(
        result,
        "Retention-approved carrier tenant legacy storage deletion completed",
      );
      return;
    }

    const mode = command === "preflight" ? "preflight" : "copy";
    const result = await runCarrierTenantStorageCutover(migrationClient, {
      mode,
    });
    logger.info(result, `Carrier tenant storage ${command} completed`);
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK])
      .catch(() => undefined);
    client.release();
  }
}

run()
  .then(async () => {
    await pool?.end();
  })
  .catch(async (error) => {
    logger.error(
      {
        error,
        retentionApproval:
          command === "delete-legacy" ? RETENTION_APPROVAL : undefined,
      },
      "Carrier tenant storage migration command failed",
    );
    await pool?.end().catch(() => undefined);
    process.exitCode = 1;
  });
