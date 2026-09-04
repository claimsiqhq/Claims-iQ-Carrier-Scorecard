import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CARRIER_TENANT_IDS,
  type MigrationDatabaseClient,
} from "./carrierTenantStorageCutover";
import { isMigrationFilename } from "./migrationFiles";
import {
  createTenantPurgeStorageClient,
  listTenantStorageObjects,
  PURGED_TENANTS,
  runTenantStoragePurge,
  TENANT_PURGE_MIGRATION,
  tenantStoragePrefix,
  type TenantPurgeStorageBucket,
  type TenantPurgeStorageClient,
  type TenantPurgeStorageEntry,
} from "./tenantStoragePurge";

const BUCKET = "claim-documents";
const ALLSTATE = CARRIER_TENANT_IDS.organizations.allstate;
const ANDOVER = CARRIER_TENANT_IDS.organizations.andover;
const WAWANESA = CARRIER_TENANT_IDS.organizations.wawanesa;
const ALLSTATE_PREFIX = tenantStoragePrefix(ALLSTATE);
const WAWANESA_PREFIX = tenantStoragePrefix(WAWANESA);
const ANDOVER_PREFIX = tenantStoragePrefix(ANDOVER);

// Mirrors Supabase Storage semantics: list() returns one folder level at a
// time (folders have a null id and null metadata), sorted by name and
// paginated with limit/offset; remove() deletes the given paths.
class FakeStorage implements TenantPurgeStorageClient {
  private readonly objects = new Map<string, Set<string>>();
  readonly listCalls: Array<{
    bucket: string;
    prefix: string;
    limit: number;
    offset: number;
  }> = [];
  readonly removeCalls: Array<{ bucket: string; paths: string[] }> = [];
  removeIsNoOp = false;
  listError: string | null = null;
  removeError: string | null = null;

  put(bucket: string, objectPath: string): void {
    let paths = this.objects.get(bucket);
    if (!paths) {
      paths = new Set();
      this.objects.set(bucket, paths);
    }
    paths.add(objectPath);
  }

  paths(bucket: string): string[] {
    return [...(this.objects.get(bucket) ?? [])].sort();
  }

  from(bucket: string): TenantPurgeStorageBucket {
    return {
      list: async (prefix, options) => {
        this.listCalls.push({
          bucket,
          prefix,
          limit: options.limit,
          offset: options.offset,
        });
        if (this.listError) {
          return { data: null, error: { message: this.listError } };
        }
        const folderPrefix = `${prefix}/`;
        const children = new Map<string, TenantPurgeStorageEntry>();
        for (const objectPath of this.objects.get(bucket) ?? []) {
          if (!objectPath.startsWith(folderPrefix)) continue;
          const remainder = objectPath.slice(folderPrefix.length);
          const slash = remainder.indexOf("/");
          if (slash === -1) {
            children.set(remainder, {
              name: remainder,
              id: `object-${objectPath}`,
              metadata: { size: 1, mimetype: "application/pdf" },
            });
          } else {
            const folder = remainder.slice(0, slash);
            if (!children.has(folder)) {
              children.set(folder, { name: folder, id: null, metadata: null });
            }
          }
        }
        const sorted = [...children.values()].sort((left, right) =>
          left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
        );
        return {
          data: sorted.slice(options.offset, options.offset + options.limit),
          error: null,
        };
      },
      remove: async (paths) => {
        this.removeCalls.push({ bucket, paths: [...paths] });
        if (this.removeError) {
          return { data: null, error: { message: this.removeError } };
        }
        if (!this.removeIsNoOp) {
          for (const objectPath of paths) {
            this.objects.get(bucket)?.delete(objectPath);
          }
        }
        return { data: [], error: null };
      },
    };
  }
}

interface FakeOrganizationRow {
  id: string;
  slug: string;
  name: string;
  in_flight_jobs?: number;
}

