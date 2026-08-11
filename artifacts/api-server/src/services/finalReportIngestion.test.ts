import test from "node:test";
import assert from "node:assert/strict";
import type { ScopedDatabaseLease } from "@workspace/db";
import { createTenantStorageCapability } from "../lib/supabaseStorage";
import { createFinalReportIngestionCapability } from "./finalReportIngestion";

const ORGANIZATION_A = "00000000-0000-4000-8000-000000000001";
const ORGANIZATION_B = "00000000-0000-4000-8000-000000000002";

function lease(
  settings: ScopedDatabaseLease["settings"],
): ScopedDatabaseLease {
  return {
    settings,
    isReleased: false,
    database: {} as ScopedDatabaseLease["database"],
  } as ScopedDatabaseLease;
}

test("final-report ingestion rejects mismatched database and storage scopes", () => {
  const storage = createTenantStorageCapability({
    organizationId: ORGANIZATION_A,
    userId: "user-a",
    sessionId: "session-a",
  });

  assert.throws(
    () =>
      createFinalReportIngestionCapability({
        databaseLease: lease({
          organizationId: ORGANIZATION_B,
          userId: "user-a",
          sessionId: "session-a",
        }),
        storage,
        claimId: "10000000-0000-4000-8000-000000000001",
        documentId: "20000000-0000-4000-8000-000000000001",
        uploaderUserId: "user-a",
      }),
    /matching live database and storage scopes/i,
  );
});

test("final-report ingestion requires tenant-session or worker-lease proof", () => {
  const storage = createTenantStorageCapability({
    organizationId: ORGANIZATION_A,
    userId: "user-a",
    sessionId: "session-a",
  });

  assert.throws(
    () =>
      createFinalReportIngestionCapability({
        databaseLease: lease({ organizationId: ORGANIZATION_A }),
        storage,
        claimId: "10000000-0000-4000-8000-000000000001",
        documentId: "20000000-0000-4000-8000-000000000001",
        uploaderUserId: "user-a",
      }),
    /tenant session or leased worker job/i,
  );
});
