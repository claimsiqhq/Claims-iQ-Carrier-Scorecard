import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireScopedDatabase,
  createContextDatabaseProxy,
  runWithTenantDatabase,
  runWithUnboundDatabaseRequest,
  type WorkspaceDatabase,
} from "@workspace/db";

test("scoped database connections set and reset every runtime identity value", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  let releasedWith: Error | undefined;
  const client = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return { rows: [], rowCount: 0 };
    },
    release(error?: Error) {
      releasedWith = error;
    },
  };
  const pool = {
    async connect() {
      return client;
    },
  } as unknown as Parameters<typeof acquireScopedDatabase>[0];

  const lease = await acquireScopedDatabase(pool, {
    userId: "user-1",
    organizationId: "10000000-0000-4000-8000-000000000001",
    sessionId: "stored-session-id",
    jobId: "20000000-0000-4000-8000-000000000001",
    workerId: "worker-1",
  });
  assert.deepEqual(queries[0]?.values, [
    "user-1",
    "10000000-0000-4000-8000-000000000001",
    "stored-session-id",
    "20000000-0000-4000-8000-000000000001",
    "worker-1",
  ]);

  await lease.release();
  await lease.release();

  assert.equal(queries.filter(({ text }) => text === "ROLLBACK").length, 1);
  assert.match(queries.at(-1)?.text ?? "", /app\.worker_id/);
  assert.equal(releasedWith, undefined);
  assert.equal(lease.isReleased, true);
});

test("database facade fails closed in an unbound HTTP context", () => {
  const operations = {
    select: () => "operations",
  } as unknown as WorkspaceDatabase;
  const facade = createContextDatabaseProxy(operations);

  assert.equal((facade.select as unknown as () => string)(), "operations");
  runWithUnboundDatabaseRequest(() => {
    assert.throws(
      () => (facade.select as unknown as () => string)(),
      /no validated tenant or operations context/,
    );
  });
});

test("runWithTenantDatabase keeps the store until a returned promise settles", async () => {
  const operations = {
    select: () => "operations",
  } as unknown as WorkspaceDatabase;
  const facade = createContextDatabaseProxy(operations);
  const lease = {
    database: { select: () => "tenant" },
    client: {},
    pool: {},
    settings: {},
    isReleased: false,
    async release() {},
  } as unknown as Awaited<ReturnType<typeof acquireScopedDatabase>>;

  const seen = await runWithTenantDatabase(lease, async () => {
    await new Promise((resolve) => setImmediate(resolve));
    return (facade.select as unknown as () => string)();
  });

  assert.equal(seen, "tenant");
});

test("scoped clients serialize concurrent node-postgres queries", async () => {
  let activeQueries = 0;
  let maximumConcurrency = 0;
  const client = {
    async query(text: string) {
      if (text.startsWith("parallel-")) {
        activeQueries += 1;
        maximumConcurrency = Math.max(maximumConcurrency, activeQueries);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeQueries -= 1;
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  } as unknown as Parameters<typeof acquireScopedDatabase>[0];
  const lease = await acquireScopedDatabase(pool, {
    userId: "user-1",
    organizationId: "10000000-0000-4000-8000-000000000001",
    sessionId: "session-1",
  });

  await Promise.all([
    lease.client.query("parallel-one"),
    lease.client.query("parallel-two"),
    lease.client.query("parallel-three"),
  ]);
  await lease.release();

  assert.equal(maximumConcurrency, 1);
});
