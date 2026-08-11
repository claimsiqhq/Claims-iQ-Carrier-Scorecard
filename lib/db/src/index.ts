import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import {
  acquireScopedDatabase,
  createContextDatabaseProxy,
  createContextPoolProxy,
  runWithOperationsDatabase,
  type DatabaseSessionSettings,
} from "./runtimeContext";
import {
  databaseUrlUsesTls,
  resolveDatabaseRuntimeConfig,
  resolveMigrationDatabaseUrl,
} from "./runtimeConfig";

const { Pool } = pg;

const CAPABILITY_ROLES = [
  "claims_iq_identity",
  "claims_iq_tenant_api",
  "claims_iq_platform_admin",
  "claims_iq_worker",
] as const;

type CapabilityRole = (typeof CAPABILITY_ROLES)[number];
type PoolConnectCallback = (
  error: Error | undefined,
  client: pg.PoolClient | undefined,
  done: (release?: unknown) => void,
) => void;

/**
 * Supabase's session pooler does not reliably forward the libpq `options`
 * startup parameter. Bind the least-privilege capability explicitly before a
 * checked-out client can execute application SQL.
 */
class CapabilityPool extends Pool {
  constructor(
    config: pg.PoolConfig,
    private readonly capabilityRole: CapabilityRole,
  ) {
    super(config);
  }

  private async bindCapabilityRole(
    client: pg.PoolClient,
  ): Promise<pg.PoolClient> {
    await client.query(`SET ROLE ${this.capabilityRole}`);
    return client;
  }

  override connect(): Promise<pg.PoolClient>;
  override connect(callback: PoolConnectCallback): void;
  override connect(
    callback?: PoolConnectCallback,
  ): Promise<pg.PoolClient> | void {
    if (!callback) {
      return super.connect().then(async (client) => {
        try {
          return await this.bindCapabilityRole(client);
        } catch (error) {
          const connectionError =
            error instanceof Error ? error : new Error(String(error));
          client.release(connectionError);
          throw connectionError;
        }
      });
    }

    super.connect((error, client, done) => {
      if (error || !client) {
        callback(error, client, done);
        return;
      }

      void this.bindCapabilityRole(client).then(
        () => callback(undefined, client, done),
        (roleError: unknown) => {
          const connectionError =
            roleError instanceof Error
              ? roleError
              : new Error(String(roleError));
          done(connectionError);
          callback(connectionError, undefined, () => undefined);
        },
      );
    });
  }
}

function createPool(
  connectionString: string,
  applicationName: string,
  max: number,
  capabilityRole?: CapabilityRole,
): pg.Pool {
  const poolConfig: pg.PoolConfig = {
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: 10000,
    max,
    idleTimeoutMillis: 30000,
  };
  if (capabilityRole) {
    poolConfig.options = `-c role=${capabilityRole}`;
  }
  if (databaseUrlUsesTls(connectionString)) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  return capabilityRole
    ? new CapabilityPool(poolConfig, capabilityRole)
    : new Pool(poolConfig);
}

export const runtimeDatabaseConfig = resolveDatabaseRuntimeConfig();

export const identityPool = createPool(
  runtimeDatabaseConfig.identityUrl,
  "complete-iq-identity",
  10,
  runtimeDatabaseConfig.usedUnrestrictedFallback
    ? undefined
    : "claims_iq_identity",
);
export const tenantPool = createPool(
  runtimeDatabaseConfig.tenantUrl,
  "complete-iq-tenant-api",
  20,
  runtimeDatabaseConfig.usedUnrestrictedFallback
    ? undefined
    : "claims_iq_tenant_api",
);
export const platformPool = createPool(
  runtimeDatabaseConfig.platformUrl,
  "complete-iq-platform",
  5,
  runtimeDatabaseConfig.usedUnrestrictedFallback
    ? undefined
    : "claims_iq_platform_admin",
);
export const operationsPool = createPool(
  runtimeDatabaseConfig.operationsUrl,
  "complete-iq-operations",
  10,
  runtimeDatabaseConfig.usedUnrestrictedFallback
    ? undefined
    : "claims_iq_worker",
);

export const identityDb = drizzle(identityPool, { schema });
export const platformDb = drizzle(platformPool, { schema });
export const operationsDb = drizzle(operationsPool, { schema });

/**
 * Compatibility facade for existing route/service imports. HTTP requests are
 * denied until middleware binds a validated tenant or operations context.
 * Code running outside an HTTP context (durable workers) uses operationsDb.
 */
export const db = createContextDatabaseProxy(operationsDb);
export const pool = createContextPoolProxy(operationsPool);

export async function acquireTenantDatabase(
  settings: DatabaseSessionSettings & {
    userId: string;
    sessionId: string;
    organizationId: string;
  },
) {
  return acquireScopedDatabase(tenantPool, settings);
}

export async function acquireWorkerDatabase(settings: {
  organizationId: string;
  jobId: string;
  workerId: string;
}) {
  return acquireScopedDatabase(operationsPool, settings);
}

export async function acquireWorkerControlDatabase(workerId: string) {
  return acquireScopedDatabase(operationsPool, { workerId });
}

export async function withPlatformDatabaseContext<T>(
  settings: { userId: string; sessionId: string },
  callback: (database: typeof platformDb) => Promise<T>,
): Promise<T> {
  const lease = await acquireScopedDatabase(platformPool, {
    ...settings,
    organizationId: null,
  });
  try {
    return await callback(lease.database as typeof platformDb);
  } finally {
    await lease.release();
  }
}

export function runWithOperationsContext<T>(callback: () => T): T {
  return runWithOperationsDatabase(operationsDb, operationsPool, callback);
}

let migrationPool: pg.Pool | undefined;

export function getMigrationPool(): pg.Pool {
  migrationPool ??= createPool(
    resolveMigrationDatabaseUrl(),
    "complete-iq-migrations",
    2,
  );
  return migrationPool;
}

export async function closeRuntimePools(): Promise<void> {
  await Promise.all([
    identityPool.end(),
    tenantPool.end(),
    platformPool.end(),
    operationsPool.end(),
  ]);
}

export * from "./runtimeConfig";
export * from "./runtimeContext";
export * from "./schema";
