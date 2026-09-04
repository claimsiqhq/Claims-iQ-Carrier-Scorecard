import {
  CARRIER_TENANT_IDS,
  CLAIM_DOCUMENTS_BUCKET,
  createMigrationSupabaseClient,
  type MigrationDatabaseClient,
} from "./carrierTenantStorageCutover";

// The SQL purge that this storage step precedes. migrate.ts runs the storage
// purge only while this filename is not yet recorded as applied.
export const TENANT_PURGE_MIGRATION =
  "20260904160000_purge_allstate_wawanesa_tenants.sql";

// Explicit allowlist of retired tenants. Each entry must still match the live
// organizations row (id, slug, and name) before any object is removed, so a
// database where these deterministic UUIDs mean something else fails closed.
export const PURGED_TENANTS = [
  {
    organizationId: CARRIER_TENANT_IDS.organizations.allstate,
    slug: "allstate",
    name: "Allstate",
  },
  {
    organizationId: CARRIER_TENANT_IDS.organizations.wawanesa,
    slug: "wawanesa",
    name: "Wawanesa",
  },
] as const;

// Supabase Storage rejects remove() calls with more than 1000 paths; stay far
// below that so a single failed batch is small and the retry is cheap.
const DEFAULT_REMOVE_BATCH_SIZE = 100;
const DEFAULT_LIST_PAGE_SIZE = 1000;
const MAX_STORAGE_BATCH = 1000;
const MAX_FOLDER_DEPTH = 64;

export interface TenantPurgeStorageEntry {
  name: string;
  // Folders come back from list() with a null id and null metadata.
  id?: string | null;
  metadata?: unknown;
}

interface TenantPurgeStorageError {
  message: string;
}

export interface TenantPurgeStorageBucket {
  list(
    prefix: string,
    options: {
      limit: number;
      offset: number;
      sortBy: { column: string; order: string };
    },
  ): Promise<{
    data: TenantPurgeStorageEntry[] | null;
    error: TenantPurgeStorageError | null;
  }>;
  remove(
    paths: string[],
  ): Promise<{ data: unknown; error: TenantPurgeStorageError | null }>;
}

export interface TenantPurgeStorageClient {
  from(bucket: string): TenantPurgeStorageBucket;
}

export interface TenantStoragePurgeOrganizationResult {
  slug: string;
  prefix: string;
  status: "purged" | "absent";
  removedCount: number;
  batchCount: number;
}

export interface TenantStoragePurgeResult {
  bucket: string;
  organizations: TenantStoragePurgeOrganizationResult[];
  removedCount: number;
}

export interface TenantStoragePurgeOptions {
  storage?: TenantPurgeStorageClient;
  environment?: Record<string, string | undefined>;
  bucket?: string;
  listPageSize?: number;
  removeBatchSize?: number;
}

interface OrganizationIdentityRow {
  id: string;
  slug: string;
  name: string;
  in_flight_jobs: number | string;
}

export interface PurgedTenantIdentity {
  organizationId: string;
  slug: string;
  // "confirmed" tenants still exist and matched exactly; "absent" tenants were
  // already purged, so there is nothing to confirm and nothing to delete.
  status: "confirmed" | "absent";
}

export function tenantStoragePrefix(organizationId: string): string {
  return `organizations/${organizationId}`;
}

export function createTenantPurgeStorageClient(
  environment: Record<string, string | undefined> = process.env,
): TenantPurgeStorageClient {
  return createMigrationSupabaseClient(environment).storage;
}

function validateBatchSize(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_STORAGE_BATCH) {
    throw new Error(`${name} must be an integer between 1 and ${MAX_STORAGE_BATCH}`);
  }
  return value;
}

// Read-only identity preflight. Storage deletion is irreversible and happens
// outside the SQL transaction, so it runs the same checks the SQL purge will:
// every present organization must match id + slug + name exactly, the approved
// slug may not belong to a different UUID, and no work may be in flight.
// An organization that is entirely absent was already purged and is skipped.
export async function confirmPurgedTenantIdentities(
  client: MigrationDatabaseClient,
): Promise<PurgedTenantIdentity[]> {
  const result = await client.query(
    `
      SELECT
        organization.id::text AS id,
        organization.slug,
        organization.name,
        (
          SELECT count(*)
          FROM public.processing_jobs AS job
          WHERE job.organization_id = organization.id
            AND job.status IN (
              'queued'::public.processing_job_state,
              'running'::public.processing_job_state
            )
        )::int AS in_flight_jobs
      FROM public.organizations AS organization
      WHERE organization.id = ANY($1::uuid[])
         OR organization.slug = ANY($2::text[])
    `,
    [
      PURGED_TENANTS.map((tenant) => tenant.organizationId),
      PURGED_TENANTS.map((tenant) => tenant.slug),
    ],
  );
  const rows = result.rows as unknown as OrganizationIdentityRow[];

  const identities: PurgedTenantIdentity[] = [];
  for (const tenant of PURGED_TENANTS) {
    const byId = rows.find((row) => row.id === tenant.organizationId);
    if (byId) {
      if (byId.slug !== tenant.slug || byId.name !== tenant.name) {
        throw new Error(
          `Organization ${tenant.organizationId} is not the approved ${tenant.slug} tenant (slug "${byId.slug}", name "${byId.name}"); refusing to purge storage`,
        );
      }
      const inFlightJobs = Number(byId.in_flight_jobs);
      if (!Number.isFinite(inFlightJobs) || inFlightJobs > 0) {
        throw new Error(
          `Tenant ${tenant.slug} still has ${byId.in_flight_jobs} queued or running processing job(s); refusing to purge storage`,
        );
      }
      identities.push({
        organizationId: tenant.organizationId,
        slug: tenant.slug,
        status: "confirmed",
      });
      continue;
    }

    const bySlug = rows.find((row) => row.slug === tenant.slug);
    if (bySlug) {
      throw new Error(
        `Slug ${tenant.slug} is owned by organization ${bySlug.id}, not the approved ${tenant.organizationId}; refusing to purge storage`,
      );
    }
    identities.push({
      organizationId: tenant.organizationId,
      slug: tenant.slug,
      status: "absent",
    });
  }
  return identities;
}

