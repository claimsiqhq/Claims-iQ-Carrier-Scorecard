import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "@napi-rs/canvas";
import type { ScopedDatabaseLease } from "@workspace/db";
import { createTenantStorageCapability } from "../lib/supabaseStorage";
import {
  createFinalReportIngestionCapability,
  renderPdfPageRenditions,
} from "./finalReportIngestion";

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

test("page rendition backfill renders optimized JPEG pages without vision calls", async () => {
  const pdf = new PDFDocument({ title: "Rendition test" });
  for (let pageNumber = 1; pageNumber <= 2; pageNumber += 1) {
    const context = pdf.beginPage(612, 792);
    context.fillStyle = "#111111";
    context.font = "24px sans-serif";
    context.fillText(`Claim page ${pageNumber}`, 72, 96);
    pdf.endPage();
  }
  const pdfBuffer = pdf.close();
  const pages: Array<{
    pageNumber: number;
    width: number;
    height: number;
    jpegBuffer: Buffer;
  }> = [];

  const summary = await renderPdfPageRenditions({
    pdfBuffer,
    fileName: "claim.pdf",
    requestId: "rendition-test",
    onPageRendered: async (page) => {
      pages.push(page);
    },
  });

  assert.equal(summary.page_count, 2);
  assert.deepEqual(summary.rendered_pages, [1, 2]);
  assert.deepEqual(summary.failed_pages, []);
  assert.equal(pages.length, 2);
  assert.equal(pages[0]?.width, 1800);
  assert.equal(pages[0]?.jpegBuffer[0], 0xff);
  assert.equal(pages[0]?.jpegBuffer[1], 0xd8);
});
