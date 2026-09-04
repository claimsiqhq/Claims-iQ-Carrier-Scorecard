import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const CARRIER_TENANT_STORAGE_RUN_KEY = "carrier-tenant-cutover-v1";
export const CLAIM_DOCUMENTS_BUCKET = "claim-documents";
export const QUARANTINE_BUCKET = "carrier-tenant-migration-quarantine";
export const RETENTION_APPROVAL =
  "delete-carrier-tenant-legacy-objects-after-verified-cutover";

export const CARRIER_TENANT_IDS = {
  organizations: {
    allstate: "a11a0000-0000-4000-8000-000000000001",
    andover: "a11a0000-0000-4000-8000-000000000002",
    wawanesa: "a11a0000-0000-4000-8000-000000000003",
  },
  entities: {
    allstate: "e11e0000-0000-4000-8000-000000000001",
    andover: "e11e0000-0000-4000-8000-000000000002",
    bayState: "e11e0000-0000-4000-8000-000000000003",
    cambridgeMutual: "e11e0000-0000-4000-8000-000000000004",
    merrimackMutual: "e11e0000-0000-4000-8000-000000000005",
    wawanesa: "e11e0000-0000-4000-8000-000000000006",
  },
} as const;

const CARRIER_MAPPING = new Map<
  string,
  { organizationId: string; entityId: string }
