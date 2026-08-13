import { createClient } from "@supabase/supabase-js";
import { createPublicKey, randomUUID } from "node:crypto";
import {
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
} from "jose";

export const BUCKET_NAME = "claim-documents";
export const MAX_SIGNED_URL_SECONDS = 300;
export const PAGE_RENDITION_VERSION = "page-jpeg-v1";
export const PAGE_RENDITION_CONTENT_TYPE = "image/jpeg";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const PAGE_RENDITION_FILE_RE = /^page-(\d{6})\.jpg$/;
const MAX_PAGE_NUMBER = 999_999;
const STORAGE_ISSUER = "claims-iq-api";
const STORAGE_AUDIENCE = "authenticated";
const capabilityMarker = Symbol("tenant-storage-capability");

export interface AuthenticatedStorageIdentity {
  organizationId: string;
  userId: string;
  sessionId: string;
  maxExpiresAt?: Date | null;
}

export interface CanonicalDocumentReference {
  claimId: string;
  documentId: string;
  storagePath: string;
}

export interface ParsedDocumentStoragePath {
  organizationId: string;
  claimId: string;
  documentId: string;
  fileName: string;
}

export interface CanonicalPageRenditionReference {
  claimId: string;
  documentId: string;
  pageNumber: number;
  storagePath: string;
}

export interface ParsedPageRenditionStoragePath {
  organizationId: string;
  claimId: string;
  documentId: string;
  pageNumber: number;
}

interface SigningConfiguration {
  algorithm: "HS256" | "RS256" | "ES256";
  keyId?: string;
  signingKey: Uint8Array | Awaited<ReturnType<typeof importPKCS8>>;
  verificationKey: Uint8Array | Awaited<ReturnType<typeof importSPKI>>;
}

let asymmetricSigningCache:
  | {
      cacheKey: string;
      configuration: SigningConfiguration;
    }
  | undefined;

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function supabaseUrl(): string {
  const value = requiredEnvironmentValue("SUPABASE_URL").replace(/\/$/, "");
  const productionUrl = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(value);
  const localUrl =
    process.env.NODE_ENV !== "production"
    && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/i.test(value);
  if (!productionUrl && !localUrl) {
    throw new Error(
      "SUPABASE_URL must be an https://*.supabase.co URL (or localhost outside production)",
    );
  }
  return value;
}

function storageJwtTtlSeconds(): number {
  const raw = process.env.SUPABASE_STORAGE_JWT_TTL_SECONDS?.trim() ?? "60";
  const ttl = Number.parseInt(raw, 10);
  if (!Number.isInteger(ttl) || ttl < 15 || ttl > 300) {
    throw new Error(
      "SUPABASE_STORAGE_JWT_TTL_SECONDS must be between 15 and 300",
    );
  }
  return ttl;
}

function normalizeUuid(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_RE.test(normalized)) {
    throw new Error(`${label} must be a canonical UUID`);
  }
  return normalized;
}

