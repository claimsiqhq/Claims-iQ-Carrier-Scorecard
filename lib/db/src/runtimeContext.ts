import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type pg from "pg";
import * as schema from "./schema";

export type WorkspaceDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseSessionSettings {
  userId?: string | null;
  sessionId?: string | null;
  organizationId?: string | null;
  jobId?: string | null;
  workerId?: string | null;
}

export interface ScopedDatabaseLease {
  readonly database: WorkspaceDatabase;
  readonly client: pg.PoolClient;
  readonly pool: pg.Pool;
  readonly settings: DatabaseSessionSettings;
  readonly isReleased: boolean;
  release(): Promise<void>;
}

type RuntimeDatabaseStore =
  | { plane: "unbound-request" }
  | {
      plane: "tenant";
      lease: ScopedDatabaseLease;
    }
  | {
      plane: "operations";
      database: WorkspaceDatabase;
      pool: pg.Pool;
    };

const runtimeDatabaseStorage = new AsyncLocalStorage<RuntimeDatabaseStore>();

interface SerializedPoolClient {
  client: pg.PoolClient;
  drain(): Promise<void>;
}

function serializePoolClient(client: pg.PoolClient): SerializedPoolClient {
  let tail: Promise<void> = Promise.resolve();

  const serialized = new Proxy(client, {
    get(target, property) {
      if (property !== "query") {
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }

      return (...args: unknown[]) => {
        const result = tail.then(
          () =>
            Reflect.apply(
              target.query,
              target,
              args,
            ) as Promise<unknown>,
        );
        tail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      };
    },
  });

  return {
    client: serialized,
    drain: () => tail,
  };
}

async function applySessionSettings(
  client: pg.PoolClient,
  settings: DatabaseSessionSettings,
): Promise<void> {
  await client.query(
    `
      SELECT
        set_config('app.user_id', $1, false),
        set_config('app.organization_id', $2, false),
        set_config('app.session_id', $3, false),
        set_config('app.job_id', $4, false),
        set_config('app.worker_id', $5, false)
    `,
    [
      settings.userId ?? "",
      settings.organizationId ?? "",
      settings.sessionId ?? "",
      settings.jobId ?? "",
      settings.workerId ?? "",
    ],
  );
}

async function resetSessionSettings(client: pg.PoolClient): Promise<void> {
  // ROLLBACK is harmless without an active transaction and recovers a client
  // left in an aborted transaction before the settings are cleared.
  await client.query("ROLLBACK");
  await client.query(`
    SELECT
      set_config('app.user_id', '', false),
      set_config('app.organization_id', '', false),
      set_config('app.session_id', '', false),
      set_config('app.job_id', '', false),
      set_config('app.worker_id', '', false)
  `);
}

export async function acquireScopedDatabase(
  pool: pg.Pool,
  settings: DatabaseSessionSettings,
): Promise<ScopedDatabaseLease> {
  const client = await pool.connect();
  let released = false;

  try {
    await applySessionSettings(client, settings);
  } catch (error) {
    client.release(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }

  const serialized = serializePoolClient(client);

  return {
    database: drizzle(serialized.client, { schema }),
    client: serialized.client,
    pool,
    settings,
    get isReleased() {
      return released;
    },
    async release() {
      if (released) return;
      released = true;
      try {
        await serialized.drain();
        await resetSessionSettings(client);
        client.release();
      } catch (error) {
        client.release(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    },
  };
}

export function runWithUnboundDatabaseRequest<T>(callback: () => T): T {
  return runtimeDatabaseStorage.run({ plane: "unbound-request" }, callback);
}

export function runWithOperationsDatabase<T>(
  database: WorkspaceDatabase,
  pool: pg.Pool,
  callback: () => T,
): T {
  return runtimeDatabaseStorage.run(
    { plane: "operations", database, pool },
    callback,
  );
}

export function runWithTenantDatabase<T>(
  lease: ScopedDatabaseLease,
  callback: () => T,
): T {
  return runtimeDatabaseStorage.run({ plane: "tenant", lease }, callback);
}

export const runWithScopedDatabase = runWithTenantDatabase;

function activeStore(): RuntimeDatabaseStore | undefined {
  return runtimeDatabaseStorage.getStore();
}

function databaseForStore(
  operationsDatabase: WorkspaceDatabase,
): WorkspaceDatabase {
  const store = activeStore();
  if (!store) return operationsDatabase;
  if (store.plane === "unbound-request") {
    throw new Error(
      "Database access denied: this HTTP request has no validated tenant or operations context.",
    );
  }
  if (store.plane === "operations") return store.database;
  if (store.lease.isReleased) {
    throw new Error(
      "Database access denied: the request tenant connection has already been released.",
    );
  }
  return store.lease.database;
}

export function createContextDatabaseProxy(
  operationsDatabase: WorkspaceDatabase,
): WorkspaceDatabase {
  return new Proxy({} as WorkspaceDatabase, {
    get(_target, property) {
      const database = databaseForStore(operationsDatabase);
      const value = Reflect.get(database, property, database) as unknown;
      return typeof value === "function" ? value.bind(database) : value;
    },
  });
}

async function acquireContextTenantClient(
  tenantPool: pg.Pool,
  settings: DatabaseSessionSettings,
): Promise<pg.PoolClient> {
  const client = await tenantPool.connect();
  let released = false;
  try {
    await applySessionSettings(client, settings);
  } catch (error) {
    client.release(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }

  const serialized = serializePoolClient(client);
  return new Proxy(serialized.client, {
    get(target, property) {
      if (property === "release") {
        return (releaseError?: Error | boolean) => {
          if (released) return;
          released = true;
          if (releaseError) {
            client.release(releaseError);
            return;
          }
          void serialized
            .drain()
            .then(() => resetSessionSettings(client))
            .then(() => client.release())
            .catch((error: unknown) => {
              client.release(
                error instanceof Error ? error : new Error(String(error)),
              );
            });
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function poolForStore(operationsPool: pg.Pool): pg.Pool {
  const store = activeStore();
  if (!store) return operationsPool;
  if (store.plane === "unbound-request") {
    throw new Error(
      "Database pool access denied: this HTTP request has no validated tenant or operations context.",
    );
  }
  if (store.plane === "operations") return store.pool;

  if (store.lease.isReleased) {
    throw new Error(
      "Database pool access denied: the request tenant connection has already been released.",
    );
  }

  return new Proxy(store.lease.pool, {
    get(target, property) {
      if (property === "query") {
        return store.lease.client.query.bind(store.lease.client);
      }
      if (property === "connect") {
        return () =>
          acquireContextTenantClient(store.lease.pool, store.lease.settings);
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createContextPoolProxy(operationsPool: pg.Pool): pg.Pool {
  return new Proxy(operationsPool, {
    get(_target, property) {
      const pool = poolForStore(operationsPool);
      const value = Reflect.get(pool, property, pool) as unknown;
      return typeof value === "function" ? value.bind(pool) : value;
    },
  });
}