>([
  [
    "Allstate",
    {
      organizationId: CARRIER_TENANT_IDS.organizations.allstate,
      entityId: CARRIER_TENANT_IDS.entities.allstate,
    },
  ],
  [
    "Andover",
    {
      organizationId: CARRIER_TENANT_IDS.organizations.andover,
      entityId: CARRIER_TENANT_IDS.entities.andover,
    },
  ],
  [
    "Bay State Insurance Company",
    {
      organizationId: CARRIER_TENANT_IDS.organizations.andover,
      entityId: CARRIER_TENANT_IDS.entities.bayState,
    },
  ],
  [
    "Cambridge Mutual",
    {
      organizationId: CARRIER_TENANT_IDS.organizations.andover,
      entityId: CARRIER_TENANT_IDS.entities.cambridgeMutual,
    },
  ],
  [
    "Merrimack Mutual",
    {
      organizationId: CARRIER_TENANT_IDS.organizations.andover,
      entityId: CARRIER_TENANT_IDS.entities.merrimackMutual,
    },
  ],
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const CANONICAL_DOCUMENT_PATH_RE =
  /^organizations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/claims\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

interface QueryResult<Row> {
  rows: Row[];
  rowCount: number | null;
}

export interface MigrationDatabaseClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Record<string, unknown>>>;
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export interface MigrationStorageAdapter {
  listAll(bucket: string): Promise<string[]>;
  download(bucket: string, objectPath: string): Promise<StoredObject | null>;
  upload(
    bucket: string,
    objectPath: string,
    object: StoredObject,
  ): Promise<void>;
  remove(bucket: string, objectPath: string): Promise<void>;
}

interface DocumentInventoryRow {
  document_id: string;
  claim_id: string;
  file_url: string | null;
  carrier: string | null;
  manifest_source_path: string | null;
}

interface PlannedObject {
  disposition: "referenced" | "quarantine";
  sourceBucket: string;
  sourcePath: string;
  destinationBucket: string;
  destinationPath: string;
  documentId: string | null;
  organizationId: string | null;
  claimId: string | null;
}

interface VerifiedObject extends PlannedObject {
  sourceSize: number;
  sourceSha256: string;
  destinationSize: number;
  destinationSha256: string;
  copied: boolean;
  destinationVerified: boolean;
}

interface ManifestIdentityRow {
  source_bucket: string;
  source_path: string;
  destination_bucket: string;
  destination_path: string;
  disposition: string;
  document_id: string | null;
  organization_id: string | null;
  claim_id: string | null;
}

interface ManifestDeletionRow extends ManifestIdentityRow {
  source_size: string | number;
  source_sha256: string;
  destination_size: string | number;
  destination_sha256: string;
  verified_at: Date | string;
  source_deleted_at: Date | string | null;
}

export interface StorageCutoverResult {
  mode: "preflight" | "copy";
  referencedCount: number;
  quarantineCount: number;
  inventoryCount: number;
  inventorySha256: string;
  copiedCount: number;
  alreadyVerifiedCount: number;
  pendingCopyCount: number;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fingerprint(object: StoredObject): { size: number; hash: string } {
  return {
    size: object.body.byteLength,
    hash: sha256(object.body),
  };
}

function requiredEnvironmentValue(
  environment: Record<string, string | undefined>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateSupabaseUrl(value: string): string {
  const normalized = value.replace(/\/$/, "");
  const productionUrl = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(
    normalized,
  );
  const localUrl =
    process.env.NODE_ENV !== "production" &&
    /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/i.test(normalized);
  if (!productionUrl && !localUrl) {
    throw new Error(
      "SUPABASE_URL must be an https://*.supabase.co URL (or localhost outside production)",
    );
  }
  return normalized;
}

function isNotFoundError(error: {
  message?: string;
  statusCode?: string | number;
}): boolean {
  return (
    String(error.statusCode ?? "") === "404" ||
    /not found|does not exist/i.test(error.message ?? "")
  );
}

class SupabaseMigrationStorageAdapter implements MigrationStorageAdapter {
  constructor(private readonly client: SupabaseClient) {}

  async listAll(bucket: string): Promise<string[]> {
    const objectPaths: string[] = [];
    const visitedFolders = new Set<string>();

    const walk = async (prefix: string, depth: number): Promise<void> => {
      if (depth > 64) {
        throw new Error(`Storage inventory exceeded 64 folders at ${prefix}`);
      }
      if (visitedFolders.has(prefix)) return;
      visitedFolders.add(prefix);

      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await this.client.storage
          .from(bucket)
          .list(prefix, {
            limit: pageSize,
            offset,
            sortBy: { column: "name", order: "asc" },
          });
        if (error) {
          throw new Error(
            `Unable to list migration storage bucket ${bucket}: ${error.message}`,
          );
        }

        for (const entry of data) {
          const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          const isFolder = !entry.id && entry.metadata == null;
          if (isFolder) {
            await walk(objectPath, depth + 1);
          } else {
            objectPaths.push(objectPath);
          }
        }
        if (data.length < pageSize) break;
      }
    };

    await walk("", 0);
    return objectPaths.sort();
  }

  async download(
    bucket: string,
    objectPath: string,
  ): Promise<StoredObject | null> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .download(objectPath);
    if (error) {
      if (isNotFoundError(error)) return null;
      throw new Error(
        `Unable to download ${bucket}/${objectPath}: ${error.message}`,
      );
    }
    if (!data) return null;
    return {
      body: Buffer.from(await data.arrayBuffer()),
      contentType: data.type || "application/octet-stream",
    };
  }

  async upload(
    bucket: string,
    objectPath: string,
    object: StoredObject,
  ): Promise<void> {
    const { error } = await this.client.storage
      .from(bucket)
      .upload(objectPath, object.body, {
        contentType: object.contentType || "application/octet-stream",
        upsert: false,
      });
    if (error) {
      throw new Error(
        `Unable to upload ${bucket}/${objectPath}: ${error.message}`,
      );
    }
  }

  async remove(bucket: string, objectPath: string): Promise<void> {
    const { error } = await this.client.storage
      .from(bucket)
      .remove([objectPath]);
    if (error) {
      throw new Error(
        `Unable to remove ${bucket}/${objectPath}: ${error.message}`,
      );
    }
  }
}

// Migration-only Supabase client. It authenticates with the dedicated
// MIGRATION_SUPABASE_SERVICE_ROLE secret, never the runtime service-role name.
export function createMigrationSupabaseClient(
  environment: Record<string, string | undefined> = process.env,
): SupabaseClient {
  const supabaseUrl = validateSupabaseUrl(
    requiredEnvironmentValue(environment, "SUPABASE_URL"),
  );
  const serviceRole = requiredEnvironmentValue(
    environment,
    "MIGRATION_SUPABASE_SERVICE_ROLE",
  );
  return createClient(supabaseUrl, serviceRole, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export function createSupabaseMigrationStorageAdapter(
  environment: Record<string, string | undefined> = process.env,
): MigrationStorageAdapter {
  return new SupabaseMigrationStorageAdapter(
    createMigrationSupabaseClient(environment),
  );
}

export function resolveCarrierMapping(carrier: string): {
  organizationId: string;
  entityId: string;
} {
  const mapping = CARRIER_MAPPING.get(carrier);
  if (!mapping) {
    throw new Error(
      `Unmapped carrier "${carrier}" in carrier tenant storage preflight`,
    );
  }
  return mapping;
}

export function sanitizeMigrationFilename(fileName: string): string {
  const normalized = (fileName || "document")
    .normalize("NFKC")
    .replace(/\\/g, "/");
  const basename = normalized.split("/").pop() || "document";
  let safeName = basename
    .replace(/%[0-9A-Fa-f]{2}/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[._-]+/, "")
    .slice(0, 255);
  if (!safeName) safeName = "document";
  if (!/^[A-Za-z0-9]/.test(safeName)) safeName = `document_${safeName}`;
  if (
    !SAFE_FILE_NAME_RE.test(safeName) ||
    safeName === "." ||
    safeName === ".."
  ) {
    throw new Error("Unable to produce a safe migration storage filename");
  }
  return safeName;
}

export function buildMigrationDocumentPath(input: {
  organizationId: string;
  claimId: string;
  documentId: string;
  sourcePath: string;
}): string {
  for (const [label, value] of [
    ["organizationId", input.organizationId],
    ["claimId", input.claimId],
    ["documentId", input.documentId],
  ] as const) {
    if (!UUID_RE.test(value)) {
      throw new Error(`${label} must be a canonical lowercase UUID`);
    }
  }
  const fileName = sanitizeMigrationFilename(input.sourcePath);
  return `organizations/${input.organizationId}/claims/${input.claimId}/documents/${input.documentId}/${fileName}`;
}

function isCanonicalDocumentPath(objectPath: string): boolean {
  return (
    CANONICAL_DOCUMENT_PATH_RE.test(objectPath) &&
    !/%[0-9A-Fa-f]{2}|[\\\u0000-\u001f\u007f]/.test(objectPath)
  );
}

function validateLegacySourcePath(objectPath: string): void {
  const segments = objectPath.split("/");
  if (
    !objectPath ||
    objectPath.length > 1024 ||
    objectPath.startsWith("/") ||
    /[\\\u0000-\u001f\u007f]/.test(objectPath) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe or ambiguous legacy storage path: ${objectPath}`);
  }
}

async function requireSourceObject(
  storage: MigrationStorageAdapter,
  bucket: string,
  objectPath: string,
): Promise<StoredObject> {
  const object = await storage.download(bucket, objectPath);
  if (!object) {
    throw new Error(
      `Referenced legacy object is absent: ${bucket}/${objectPath}`,
    );
  }
  return object;
}

export async function verifyOrCopyObject(
  storage: MigrationStorageAdapter,
  planned: PlannedObject,
  mode: "preflight" | "copy",
): Promise<VerifiedObject> {
  const source = await requireSourceObject(
    storage,
    planned.sourceBucket,
    planned.sourcePath,
  );
  const sourceFingerprint = fingerprint(source);
  let destination = await storage.download(
    planned.destinationBucket,
    planned.destinationPath,
  );
  let copied = false;

  if (!destination && mode === "copy") {
    try {
      await storage.upload(
        planned.destinationBucket,
        planned.destinationPath,
        source,
      );
      copied = true;
    } catch (uploadError) {
      destination = await storage.download(
        planned.destinationBucket,
        planned.destinationPath,
      );
      if (!destination) throw uploadError;
    }
    destination ??= await storage.download(
      planned.destinationBucket,
      planned.destinationPath,
    );
  }

  if (destination) {
    const destinationFingerprint = fingerprint(destination);
    if (
      destinationFingerprint.size !== sourceFingerprint.size ||
      destinationFingerprint.hash !== sourceFingerprint.hash
    ) {
      throw new Error(
        `Destination collision or verification failure at ${planned.destinationBucket}/${planned.destinationPath}`,
      );
    }
    return {
      ...planned,
      sourceSize: sourceFingerprint.size,
      sourceSha256: sourceFingerprint.hash,
      destinationSize: destinationFingerprint.size,
      destinationSha256: destinationFingerprint.hash,
      copied,
      destinationVerified: true,
    };
  }

  if (mode === "copy") {
    throw new Error(
      `Copied destination is absent: ${planned.destinationBucket}/${planned.destinationPath}`,
    );
  }

  return {
    ...planned,
    sourceSize: sourceFingerprint.size,
    sourceSha256: sourceFingerprint.hash,
    destinationSize: sourceFingerprint.size,
    destinationSha256: sourceFingerprint.hash,
    copied: false,
    destinationVerified: false,
  };
}

function asRows<Row>(
  result: QueryResult<Record<string, unknown>>,
): QueryResult<Row> {
  return result as unknown as QueryResult<Row>;
}

async function loadDocumentPlans(
  client: MigrationDatabaseClient,
): Promise<PlannedObject[]> {
  let result: QueryResult<DocumentInventoryRow>;
  try {
    result = asRows<DocumentInventoryRow>(
      await client.query(`
        SELECT
          document.id::text AS document_id,
          document.claim_id::text AS claim_id,
          document.file_url,
          claim.carrier,
          manifest.source_path AS manifest_source_path
        FROM public.documents AS document
        JOIN public.claims AS claim
          ON claim.id = document.claim_id
        LEFT JOIN private.carrier_tenant_storage_manifest AS manifest
          ON manifest.document_id = document.id
         AND manifest.disposition = 'referenced'
        ORDER BY document.id
      `),
    );
  } catch (error) {
    throw new Error(
      "Carrier tenant storage schema prerequisites are missing; apply the foundation, RLS, and storage migrations first",
      { cause: error },
    );
  }

  const seenSources = new Set<string>();
  const plans: PlannedObject[] = [];
  for (const row of result.rows) {
    if (!row.claim_id) {
      throw new Error(`Document ${row.document_id} has no claim`);
    }
    if (!row.carrier) {
      throw new Error(`Claim ${row.claim_id} has no explicit carrier mapping`);
    }
    const mapping = resolveCarrierMapping(row.carrier);
    const currentPath = row.file_url?.trim();
    if (!currentPath) {
      throw new Error(`Document ${row.document_id} has no legacy file_url`);
    }
    const sourcePath = isCanonicalDocumentPath(currentPath)
      ? row.manifest_source_path
      : currentPath;
    if (!sourcePath) {
      throw new Error(
        `Document ${row.document_id} is canonical but has no durable source manifest`,
      );
    }
    validateLegacySourcePath(sourcePath);
    if (seenSources.has(sourcePath)) {
      throw new Error(
        `Legacy storage path ${sourcePath} is referenced by multiple documents`,
      );
    }
    seenSources.add(sourcePath);

    plans.push({
      disposition: "referenced",
      sourceBucket: CLAIM_DOCUMENTS_BUCKET,
      sourcePath,
      destinationBucket: CLAIM_DOCUMENTS_BUCKET,
      destinationPath: buildMigrationDocumentPath({
        organizationId: mapping.organizationId,
        claimId: row.claim_id,
        documentId: row.document_id,
        sourcePath,
      }),
      documentId: row.document_id,
      organizationId: mapping.organizationId,
      claimId: row.claim_id,
    });
  }
  return plans;
}

function buildQuarantinePlan(sourcePath: string): PlannedObject {
  validateLegacySourcePath(sourcePath);
  return {
    disposition: "quarantine",
    sourceBucket: CLAIM_DOCUMENTS_BUCKET,
    sourcePath,
    destinationBucket: QUARANTINE_BUCKET,
    destinationPath: `unreferenced/${sha256(sourcePath)}/${sanitizeMigrationFilename(sourcePath)}`,
    documentId: null,
    organizationId: null,
    claimId: null,
  };
}

function manifestIdentityMatches(
  existing: ManifestIdentityRow,
  verified: VerifiedObject,
): boolean {
  return (
    existing.source_bucket === verified.sourceBucket &&
    existing.source_path === verified.sourcePath &&
    existing.destination_bucket === verified.destinationBucket &&
    existing.destination_path === verified.destinationPath &&
    existing.disposition === verified.disposition &&
    existing.document_id === verified.documentId &&
    existing.organization_id === verified.organizationId &&
    existing.claim_id === verified.claimId
  );
}

async function writeVerifiedManifest(
  client: MigrationDatabaseClient,
  verified: VerifiedObject,
): Promise<void> {
  const conflicts = asRows<ManifestIdentityRow>(
    await client.query(
      `
        SELECT
          source_bucket,
          source_path,
          destination_bucket,
          destination_path,
          disposition,
          document_id::text AS document_id,
          organization_id::text AS organization_id,
          claim_id::text AS claim_id
        FROM private.carrier_tenant_storage_manifest
        WHERE (source_bucket = $1 AND source_path = $2)
           OR (destination_bucket = $3 AND destination_path = $4)
           OR ($5::uuid IS NOT NULL AND document_id = $5::uuid)
      `,
      [
        verified.sourceBucket,
        verified.sourcePath,
        verified.destinationBucket,
        verified.destinationPath,
        verified.documentId,
      ],
    ),
  );
  if (
    conflicts.rows.some(
      (existing) => !manifestIdentityMatches(existing, verified),
    )
  ) {
    throw new Error(
      `Migration manifest collision for ${verified.sourceBucket}/${verified.sourcePath}`,
    );
  }

  await client.query(
    `
      INSERT INTO private.carrier_tenant_storage_manifest (
        source_bucket,
        source_path,
        destination_bucket,
        destination_path,
        disposition,
        document_id,
        organization_id,
        claim_id,
        source_size,
        source_sha256,
        destination_size,
        destination_sha256,
        copied_at,
        verified_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::uuid,
        $7::uuid,
        $8::uuid,
        $9,
        $10,
        $11,
        $12,
        clock_timestamp(),
        clock_timestamp()
      )
      ON CONFLICT (source_bucket, source_path)
      DO UPDATE SET
        source_size = EXCLUDED.source_size,
        source_sha256 = EXCLUDED.source_sha256,
        destination_size = EXCLUDED.destination_size,
        destination_sha256 = EXCLUDED.destination_sha256,
        verified_at = EXCLUDED.verified_at,
        updated_at = clock_timestamp()
    `,
    [
      verified.sourceBucket,
      verified.sourcePath,
      verified.destinationBucket,
      verified.destinationPath,
      verified.disposition,
      verified.documentId,
      verified.organizationId,
      verified.claimId,
      verified.sourceSize,
      verified.sourceSha256,
      verified.destinationSize,
      verified.destinationSha256,
    ],
  );
}

function inventoryDigest(verifiedObjects: VerifiedObject[]): string {
  const canonicalInventory = verifiedObjects
    .map((object) =>
      [
        object.disposition,
        object.sourceBucket,
        object.sourcePath,
        object.sourceSize,
        object.sourceSha256,
        object.destinationBucket,
        object.destinationPath,
        object.destinationSize,
        object.destinationSha256,
      ].join("\u0000"),
    )
    .sort()
    .join("\n");
  return sha256(canonicalInventory);
}

export async function runCarrierTenantStorageCutover(
  client: MigrationDatabaseClient,
  options: {
    mode: "preflight" | "copy";
    storage?: MigrationStorageAdapter;
    environment?: Record<string, string | undefined>;
  },
): Promise<StorageCutoverResult> {
  const storage =
    options.storage ??
    createSupabaseMigrationStorageAdapter(options.environment);
  const referencedPlans = await loadDocumentPlans(client);
  const sourceInventory = await storage.listAll(CLAIM_DOCUMENTS_BUCKET);
  const sourceSet = new Set(sourceInventory);

  for (const plan of referencedPlans) {
    if (!sourceSet.has(plan.sourcePath)) {
      throw new Error(
        `Referenced legacy object is absent from inventory: ${plan.sourcePath}`,
      );
    }
  }

  const referencedSources = new Set(
    referencedPlans.map((plan) => plan.sourcePath),
  );
  const quarantinePlans = sourceInventory
    .filter(
      (objectPath) =>
        !isCanonicalDocumentPath(objectPath) &&
        !referencedSources.has(objectPath),
    )
    .map(buildQuarantinePlan);
  const plans = [...referencedPlans, ...quarantinePlans];
  const verifiedObjects: VerifiedObject[] = [];

  for (const plan of plans) {
    const verified = await verifyOrCopyObject(storage, plan, options.mode);
    verifiedObjects.push(verified);
    if (options.mode === "copy") {
      await writeVerifiedManifest(client, verified);
    }
  }

  const finalLegacyInventory = (await storage.listAll(CLAIM_DOCUMENTS_BUCKET))
    .filter((objectPath) => !isCanonicalDocumentPath(objectPath))
    .sort();
  const initialLegacyInventory = sourceInventory
    .filter((objectPath) => !isCanonicalDocumentPath(objectPath))
    .sort();
  if (
    finalLegacyInventory.length !== initialLegacyInventory.length ||
    finalLegacyInventory.some(
      (objectPath, index) => objectPath !== initialLegacyInventory[index],
    )
  ) {
    throw new Error(
      "Legacy storage inventory changed during copy verification; refusing to complete the manifest run",
    );
  }

  const digest = inventoryDigest(verifiedObjects);
  if (options.mode === "copy") {
    await client.query(
      `
        INSERT INTO private.carrier_tenant_storage_runs (
          run_key,
          source_bucket,
          referenced_count,
          quarantine_count,
          inventory_count,
          inventory_sha256,
          copy_completed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())
        ON CONFLICT (run_key)
        DO UPDATE SET
          source_bucket = EXCLUDED.source_bucket,
          referenced_count = EXCLUDED.referenced_count,
          quarantine_count = EXCLUDED.quarantine_count,
          inventory_count = EXCLUDED.inventory_count,
          inventory_sha256 = EXCLUDED.inventory_sha256,
          copy_completed_at = EXCLUDED.copy_completed_at,
          updated_at = clock_timestamp()
      `,
      [
        CARRIER_TENANT_STORAGE_RUN_KEY,
        CLAIM_DOCUMENTS_BUCKET,
        referencedPlans.length,
        quarantinePlans.length,
        plans.length,
        digest,
      ],
    );
  }

  return {
    mode: options.mode,
    referencedCount: referencedPlans.length,
    quarantineCount: quarantinePlans.length,
    inventoryCount: plans.length,
    inventorySha256: digest,
    copiedCount: verifiedObjects.filter((object) => object.copied).length,
    alreadyVerifiedCount: verifiedObjects.filter(
      (object) => !object.copied && object.destinationVerified,
    ).length,
    pendingCopyCount: verifiedObjects.filter(
      (object) => !object.destinationVerified,
    ).length,
  };
}

export async function deleteLegacyCarrierTenantStorage(
  client: MigrationDatabaseClient,
  options: {
    retentionApproval: string | undefined;
    storage?: MigrationStorageAdapter;
    environment?: Record<string, string | undefined>;
  },
): Promise<{ deletedCount: number; alreadyDeletedCount: number }> {
  if (options.retentionApproval !== RETENTION_APPROVAL) {
    throw new Error(
      `Legacy deletion requires MIGRATION_RETENTION_APPROVED=${RETENTION_APPROVAL}`,
    );
  }
  const applied = asRows<{ applied: boolean }>(
    await client.query(
      `
        SELECT
          pg_catalog.to_regclass(
            'public.complete_iq_schema_migrations'
          ) IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.complete_iq_schema_migrations
            WHERE filename =
              '20260810232004_carrier_tenant_data_cutover.sql'
          ) AS applied
      `,
    ),
  );
  if (applied.rows[0]?.applied !== true) {
    throw new Error(
      "Legacy objects cannot be deleted before the carrier tenant data cutover is recorded as applied",
    );
  }

  const storage =
    options.storage ??
    createSupabaseMigrationStorageAdapter(options.environment);
  const manifests = asRows<ManifestDeletionRow>(
    await client.query(`
      SELECT
        source_bucket,
        source_path,
        destination_bucket,
        destination_path,
        disposition,
        document_id::text AS document_id,
        organization_id::text AS organization_id,
        claim_id::text AS claim_id,
        source_size,
        source_sha256,
        destination_size,
        destination_sha256,
        verified_at,
        source_deleted_at
      FROM private.carrier_tenant_storage_manifest
      ORDER BY source_bucket, source_path
    `),
  );
  if (manifests.rows.length === 0) {
    throw new Error("The verified migration manifest is empty");
  }

  let deletedCount = 0;
  let alreadyDeletedCount = 0;
  for (const manifest of manifests.rows) {
    if (
      manifest.source_bucket === manifest.destination_bucket &&
      manifest.source_path === manifest.destination_path
    ) {
      throw new Error(
        `Refusing to delete a source that equals its destination: ${manifest.source_path}`,
      );
    }
    const destination = await storage.download(
      manifest.destination_bucket,
      manifest.destination_path,
    );
    if (!destination) {
      throw new Error(
        `Verified destination is absent: ${manifest.destination_bucket}/${manifest.destination_path}`,
      );
    }
    const destinationFingerprint = fingerprint(destination);
    if (
      destinationFingerprint.size !== Number(manifest.destination_size) ||
      destinationFingerprint.hash !== manifest.destination_sha256 ||
      manifest.destination_sha256 !== manifest.source_sha256
    ) {
      throw new Error(
        `Verified destination changed: ${manifest.destination_bucket}/${manifest.destination_path}`,
      );
    }

    const source = await storage.download(
      manifest.source_bucket,
      manifest.source_path,
    );
    if (!source) {
      alreadyDeletedCount += 1;
    } else {
      const sourceFingerprint = fingerprint(source);
      if (
        sourceFingerprint.size !== Number(manifest.source_size) ||
        sourceFingerprint.hash !== manifest.source_sha256
      ) {
        throw new Error(
          `Legacy source changed after verification: ${manifest.source_bucket}/${manifest.source_path}`,
        );
      }
      await storage.remove(manifest.source_bucket, manifest.source_path);
      if (
        await storage.download(manifest.source_bucket, manifest.source_path)
      ) {
        throw new Error(
          `Legacy source still exists after deletion: ${manifest.source_bucket}/${manifest.source_path}`,
        );
      }
      deletedCount += 1;
    }
    await client.query(
      `
        UPDATE private.carrier_tenant_storage_manifest
        SET
          source_deleted_at = COALESCE(
            source_deleted_at,
            clock_timestamp()
          ),
          updated_at = clock_timestamp()
        WHERE source_bucket = $1
          AND source_path = $2
      `,
      [manifest.source_bucket, manifest.source_path],
    );
  }

  return { deletedCount, alreadyDeletedCount };
}
