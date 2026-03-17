import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "SUPABASE_DATABASE_URL or DATABASE_URL must be set.",
  );
}

let connStr = connectionString;
if (connStr.includes("supabase") && !connStr.includes("sslmode")) {
  connStr += connStr.includes("?") ? "&sslmode=require" : "?sslmode=require";
}

const poolConfig: pg.PoolConfig = {
  connectionString: connStr,
  ssl: connStr.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 10000,
};

export const pool = new Pool(poolConfig);
export const db = drizzle(pool, { schema });

export * from "./schema";