// Answers the identity preflight the way public.organizations would: only the
// rows whose id or slug appears in the query parameters come back.
function fakeDatabase(
  organizations: FakeOrganizationRow[],
): MigrationDatabaseClient & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async query(text, values) {
      queries.push(text);
      const [ids, slugs] = (values ?? []) as [string[], string[]];
      const rows = organizations
        .filter(
          (organization) =>
            ids.includes(organization.id) || slugs.includes(organization.slug),
        )
        .map((organization) => ({
          id: organization.id,
          slug: organization.slug,
          name: organization.name,
          in_flight_jobs: organization.in_flight_jobs ?? 0,
        }));
      return { rows, rowCount: rows.length };
    },
  };
}

const approvedOrganizations: FakeOrganizationRow[] = [
  { id: ALLSTATE, slug: "allstate", name: "Allstate" },
  { id: ANDOVER, slug: "andover", name: "Andover" },
  { id: WAWANESA, slug: "wawanesa", name: "Wawanesa" },
];

const allstateObjects = [
  `${ALLSTATE_PREFIX}/claims/10000000-0000-4000-8000-000000000001/documents/20000000-0000-4000-8000-000000000001/loss-report.pdf`,
  `${ALLSTATE_PREFIX}/claims/10000000-0000-4000-8000-000000000001/documents/20000000-0000-4000-8000-000000000002/estimate.pdf`,
  `${ALLSTATE_PREFIX}/renditions/20000000-0000-4000-8000-000000000001/page-1.png`,
  `${ALLSTATE_PREFIX}/renditions/20000000-0000-4000-8000-000000000001/page-2.png`,
  `${ALLSTATE_PREFIX}/renditions/20000000-0000-4000-8000-000000000001/page-3.png`,
];
const untouchedObjects = [
  `${ANDOVER_PREFIX}/claims/10000000-0000-4000-8000-000000000003/documents/20000000-0000-4000-8000-000000000003/andover.pdf`,
  "legacy/orphan-1.bin",
];

function seededStorage(): FakeStorage {
  const storage = new FakeStorage();
  for (const objectPath of [...allstateObjects, ...untouchedObjects]) {
    storage.put(BUCKET, objectPath);
  }
  return storage;
}

test("listing recurses through nested folders and paginates each level", async () => {
  const storage = seededStorage();

  const listed = await listTenantStorageObjects(
    storage,
    BUCKET,
    ALLSTATE_PREFIX,
    2,
  );

  assert.deepEqual(listed, [...allstateObjects].sort());
  // The renditions folder holds three files, so a page size of two forces a
  // second page for that folder.
  const renditionPages = storage.listCalls.filter(
    (call) =>
      call.prefix ===
      `${ALLSTATE_PREFIX}/renditions/20000000-0000-4000-8000-000000000001`,
  );
  assert.deepEqual(
    renditionPages.map((call) => call.offset),
    [0, 2],
  );
  assert.ok(storage.listCalls.every((call) => call.limit === 2));
  assert.ok(
    storage.listCalls.every((call) => call.prefix.startsWith(ALLSTATE_PREFIX)),
  );
});

test("purge removes every nested object in bounded batches and leaves other tenants alone", async () => {
  const storage = seededStorage();
  const database = fakeDatabase(approvedOrganizations);

  const result = await runTenantStoragePurge(database, {
    storage,
    listPageSize: 2,
    removeBatchSize: 2,
  });

  assert.deepEqual(result, {
    bucket: BUCKET,
    removedCount: allstateObjects.length,
    organizations: [
      {
        slug: "allstate",
        prefix: `${ALLSTATE_PREFIX}/`,
        status: "purged",
        removedCount: 5,
        batchCount: 3,
      },
      {
        slug: "wawanesa",
        prefix: `${WAWANESA_PREFIX}/`,
        status: "purged",
        removedCount: 0,
        batchCount: 0,
      },
    ],
  });
  assert.deepEqual(storage.paths(BUCKET), [...untouchedObjects].sort());

  assert.equal(storage.removeCalls.length, 3);
  assert.ok(storage.removeCalls.every((call) => call.bucket === BUCKET));
  assert.ok(storage.removeCalls.every((call) => call.paths.length <= 2));
  const removedPaths = storage.removeCalls.flatMap((call) => call.paths);
  assert.deepEqual(removedPaths.sort(), [...allstateObjects].sort());
  assert.ok(
    removedPaths.every((objectPath) =>
      objectPath.startsWith(`${ALLSTATE_PREFIX}/`),
    ),
  );

  // Both prefixes were listed again after removal to prove they are empty.
  assert.ok(
    storage.listCalls.some(
      (call) => call.prefix === WAWANESA_PREFIX && call.offset === 0,
    ),
  );
  assert.ok(
    storage.listCalls.filter((call) => call.prefix === ALLSTATE_PREFIX)
      .length >= 2,
  );
});

