import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import {
  buildCanonicalDocumentPath,
  createTenantStorageCapability,
  deleteFile,
  downloadFile,
  fileExists,
  getSignedUrl,
  MAX_SIGNED_URL_SECONDS,
  mintTenantStorageJwt,
  parseCanonicalDocumentPath,
  sanitizeStorageFilename,
  verifyTenantStorageJwt,
} from "./supabaseStorage";

const ORGANIZATION_A = "00000000-0000-4000-8000-000000000001";
const ORGANIZATION_B = "00000000-0000-4000-8000-000000000002";
const CLAIM_A = "10000000-0000-4000-8000-000000000001";
const CLAIM_B = "10000000-0000-4000-8000-000000000002";
const DOCUMENT_A = "20000000-0000-4000-8000-000000000001";
const DOCUMENT_B = "20000000-0000-4000-8000-000000000002";
const JWT_SECRET = "test-only-storage-jwt-secret-that-is-longer-than-32-bytes";

function configureStorageEnvironment(): void {
  process.env.SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
  delete process.env.SUPABASE_JWT_PRIVATE_KEY;
  delete process.env.SUPABASE_JWT_KEY_ID;
  process.env.SUPABASE_STORAGE_JWT_TTL_SECONDS = "60";
}

test("canonical storage paths sanitize traversal and encoded filenames", () => {
  assert.equal(
    sanitizeStorageFilename("../../%2e%2e\\claim report?.pdf"),
    "claim_report_.pdf",
  );
  const path = buildCanonicalDocumentPath({
    organizationId: ORGANIZATION_A,
    claimId: CLAIM_A,
    documentId: DOCUMENT_A,
    fileName: "../../claim report.pdf",
  });
  assert.equal(
    path,
    `organizations/${ORGANIZATION_A}/claims/${CLAIM_A}/documents/${DOCUMENT_A}/claim_report.pdf`,
  );
  assert.deepEqual(parseCanonicalDocumentPath(path), {
    organizationId: ORGANIZATION_A,
    claimId: CLAIM_A,
    documentId: DOCUMENT_A,
    fileName: "claim_report.pdf",
  });
  assert.equal(
    parseCanonicalDocumentPath(
      `organizations/${ORGANIZATION_A}/claims/${CLAIM_A}/documents/${DOCUMENT_A}/%2e%2e.pdf`,
    ),
    null,
  );
  assert.equal(
    parseCanonicalDocumentPath(
      `organizations/${ORGANIZATION_A}/claims/../documents/${DOCUMENT_A}/report.pdf`,
    ),
    null,
  );
  for (const adversarialPath of [
    `organizations/${ORGANIZATION_A}/claims/${CLAIM_A}/documents/${DOCUMENT_A}/report%2Fescape.pdf`,
    `organizations/${ORGANIZATION_A}/claims/${CLAIM_A}/documents/${DOCUMENT_A}/report%252e.pdf`,
    `organizations/${ORGANIZATION_A}/claims/${CLAIM_A}/documents/${DOCUMENT_A}//report.pdf`,
    `organizations/${ORGANIZATION_A}/claims/${CLAIM_A}\\documents\\${DOCUMENT_A}\\report.pdf`,
    `organizations/00000000-0000-4000-8000-00000000000A/claims/${CLAIM_A}/documents/${DOCUMENT_A}/report.pdf`,
  ]) {
    assert.equal(parseCanonicalDocumentPath(adversarialPath), null);
  }
});

test("storage capability binds organization, claim, and document IDs", () => {
  const storage = createTenantStorageCapability({
    organizationId: ORGANIZATION_A,
    userId: "user-a",
    sessionId: "session-a",
  });
  const forgedPath = buildCanonicalDocumentPath({
    organizationId: ORGANIZATION_B,
    claimId: CLAIM_A,
    documentId: DOCUMENT_A,
    fileName: "report.pdf",
  });
  assert.equal(
    storage.ownsReference({
      claimId: CLAIM_A,
      documentId: DOCUMENT_A,
      storagePath: forgedPath,
    }),
    false,
  );

  const canonicalPath = buildCanonicalDocumentPath({
    organizationId: ORGANIZATION_A,
    claimId: CLAIM_A,
    documentId: DOCUMENT_A,
    fileName: "report.pdf",
  });
  assert.equal(
    storage.ownsReference({
      claimId: CLAIM_B,
      documentId: DOCUMENT_A,
      storagePath: canonicalPath,
    }),
    false,
  );
  assert.equal(
    storage.ownsReference({
      claimId: CLAIM_A,
      documentId: DOCUMENT_B,
      storagePath: canonicalPath,
    }),
    false,
  );
});

