import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMigrationDocumentPath,
  CARRIER_TENANT_IDS,
  createSupabaseMigrationStorageAdapter,
  resolveCarrierMapping,
  type MigrationStorageAdapter,
  type StoredObject,
  verifyOrCopyObject,
} from "./carrierTenantStorageCutover";

class MemoryStorage implements MigrationStorageAdapter {
  readonly objects = new Map<string, StoredObject>();
  uploadCount = 0;
  removeCount = 0;

  private key(bucket: string, objectPath: string): string {
    return `${bucket}\u0000${objectPath}`;
  }

  put(
    bucket: string,
    objectPath: string,
    body: string,
    contentType = "application/pdf",
  ): void {
    this.objects.set(this.key(bucket, objectPath), {
      body: Buffer.from(body),
      contentType,
    });
  }

  async listAll(bucket: string): Promise<string[]> {
    const prefix = `${bucket}\u0000`;
    return [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort();
  }

  async download(
    bucket: string,
    objectPath: string,
  ): Promise<StoredObject | null> {
    const object = this.objects.get(this.key(bucket, objectPath));
    return object
      ? {
          body: Buffer.from(object.body),
          contentType: object.contentType,
        }
      : null;
  }

  async upload(
    bucket: string,
    objectPath: string,
    object: StoredObject,
  ): Promise<void> {
    const key = this.key(bucket, objectPath);
    if (this.objects.has(key)) throw new Error("duplicate");
    this.objects.set(key, {
      body: Buffer.from(object.body),
      contentType: object.contentType,
    });
    this.uploadCount += 1;
  }

  async remove(bucket: string, objectPath: string): Promise<void> {
    this.objects.delete(this.key(bucket, objectPath));
    this.removeCount += 1;
  }
}

const referencedPlan = {
  disposition: "referenced" as const,
  sourceBucket: "claim-documents",
  sourcePath: "legacy/claim.pdf",
  destinationBucket: "claim-documents",
  destinationPath:
    "organizations/a11a0000-0000-4000-8000-000000000002/claims/10000000-0000-4000-8000-000000000001/documents/20000000-0000-4000-8000-000000000001/claim.pdf",
  documentId: "20000000-0000-4000-8000-000000000001",
  organizationId: CARRIER_TENANT_IDS.organizations.andover,
  claimId: "10000000-0000-4000-8000-000000000001",
};

test("verified migration copy is hash-checked and idempotent", async () => {
  const storage = new MemoryStorage();
  storage.put("claim-documents", "legacy/claim.pdf", "verified content");

  const first = await verifyOrCopyObject(storage, referencedPlan, "copy");
  assert.equal(first.copied, true);
  assert.equal(first.sourceSha256, first.destinationSha256);
  assert.equal(first.sourceSize, first.destinationSize);
  assert.equal(storage.uploadCount, 1);

  const resumed = await verifyOrCopyObject(storage, referencedPlan, "copy");
  assert.equal(resumed.copied, false);
  assert.equal(resumed.destinationSha256, first.destinationSha256);
  assert.equal(storage.uploadCount, 1);
});

test("preflight reads and hashes without creating a destination", async () => {
  const storage = new MemoryStorage();
  storage.put("claim-documents", "legacy/claim.pdf", "preflight content");

  const result = await verifyOrCopyObject(storage, referencedPlan, "preflight");
  assert.equal(result.copied, false);
  assert.equal(result.destinationVerified, false);
  assert.equal(result.sourceSha256, result.destinationSha256);
  assert.equal(storage.uploadCount, 0);
  assert.equal(
    await storage.download(
      referencedPlan.destinationBucket,
      referencedPlan.destinationPath,
    ),
    null,
  );
});

test("an existing destination with different bytes fails closed", async () => {
  const storage = new MemoryStorage();
  storage.put("claim-documents", "legacy/claim.pdf", "source");
  storage.put(
    referencedPlan.destinationBucket,
    referencedPlan.destinationPath,
    "different",
  );

  await assert.rejects(
    verifyOrCopyObject(storage, referencedPlan, "copy"),
    /collision or verification failure/i,
  );
  assert.equal(storage.uploadCount, 0);
});

test("carrier mappings are exact allowlist matches", () => {
  assert.deepEqual(resolveCarrierMapping("Andover"), {
    organizationId: CARRIER_TENANT_IDS.organizations.andover,
    entityId: CARRIER_TENANT_IDS.entities.andover,
  });
  assert.throws(() => resolveCarrierMapping("andover"), /unmapped carrier/i);
  assert.throws(
    () => resolveCarrierMapping("Model Suggested Carrier"),
    /unmapped carrier/i,
  );
});

test("canonical migration paths use deterministic ownership tuples", () => {
  assert.equal(
    buildMigrationDocumentPath({
      organizationId: CARRIER_TENANT_IDS.organizations.allstate,
      claimId: "10000000-0000-4000-8000-000000000002",
      documentId: "20000000-0000-4000-8000-000000000002",
      sourcePath: "../../legacy claim%2e.pdf",
    }),
    "organizations/a11a0000-0000-4000-8000-000000000001/claims/10000000-0000-4000-8000-000000000002/documents/20000000-0000-4000-8000-000000000002/legacy_claim_.pdf",
  );
});

test("migration storage never falls back to the runtime service-role name", () => {
  assert.throws(
    () =>
      createSupabaseMigrationStorageAdapter({
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_SERVICE_ROLE: "runtime-key-must-not-be-used",
      }),
    /MIGRATION_SUPABASE_SERVICE_ROLE is required/,
  );
});