test("an empty prefix is a successful no-op and reruns are idempotent", async () => {
  const storage = new FakeStorage();
  for (const objectPath of untouchedObjects) storage.put(BUCKET, objectPath);
  const database = fakeDatabase(approvedOrganizations);

  const first = await runTenantStoragePurge(database, { storage });
  assert.equal(first.removedCount, 0);
  assert.deepEqual(
    first.organizations.map((organization) => organization.status),
    ["purged", "purged"],
  );
  assert.equal(storage.removeCalls.length, 0);

  const second = await runTenantStoragePurge(database, { storage });
  assert.deepEqual(second, first);
  assert.equal(storage.removeCalls.length, 0);
  assert.deepEqual(storage.paths(BUCKET), [...untouchedObjects].sort());
});

test("objects that survive removal fail the purge closed", async () => {
  const storage = seededStorage();
  storage.removeIsNoOp = true;
  const database = fakeDatabase(approvedOrganizations);

  await assert.rejects(
    runTenantStoragePurge(database, { storage }),
    /5 object\(s\) remain under claim-documents\/organizations\/a11a0000-0000-4000-8000-000000000001\//,
  );
  assert.ok(storage.removeCalls.length >= 1);
});

test("storage list and remove errors propagate instead of being skipped", async () => {
  const listFailure = seededStorage();
  listFailure.listError = "Bucket not found";
  await assert.rejects(
    runTenantStoragePurge(fakeDatabase(approvedOrganizations), {
      storage: listFailure,
    }),
    /Unable to list claim-documents\/organizations\/.*Bucket not found/,
  );
  assert.equal(listFailure.removeCalls.length, 0);

  const removeFailure = seededStorage();
  removeFailure.removeError = "service unavailable";
  await assert.rejects(
    runTenantStoragePurge(fakeDatabase(approvedOrganizations), {
      storage: removeFailure,
    }),
    /Unable to remove 5 object\(s\).*service unavailable/,
  );
  assert.deepEqual(
    removeFailure.paths(BUCKET),
    [...allstateObjects, ...untouchedObjects].sort(),
  );
});

test("identity preflight refuses to touch storage when a tenant does not match", async () => {
  const cases: Array<{ rows: FakeOrganizationRow[]; expected: RegExp }> = [
    {
      rows: [
        { id: ALLSTATE, slug: "allstate-legacy", name: "Allstate" },
        { id: WAWANESA, slug: "wawanesa", name: "Wawanesa" },
      ],
      expected: /is not the approved allstate tenant/,
    },
    {
      rows: [
        { id: ALLSTATE, slug: "allstate", name: "Allstate" },
        { id: WAWANESA, slug: "wawanesa", name: "Wawanesa Insurance" },
      ],
      expected: /is not the approved wawanesa tenant/,
    },
    {
      rows: [
        {
          id: "a11a0000-0000-4000-8000-000000000009",
          slug: "allstate",
          name: "Allstate",
        },
        { id: WAWANESA, slug: "wawanesa", name: "Wawanesa" },
      ],
      expected:
        /Slug allstate is owned by organization a11a0000-0000-4000-8000-000000000009/,
    },
    {
      rows: [
        { id: ALLSTATE, slug: "allstate", name: "Allstate", in_flight_jobs: 2 },
        { id: WAWANESA, slug: "wawanesa", name: "Wawanesa" },
      ],
      expected: /Tenant allstate still has 2 queued or running processing job/,
    },
  ];

  for (const { rows, expected } of cases) {
    const storage = seededStorage();
    await assert.rejects(
      runTenantStoragePurge(fakeDatabase(rows), { storage }),
      expected,
    );
    assert.equal(storage.listCalls.length, 0);
    assert.equal(storage.removeCalls.length, 0);
    assert.deepEqual(
      storage.paths(BUCKET),
      [...allstateObjects, ...untouchedObjects].sort(),
    );
  }
});