test("tenant storage JWT is short-lived and organization-bound", async () => {
  configureStorageEnvironment();
  const storage = createTenantStorageCapability({
    organizationId: ORGANIZATION_A,
    userId: "user-a",
    sessionId: "session-a",
  });
  const token = await mintTenantStorageJwt(storage);
  await verifyTenantStorageJwt(token, ORGANIZATION_A);
  await assert.rejects(
    verifyTenantStorageJwt(token, ORGANIZATION_B),
    /claims do not match/i,
  );

  const now = Math.floor(Date.now() / 1000);
  const expired = await new SignJWT({
    role: "authenticated",
    user_id: "user-a",
    organization_id: ORGANIZATION_A,
    session_id: "session-a",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("user-a")
    .setIssuer("claims-iq-api")
    .setAudience("authenticated")
    .setIssuedAt(now - 120)
    .setExpirationTime(now - 60)
    .sign(new TextEncoder().encode(JWT_SECRET));
  await assert.rejects(
    verifyTenantStorageJwt(expired, ORGANIZATION_A),
    /expired/i,
  );
});

test("asymmetric tenant storage JWTs verify with the derived public key", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  process.env.SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  delete process.env.SUPABASE_JWT_SECRET;
  process.env.SUPABASE_JWT_PRIVATE_KEY = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  process.env.SUPABASE_JWT_KEY_ID = "test-signing-key";
  process.env.SUPABASE_JWT_ALGORITHM = "ES256";
  process.env.SUPABASE_STORAGE_JWT_TTL_SECONDS = "60";

  try {
    const storage = createTenantStorageCapability({
      organizationId: ORGANIZATION_A,
      userId: "user-a",
      sessionId: "session-a",
    });
    const token = await mintTenantStorageJwt(storage);
    await verifyTenantStorageJwt(token, ORGANIZATION_A);
  } finally {
    configureStorageEnvironment();
    delete process.env.SUPABASE_JWT_ALGORITHM;
  }
});

test("signed URLs enforce the short expiry ceiling before I/O", async () => {
  const storage = createTenantStorageCapability({
    organizationId: ORGANIZATION_A,
    userId: "user-a",
    sessionId: "session-a",
  });
  const storagePath = buildCanonicalDocumentPath({
    organizationId: ORGANIZATION_A,
    claimId: CLAIM_A,
    documentId: DOCUMENT_A,
    fileName: "report.pdf",
  });
  await assert.rejects(
    storage.createSignedDocumentUrl(
      { claimId: CLAIM_A, documentId: DOCUMENT_A, storagePath },
      MAX_SIGNED_URL_SECONDS + 1,
    ),
    /expiry must be between/i,
  );
});

test("download, existence, signing, and delete reject tuple mismatches before I/O", async () => {
  const storage = createTenantStorageCapability({
    organizationId: ORGANIZATION_A,
    userId: "user-a",
    sessionId: "session-a",
  });
  const storagePath = buildCanonicalDocumentPath({
    organizationId: ORGANIZATION_A,
    claimId: CLAIM_A,
    documentId: DOCUMENT_A,
    fileName: "report.pdf",
  });
  const mismatches = [
    {
      claimId: CLAIM_B,
      documentId: DOCUMENT_A,
      storagePath,
    },
    {
      claimId: CLAIM_A,
      documentId: DOCUMENT_B,
      storagePath,
    },
    {
      claimId: CLAIM_A,
      documentId: DOCUMENT_A,
      storagePath: storagePath.replace(
        `organizations/${ORGANIZATION_A}`,
        `organizations/${ORGANIZATION_B}`,
      ),
    },
    {
      claimId: CLAIM_A,
      documentId: DOCUMENT_A,
      storagePath: `${storagePath}%2f..`,
    },
  ];

  for (const reference of mismatches) {
    await assert.rejects(
      storage.downloadDocument(reference),
      /does not match the scoped organization\/claim\/document tuple/i,
    );
    await assert.rejects(
      storage.documentExists(reference),
      /does not match the scoped organization\/claim\/document tuple/i,
    );
    await assert.rejects(
      storage.createSignedDocumentUrl(reference),
      /does not match the scoped organization\/claim\/document tuple/i,
    );
    await assert.rejects(
      storage.deleteDocument(reference),
      /does not match the scoped organization\/claim\/document tuple/i,
    );
  }
});

test("raw-path compatibility operations fail closed without service-role access", async () => {
  const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE;
  delete process.env.SUPABASE_SERVICE_ROLE;
  try {
    configureStorageEnvironment();
    const storage = createTenantStorageCapability({
      organizationId: ORGANIZATION_A,
      userId: "user-a",
      sessionId: "session-a",
    });
    const token = await mintTenantStorageJwt(storage);
    await verifyTenantStorageJwt(token, ORGANIZATION_A);

    await assert.rejects(
      downloadFile("tenant-selected/path.pdf"),
      /requires a TenantStorageCapability/i,
    );
    await assert.rejects(
      getSignedUrl("tenant-selected/path.pdf"),
      /requires a TenantStorageCapability/i,
    );
    await assert.rejects(
      fileExists("tenant-selected/path.pdf"),
      /requires a TenantStorageCapability/i,
    );
    await assert.rejects(
      deleteFile("tenant-selected/path.pdf"),
      /requires a TenantStorageCapability/i,
    );
  } finally {
    if (previousServiceRole === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE;
    } else {
      process.env.SUPABASE_SERVICE_ROLE = previousServiceRole;
    }
  }
});

test("normal runtime storage modules have no service-role dependency", async () => {
  const srcRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const paths = [
    "lib/supabaseStorage.ts",
    "routes/storage.ts",
    "routes/documents.ts",
    "routes/emailInbound.ts",
    "services/finalReportIngestion.ts",
    "index.ts",
    "worker.ts",
  ];
  const sources = await Promise.all(
    paths.map((relativePath) => readFile(resolve(srcRoot, relativePath), "utf8")),
  );
  for (const source of sources) {
    assert.equal(source.includes("SUPABASE_SERVICE_ROLE"), false);
  }
});

test("active ingestion and audit paths do not use raw storage compatibility calls", async () => {
  const srcRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const paths = [
    "routes/ingest.ts",
    "services/processingWorker.ts",
    "services/auditRunner.ts",
  ];
  const rawStorageCall =
    /\b(?:uploadFile|downloadFile|deleteFile|getSignedUrl|fileExists)\s*\(/;
  for (const relativePath of paths) {
    const source = await readFile(resolve(srcRoot, relativePath), "utf8");
    assert.doesNotMatch(source, rawStorageCall, relativePath);
  }
});
