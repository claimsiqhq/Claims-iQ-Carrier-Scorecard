import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";
import logger from "./lib/logger";

const MIGRATION_LOCK = "complete_iq_schema_migrations";
const MIGRATION_DIRECTORY = path.resolve(
  process.cwd(),
  "lib/db/migrations",
);
const MIGRATION_FILE_PATTERN = /^\d{4}_.+\.sql$/;

function checksum(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function removeOuterTransaction(contents: string): string {
  const normalized = contents.replace(/^\uFEFF/, "");
  if (
    /^\s*BEGIN;\s*/i.test(normalized)
    && /\s*COMMIT;\s*$/i.test(normalized)
  ) {
    return normalized
      .replace(/^\s*BEGIN;\s*/i, "")
      .replace(/\s*COMMIT;\s*$/i, "");
  }
  return normalized;
}

async function migrate(): Promise<void> {
  if (!process.env.SUPABASE_DATABASE_URL && !process.env.DATABASE_URL) {
    throw new Error("SUPABASE_DATABASE_URL or DATABASE_URL must be set.");
  }

  const migrationFiles = (await readdir(MIGRATION_DIRECTORY))
    .filter((name) => MIGRATION_FILE_PATTERN.test(name))
    .sort();

  if (migrationFiles.length === 0) {
    throw new Error(`No migrations found in ${MIGRATION_DIRECTORY}.`);
  }

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK]);
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
    await pool.end();
  })
  .catch(async (error) => {
    logger.error({ error }, "Database migration failed");
    await pool.end().catch(() => undefined);
    process.exitCode = 1;
  });