test("identity preflight is a single read-only query", async () => {
  const database = fakeDatabase(approvedOrganizations);
  await runTenantStoragePurge(database, { storage: new FakeStorage() });

  assert.equal(database.queries.length, 1);
  const query = database.queries[0] ?? "";
  assert.match(query, /^\s*SELECT/i);
  assert.doesNotMatch(
    query,
    /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i,
  );
  assert.match(query, /FROM public\.organizations/);
  assert.match(query, /public\.processing_jobs/);
});

test("tenants that are already absent are skipped without storage credentials", async () => {
  // Neither organization exists: nothing is confirmed, so no Supabase client is
  // constructed and no environment variables are needed.
  const noneLeft = await runTenantStoragePurge(fakeDatabase([]), {
    environment: {},
  });
  assert.deepEqual(noneLeft, {
    bucket: BUCKET,
    removedCount: 0,
    organizations: [
      {
        slug: "allstate",
        prefix: `${ALLSTATE_PREFIX}/`,
        status: "absent",
        removedCount: 0,
        batchCount: 0,
      },
      {
        slug: "wawanesa",
        prefix: `${WAWANESA_PREFIX}/`,
        status: "absent",
        removedCount: 0,
        batchCount: 0,
      },
    ],
  });

  // Only Wawanesa remains: Allstate's prefix is never listed or touched.
  const storage = seededStorage();
  storage.put(BUCKET, `${WAWANESA_PREFIX}/claims/orphan.pdf`);
  const partial = await runTenantStoragePurge(
    fakeDatabase([{ id: WAWANESA, slug: "wawanesa", name: "Wawanesa" }]),
    { storage },
  );
  assert.deepEqual(
    partial.organizations.map((organization) => [
      organization.slug,
      organization.status,
      organization.removedCount,
    ]),
    [
      ["allstate", "absent", 0],
      ["wawanesa", "purged", 1],
    ],
  );
  assert.ok(
    storage.listCalls.every((call) => call.prefix.startsWith(WAWANESA_PREFIX)),
  );
  assert.deepEqual(
    storage.paths(BUCKET),
    [...allstateObjects, ...untouchedObjects].sort(),
  );
});

test("batch sizes stay within Supabase Storage limits", async () => {
  const database = fakeDatabase(approvedOrganizations);
  for (const options of [
    { removeBatchSize: 0 },
    { removeBatchSize: 1001 },
    { listPageSize: 0 },
    { listPageSize: 1.5 },
  ]) {
    await assert.rejects(
      runTenantStoragePurge(database, { storage: new FakeStorage(), ...options }),
      /must be an integer between 1 and 1000/,
    );
  }
});

test("purge storage client never falls back to the runtime service-role name", () => {
  assert.throws(
    () =>
      createTenantPurgeStorageClient({
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_SERVICE_ROLE: "runtime-key-must-not-be-used",
      }),
    /MIGRATION_SUPABASE_SERVICE_ROLE is required/,
  );
});

test("the storage purge hook is keyed to the SQL purge migration on disk", () => {
  const migrationDirectory = fileURLToPath(
    new URL("../../../../lib/db/migrations/", import.meta.url),
  );
  assert.equal(isMigrationFilename(TENANT_PURGE_MIGRATION), true);
  assert.ok(readdirSync(migrationDirectory).includes(TENANT_PURGE_MIGRATION));

  const migration = readFileSync(
    path.join(migrationDirectory, TENANT_PURGE_MIGRATION),
    "utf8",
  );
  for (const tenant of PURGED_TENANTS) {
    assert.ok(
      migration.includes(`'${tenant.organizationId}'`),
      `${tenant.slug} organization id is missing from the SQL purge`,
    );
    assert.ok(
      migration.includes(`'${tenant.slug}'`),
      `${tenant.slug} slug is missing from the SQL purge`,
    );
    assert.ok(
      migration.includes(`'${tenant.name}'`),
      `${tenant.slug} name is missing from the SQL purge`,
    );
  }
});