function validateIdentityValue(
  value: string,
  label: string,
  maximumLength: number,
): string {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > maximumLength
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

async function signingConfiguration(): Promise<SigningConfiguration> {
  const privateKeyValue = process.env.SUPABASE_JWT_PRIVATE_KEY?.trim();
  if (!privateKeyValue) {
    const secret = requiredEnvironmentValue("SUPABASE_JWT_SECRET");
    const key = new TextEncoder().encode(secret);
    if (key.byteLength < 32) {
      throw new Error("SUPABASE_JWT_SECRET must contain at least 32 bytes");
    }
    return {
      algorithm: "HS256",
      signingKey: key,
      verificationKey: key,
    };
  }

  const algorithmValue =
    process.env.SUPABASE_JWT_ALGORITHM?.trim().toUpperCase() ?? "RS256";
  if (algorithmValue !== "RS256" && algorithmValue !== "ES256") {
    throw new Error(
      "SUPABASE_JWT_ALGORITHM must be RS256 or ES256 for a private key",
    );
  }
  const algorithm = algorithmValue as "RS256" | "ES256";
  const keyId = requiredEnvironmentValue("SUPABASE_JWT_KEY_ID");
  const pem = privateKeyValue.replace(/\\n/g, "\n");
  const cacheKey = `${algorithm}:${keyId}:${pem}`;
  if (asymmetricSigningCache?.cacheKey === cacheKey) {
    return asymmetricSigningCache.configuration;
  }
  const key = await importPKCS8(pem, algorithm);
  const publicKey = createPublicKey(pem)
    .export({ type: "spki", format: "pem" })
    .toString();
  const configuration: SigningConfiguration = {
    algorithm,
    keyId,
    signingKey: key,
    verificationKey: await importSPKI(publicKey, algorithm),
  };
  asymmetricSigningCache = { cacheKey, configuration };
  return configuration;
}

export function sanitizeStorageFilename(fileName: string): string {
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
  if (!SAFE_FILE_NAME_RE.test(safeName) || safeName === "." || safeName === "..") {
    throw new Error("Unable to produce a safe storage filename");
  }
  return safeName;
}

export function buildCanonicalDocumentPath(input: {
  organizationId: string;
  claimId: string;
  documentId: string;
  fileName: string;
}): string {
  const organizationId = normalizeUuid(
    input.organizationId,
    "organizationId",
  );
  const claimId = normalizeUuid(input.claimId, "claimId");
  const documentId = normalizeUuid(input.documentId, "documentId");
  const fileName = sanitizeStorageFilename(input.fileName);
  return `organizations/${organizationId}/claims/${claimId}/documents/${documentId}/${fileName}`;
}

function normalizePageNumber(pageNumber: number): number {
  if (
    !Number.isInteger(pageNumber)
    || pageNumber < 1
    || pageNumber > MAX_PAGE_NUMBER
  ) {
    throw new Error("pageNumber must be a positive bounded integer");
  }
  return pageNumber;
}

function renditionFileName(pageNumber: number): string {
  return `page-${normalizePageNumber(pageNumber).toString().padStart(6, "0")}.jpg`;
}

export function buildCanonicalPageRenditionPath(input: {
  organizationId: string;
  claimId: string;
  documentId: string;
  pageNumber: number;
}): string {
  const organizationId = normalizeUuid(
    input.organizationId,
    "organizationId",
  );
  const claimId = normalizeUuid(input.claimId, "claimId");
  const documentId = normalizeUuid(input.documentId, "documentId");
  return [
    "organizations",
    organizationId,
    "claims",
    claimId,
    "documents",
    documentId,
    "renditions",
    PAGE_RENDITION_VERSION,
    renditionFileName(input.pageNumber),
  ].join("/");
}

export function parseCanonicalDocumentPath(
  storagePath: string,
): ParsedDocumentStoragePath | null {
  if (
    !storagePath
    || storagePath.length > 1024
    || /[\u0000-\u001f\u007f\\]/.test(storagePath)
    || /%[0-9A-Fa-f]{2}/.test(storagePath)
  ) {
    return null;
  }
  const segments = storagePath.split("/");
  if (
    segments.length !== 7
    || segments[0] !== "organizations"
    || !UUID_RE.test(segments[1] ?? "")
    || segments[2] !== "claims"
    || !UUID_RE.test(segments[3] ?? "")
    || segments[4] !== "documents"
    || !UUID_RE.test(segments[5] ?? "")
    || !SAFE_FILE_NAME_RE.test(segments[6] ?? "")
    || segments[6] === "."
    || segments[6] === ".."
  ) {
    return null;
  }
  return {
    organizationId: segments[1]!,
    claimId: segments[3]!,
    documentId: segments[5]!,
    fileName: segments[6]!,
  };
}

export function parseCanonicalPageRenditionPath(
  storagePath: string,
): ParsedPageRenditionStoragePath | null {
  if (
    !storagePath
    || storagePath.length > 1024
    || /[\u0000-\u001f\u007f\\]/.test(storagePath)
    || /%[0-9A-Fa-f]{2}/.test(storagePath)
  ) {
    return null;
  }
  const segments = storagePath.split("/");
  const pageMatch = PAGE_RENDITION_FILE_RE.exec(segments[8] ?? "");
  if (
    segments.length !== 9
    || segments[0] !== "organizations"
    || !UUID_RE.test(segments[1] ?? "")
    || segments[2] !== "claims"
    || !UUID_RE.test(segments[3] ?? "")
    || segments[4] !== "documents"
    || !UUID_RE.test(segments[5] ?? "")
    || segments[6] !== "renditions"
    || segments[7] !== PAGE_RENDITION_VERSION
    || !pageMatch
  ) {
    return null;
  }
  const pageNumber = Number.parseInt(pageMatch[1]!, 10);
  if (pageNumber < 1 || pageNumber > MAX_PAGE_NUMBER) return null;
  return {
    organizationId: segments[1]!,
    claimId: segments[3]!,
    documentId: segments[5]!,
    pageNumber,
  };
}

export function isOrganizationStoragePath(
  storagePath: string,
  organizationId: string,
): boolean {
  const parsed = parseCanonicalDocumentPath(storagePath);
  if (!parsed) return false;
  try {
    return parsed.organizationId === normalizeUuid(organizationId, "organizationId");
  } catch {
    return false;
  }
}

async function mintStorageJwt(
  identity: Readonly<AuthenticatedStorageIdentity>,
): Promise<string> {
  const configuration = await signingConfiguration();
  const now = Math.floor(Date.now() / 1000);
  const configuredExpiry = now + storageJwtTtlSeconds();
  const boundedExpiry = identity.maxExpiresAt
    ? Math.min(configuredExpiry, Math.floor(identity.maxExpiresAt.getTime() / 1000))
    : configuredExpiry;
  if (boundedExpiry <= now) {
    throw new Error("The authenticated storage scope has expired");
  }

  const token = new SignJWT({
    role: "authenticated",
    user_id: identity.userId,
    organization_id: identity.organizationId,
    session_id: identity.sessionId,
  })
    .setProtectedHeader({
      alg: configuration.algorithm,
      typ: "JWT",
      ...(configuration.keyId ? { kid: configuration.keyId } : {}),
    })
    .setSubject(identity.userId)
    .setIssuer(STORAGE_ISSUER)
    .setAudience(STORAGE_AUDIENCE)
    .setIssuedAt(now)
    .setNotBefore(now - 2)
    .setExpirationTime(boundedExpiry)
    .setJti(randomUUID());

  return token.sign(configuration.signingKey);
}

export async function verifyTenantStorageJwt(
  token: string,
  expectedOrganizationId: string,
): Promise<void> {
  const configuration = await signingConfiguration();
  const expectedOrganization = normalizeUuid(
    expectedOrganizationId,
    "organizationId",
  );
  const { payload } = await jwtVerify(token, configuration.verificationKey, {
    algorithms: [configuration.algorithm],
    issuer: STORAGE_ISSUER,
    audience: STORAGE_AUDIENCE,
  });
  if (
    payload.role !== "authenticated"
    || typeof payload.sub !== "string"
    || payload.user_id !== payload.sub
    || typeof payload.session_id !== "string"
    || !payload.session_id
    || payload.organization_id !== expectedOrganization
  ) {
    throw new Error("Storage JWT claims do not match the authenticated scope");
  }
}

export class TenantStorageCapability {
  readonly [capabilityMarker] = true;
  readonly organizationId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly maxExpiresAt: Date | null;

  private constructor(identity: AuthenticatedStorageIdentity) {
    this.organizationId = normalizeUuid(
      identity.organizationId,
      "organizationId",
    );
    this.userId = validateIdentityValue(identity.userId, "userId", 512);
    this.sessionId = validateIdentityValue(identity.sessionId, "sessionId", 512);
    this.maxExpiresAt = identity.maxExpiresAt
      ? new Date(identity.maxExpiresAt)
      : null;
    if (
      this.maxExpiresAt
      && (
        !Number.isFinite(this.maxExpiresAt.getTime())
        || this.maxExpiresAt.getTime() <= Date.now()
      )
    ) {
      throw new Error("maxExpiresAt must be a future date");
    }
  }

  static fromAuthenticatedSession(
    identity: AuthenticatedStorageIdentity,
  ): TenantStorageCapability {
    return new TenantStorageCapability(identity);
  }

  ownsReference(reference: CanonicalDocumentReference): boolean {
    const parsed = parseCanonicalDocumentPath(reference.storagePath);
    if (!parsed) return false;
    try {
      return (
        parsed.organizationId === this.organizationId
        && parsed.claimId === normalizeUuid(reference.claimId, "claimId")
        && parsed.documentId
          === normalizeUuid(reference.documentId, "documentId")
      );
    } catch {
      return false;
    }
  }

  ownsPageRendition(
    reference: CanonicalPageRenditionReference,
  ): boolean {
    const parsed = parseCanonicalPageRenditionPath(reference.storagePath);
    if (!parsed) return false;
    try {
      return (
        parsed.organizationId === this.organizationId
        && parsed.claimId === normalizeUuid(reference.claimId, "claimId")
        && parsed.documentId
          === normalizeUuid(reference.documentId, "documentId")
        && parsed.pageNumber === normalizePageNumber(reference.pageNumber)
      );
    } catch {
      return false;
    }
  }

  assertReference(
    reference: CanonicalDocumentReference,
  ): ParsedDocumentStoragePath {
    const parsed = parseCanonicalDocumentPath(reference.storagePath);
    if (!parsed || !this.ownsReference(reference)) {
      throw new Error(
        "Storage path does not match the scoped organization/claim/document tuple",
      );
    }
    return parsed;
  }

  assertPageRendition(
    reference: CanonicalPageRenditionReference,
  ): ParsedPageRenditionStoragePath {
    const parsed = parseCanonicalPageRenditionPath(reference.storagePath);
    if (!parsed || !this.ownsPageRendition(reference)) {
      throw new Error(
        "Page rendition path does not match the scoped organization/claim/document/page tuple",
      );
    }
    return parsed;
  }

  pageRenditionReference(input: {
    claimId: string;
    documentId: string;
    pageNumber: number;
  }): CanonicalPageRenditionReference {
    const claimId = normalizeUuid(input.claimId, "claimId");
    const documentId = normalizeUuid(input.documentId, "documentId");
    const pageNumber = normalizePageNumber(input.pageNumber);
    return {
      claimId,
      documentId,
      pageNumber,
      storagePath: buildCanonicalPageRenditionPath({
        organizationId: this.organizationId,
        claimId,
        documentId,
        pageNumber,
      }),
    };
  }

  private async bucket() {
    const accessToken = await mintStorageJwt(this);
    const client = createClient(
      supabaseUrl(),
      requiredEnvironmentValue("SUPABASE_PUBLISHABLE_KEY"),
      {
        accessToken: async () => accessToken,
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
    return client.storage.from(BUCKET_NAME);
  }

  async uploadDocument(input: {
    claimId: string;
    documentId: string;
    fileName: string;
    contentType: string;
    body: Buffer;
  }): Promise<string> {
    const storagePath = buildCanonicalDocumentPath({
      organizationId: this.organizationId,
      claimId: input.claimId,
      documentId: input.documentId,
      fileName: input.fileName,
    });
    const bucket = await this.bucket();
    const { error } = await bucket.upload(storagePath, input.body, {
      contentType: input.contentType || "application/octet-stream",
      upsert: false,
    });
    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }
    return storagePath;
  }

  async uploadPageRendition(input: {
    claimId: string;
    documentId: string;
    pageNumber: number;
    body: Buffer;
  }): Promise<CanonicalPageRenditionReference> {
    const reference = this.pageRenditionReference(input);
    const bucket = await this.bucket();
    const { error } = await bucket.upload(reference.storagePath, input.body, {
      contentType: PAGE_RENDITION_CONTENT_TYPE,
      cacheControl: "31536000",
      upsert: true,
    });
    if (error) {
      throw new Error(`Supabase page rendition upload failed: ${error.message}`);
    }
    return reference;
  }

  async downloadDocument(
    reference: CanonicalDocumentReference,
  ): Promise<Buffer> {
    this.assertReference(reference);
    const bucket = await this.bucket();
    const { data, error } = await bucket.download(reference.storagePath);
    if (error || !data) {
      throw new Error(
        `Supabase download failed: ${error?.message ?? "No data"}`,
      );
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async createSignedDocumentUrl(
    reference: CanonicalDocumentReference,
    expiresInSeconds = 120,
  ): Promise<string> {
    this.assertReference(reference);
    if (
      !Number.isInteger(expiresInSeconds)
      || expiresInSeconds < 1
      || expiresInSeconds > MAX_SIGNED_URL_SECONDS
    ) {
      throw new Error(
        `Signed URL expiry must be between 1 and ${MAX_SIGNED_URL_SECONDS} seconds`,
      );
    }
    const bucket = await this.bucket();
    const { data, error } = await bucket.createSignedUrl(
      reference.storagePath,
      expiresInSeconds,
    );
    if (error || !data?.signedUrl) {
      throw new Error(
        `Failed to create signed URL: ${error?.message ?? "No URL"}`,
      );
    }
    return data.signedUrl;
  }

  async createSignedPageRenditionUrl(
    reference: CanonicalPageRenditionReference,
    expiresInSeconds = 120,
  ): Promise<string> {
    this.assertPageRendition(reference);
    if (
      !Number.isInteger(expiresInSeconds)
      || expiresInSeconds < 1
      || expiresInSeconds > MAX_SIGNED_URL_SECONDS
    ) {
      throw new Error(
        `Signed URL expiry must be between 1 and ${MAX_SIGNED_URL_SECONDS} seconds`,
      );
    }
    const bucket = await this.bucket();
    const { data, error } = await bucket.createSignedUrl(
      reference.storagePath,
      expiresInSeconds,
    );
    if (error || !data?.signedUrl) {
      throw new Error(
        `Failed to create page rendition URL: ${error?.message ?? "No URL"}`,
      );
    }
    return data.signedUrl;
  }

  async documentExists(
    reference: CanonicalDocumentReference,
  ): Promise<boolean> {
    const parsed = this.assertReference(reference);
    const folder = reference.storagePath.slice(
      0,
      -(parsed.fileName.length + 1),
    );
    const bucket = await this.bucket();
    const { data, error } = await bucket.list(folder, {
      limit: 2,
      search: parsed.fileName,
    });
    if (error) {
      throw new Error(`Supabase object lookup failed: ${error.message}`);
    }
    return data.some((entry) => entry.name === parsed.fileName);
  }

  async pageRenditionExists(
    reference: CanonicalPageRenditionReference,
  ): Promise<boolean> {
    const parsed = this.assertPageRendition(reference);
    const folder = reference.storagePath.slice(
      0,
      -(renditionFileName(parsed.pageNumber).length + 1),
    );
    const bucket = await this.bucket();
    const { data, error } = await bucket.list(folder, {
      limit: 2,
      search: renditionFileName(parsed.pageNumber),
    });
    if (error) {
      throw new Error(`Supabase page rendition lookup failed: ${error.message}`);
    }
    return data.some(
      (entry) => entry.name === renditionFileName(parsed.pageNumber),
    );
  }

  async deletePageRenditions(input: {
    claimId: string;
    documentId: string;
  }): Promise<void> {
    const firstPage = this.pageRenditionReference({
      ...input,
      pageNumber: 1,
    });
    const folder = firstPage.storagePath.slice(
      0,
      -(renditionFileName(1).length + 1),
    );
    const bucket = await this.bucket();
    const paths: string[] = [];
    const limit = 100;
    for (let offset = 0; ; offset += limit) {
      const { data, error } = await bucket.list(folder, { limit, offset });
      if (error) {
        throw new Error(`Supabase page rendition list failed: ${error.message}`);
      }
      for (const entry of data) {
        const storagePath = `${folder}/${entry.name}`;
        const parsed = parseCanonicalPageRenditionPath(storagePath);
        if (
          parsed
          && parsed.organizationId === this.organizationId
          && parsed.claimId === firstPage.claimId
          && parsed.documentId === firstPage.documentId
        ) {
          paths.push(storagePath);
        }
      }
      if (data.length < limit) break;
    }
    for (let index = 0; index < paths.length; index += limit) {
      const { error } = await bucket.remove(paths.slice(index, index + limit));
      if (error) {
        throw new Error(
          `Supabase page rendition cleanup failed: ${error.message}`,
        );
      }
    }
  }

  async deleteDocument(
    reference: CanonicalDocumentReference,
  ): Promise<void> {
    this.assertReference(reference);
    const bucket = await this.bucket();
    const { error } = await bucket.remove([reference.storagePath]);
    if (error) {
      throw new Error(`Supabase delete failed: ${error.message}`);
    }
  }
}

export function createTenantStorageCapability(
  identity: AuthenticatedStorageIdentity,
): TenantStorageCapability {
  return TenantStorageCapability.fromAuthenticatedSession(identity);
}

export async function mintTenantStorageJwt(
  capability: TenantStorageCapability,
): Promise<string> {
  if (
    !(capability instanceof TenantStorageCapability)
    || capability[capabilityMarker] !== true
  ) {
    throw new Error("A valid tenant storage capability is required");
  }
  return mintStorageJwt(capability);
}

function unscopedStorageError(operation: string): Error {
  return new Error(
    `${operation} requires a TenantStorageCapability and an exact canonical document tuple`,
  );
}

/**
 * Fail-closed compatibility exports. Callers must migrate to a scoped storage
 * capability; accepting a raw path here would let the caller select tenancy.
 */
export async function uploadFile(
  _fileBuffer: Buffer,
  _fileName: string,
  _contentType: string,
  _organizationId: string,
): Promise<string> {
  throw unscopedStorageError("uploadFile");
}

export async function downloadFile(_storagePath: string): Promise<Buffer> {
  throw unscopedStorageError("downloadFile");
}

export async function getSignedUrl(
  _storagePath: string,
  _expiresIn?: number,
): Promise<string> {
  throw unscopedStorageError("getSignedUrl");
}

export async function fileExists(
  _storagePath: string,
): Promise<{ exists: boolean; error?: string }> {
  throw unscopedStorageError("fileExists");
}

export async function deleteFile(_storagePath: string): Promise<void> {
  throw unscopedStorageError("deleteFile");
}