// Supabase Storage list() returns one folder level at a time and paginates, so
// walk every nested folder (claims/<id>/documents/<id>/..., renditions/...)
// and return the full object paths beneath the prefix.
export async function listTenantStorageObjects(
  storage: TenantPurgeStorageClient,
  bucket: string,
  prefix: string,
  pageSize: number = DEFAULT_LIST_PAGE_SIZE,
): Promise<string[]> {
  validateBatchSize("listPageSize", pageSize);
  const bucketApi = storage.from(bucket);
  const objectPaths: string[] = [];

  const walk = async (folder: string, depth: number): Promise<void> => {
    if (depth > MAX_FOLDER_DEPTH) {
      throw new Error(
        `Storage listing exceeded ${MAX_FOLDER_DEPTH} nested folders at ${bucket}/${folder}`,
      );
    }
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await bucketApi.list(folder, {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) {
        throw new Error(
          `Unable to list ${bucket}/${folder}: ${error.message}`,
        );
      }
      const entries = data ?? [];
      for (const entry of entries) {
        if (!entry.name) {
          throw new Error(
            `Storage listing returned an unnamed entry under ${bucket}/${folder}`,
          );
        }
        const entryPath = `${folder}/${entry.name}`;
        const isFolder = entry.id == null && entry.metadata == null;
        if (isFolder) {
          await walk(entryPath, depth + 1);
        } else {
          objectPaths.push(entryPath);
        }
      }
      if (entries.length < pageSize) break;
    }
  };

  await walk(prefix, 0);
  return objectPaths.sort();
}

async function purgeTenantPrefix(
  storage: TenantPurgeStorageClient,
  bucket: string,
  tenant: PurgedTenantIdentity,
  pageSize: number,
  batchSize: number,
): Promise<TenantStoragePurgeOrganizationResult> {
  const prefix = tenantStoragePrefix(tenant.organizationId);
  const bucketApi = storage.from(bucket);
  const objectPaths = await listTenantStorageObjects(
    storage,
    bucket,
    prefix,
    pageSize,
  );

  let batchCount = 0;
  for (let index = 0; index < objectPaths.length; index += batchSize) {
    const batch = objectPaths.slice(index, index + batchSize);
    const { error } = await bucketApi.remove(batch);
    if (error) {
      throw new Error(
        `Unable to remove ${batch.length} object(s) under ${bucket}/${prefix}: ${error.message}`,
      );
    }
    batchCount += 1;
  }

  const remaining = await listTenantStorageObjects(
    storage,
    bucket,
    prefix,
    pageSize,
  );
  if (remaining.length > 0) {
    throw new Error(
      `${remaining.length} object(s) remain under ${bucket}/${prefix}/ after the purge; refusing to continue`,
    );
  }

  return {
    slug: tenant.slug,
    prefix: `${prefix}/`,
    status: "purged",
    removedCount: objectPaths.length,
    batchCount,
  };
}

// Removes every object under organizations/<id>/ for each retired tenant and
// verifies the prefixes list empty afterwards. Idempotent: an empty prefix is a
// successful no-op, so a failed deploy can simply rerun the migration step.
export async function runTenantStoragePurge(
  client: MigrationDatabaseClient,
  options: TenantStoragePurgeOptions = {},
): Promise<TenantStoragePurgeResult> {
  const bucket = options.bucket ?? CLAIM_DOCUMENTS_BUCKET;
  const pageSize = validateBatchSize(
    "listPageSize",
    options.listPageSize ?? DEFAULT_LIST_PAGE_SIZE,
  );
  const batchSize = validateBatchSize(
    "removeBatchSize",
    options.removeBatchSize ?? DEFAULT_REMOVE_BATCH_SIZE,
  );

  const identities = await confirmPurgedTenantIdentities(client);
  // The Supabase client is only constructed once at least one tenant is
  // positively confirmed, so environments that never held these tenants do not
  // need the migration storage credentials.
  const storage =
    identities.some((tenant) => tenant.status === "confirmed")
      ? (options.storage ??
        createTenantPurgeStorageClient(options.environment))
      : null;

  const organizations: TenantStoragePurgeOrganizationResult[] = [];
  for (const tenant of identities) {
    if (tenant.status === "absent" || !storage) {
      organizations.push({
        slug: tenant.slug,
        prefix: `${tenantStoragePrefix(tenant.organizationId)}/`,
        status: "absent",
        removedCount: 0,
        batchCount: 0,
      });
      continue;
    }
    organizations.push(
      await purgeTenantPrefix(storage, bucket, tenant, pageSize, batchSize),
    );
  }

  return {
    bucket,
    organizations,
    removedCount: organizations.reduce(
      (total, organization) => total + organization.removedCount,
      0,
    ),
  };
}
