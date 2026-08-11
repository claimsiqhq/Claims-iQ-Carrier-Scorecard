import { resolveDatabaseRuntimeConfig } from "@workspace/db/runtime-config";

function readOptionalEnv(key: string): string | undefined {
  const value = process.env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalPositiveInt(key: string): number | undefined {
  const raw = readOptionalEnv(key);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function readBoundedInt(
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = readOptionalEnv(key);
  if (!raw) return fallback;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${key} must be an integer.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${key} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function readCommaSeparatedEnv(key: string): string[] {
  return (readOptionalEnv(key) ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function readPublicUrl(allowedOrigins: string[]): string {
  const raw =
    readOptionalEnv("APP_PUBLIC_URL") ??
    allowedOrigins[0] ??
    "http://localhost:5173";
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "APP_PUBLIC_URL must be an HTTP(S) URL without credentials",
    );
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function validateStorageEnvironment(
  environment: Record<string, string | undefined> = process.env,
): void {
  const value = (key: string) => environment[key]?.trim();
  const missing = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"].filter(
    (key) => !value(key),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required storage environment variables: ${missing.join(", ")}`,
    );
  }

  const symmetricSecret = value("SUPABASE_JWT_SECRET");
  const privateKey = value("SUPABASE_JWT_PRIVATE_KEY");
  if (!symmetricSecret && !privateKey) {
    throw new Error(
      "SUPABASE_JWT_SECRET or SUPABASE_JWT_PRIVATE_KEY is required",
    );
  }
  if (symmetricSecret && privateKey) {
    throw new Error(
      "Configure only one of SUPABASE_JWT_SECRET or SUPABASE_JWT_PRIVATE_KEY",
    );
  }
  if (symmetricSecret && new TextEncoder().encode(symmetricSecret).length < 32) {
    throw new Error("SUPABASE_JWT_SECRET must contain at least 32 bytes");
  }
  if (privateKey) {
    if (!value("SUPABASE_JWT_KEY_ID")) {
      throw new Error(
        "SUPABASE_JWT_KEY_ID is required with SUPABASE_JWT_PRIVATE_KEY",
      );
    }
    const algorithm = value("SUPABASE_JWT_ALGORITHM")?.toUpperCase() ?? "RS256";
    if (!["RS256", "ES256"].includes(algorithm)) {
      throw new Error("SUPABASE_JWT_ALGORITHM must be RS256 or ES256");
    }
  }

  const ttlRaw = value("SUPABASE_STORAGE_JWT_TTL_SECONDS") ?? "60";
  const ttl = /^[0-9]+$/.test(ttlRaw) ? Number(ttlRaw) : Number.NaN;
  if (!Number.isSafeInteger(ttl) || ttl < 15 || ttl > 300) {
    throw new Error(
      "SUPABASE_STORAGE_JWT_TTL_SECONDS must be between 15 and 300",
    );
  }
}

const allowedOrigins = readCommaSeparatedEnv("ALLOWED_ORIGINS");
resolveDatabaseRuntimeConfig();
const platformTenantAccessTtlMinutes =
  readOptionalPositiveInt("PLATFORM_TENANT_ACCESS_TTL_MINUTES") ?? 60;
if (platformTenantAccessTtlMinutes > 60) {
  throw new Error("PLATFORM_TENANT_ACCESS_TTL_MINUTES must not exceed 60.");
}

export const env = {
  GEMINI_MODEL: readOptionalEnv("GEMINI_MODEL") ?? "gemini-3.6-flash",
  SENDGRID_INBOUND_SIGNATURE_MAX_AGE_SECONDS:
    readBoundedInt(
      "SENDGRID_INBOUND_SIGNATURE_MAX_AGE_SECONDS",
      300,
      30,
      900,
    ),
  INBOUND_EMAIL_SESSION_TTL_SECONDS:
    readBoundedInt("INBOUND_EMAIL_SESSION_TTL_SECONDS", 120, 15, 300),
  GEMINI_VISION_MAX_PDF_PAGES:
    readOptionalPositiveInt("GEMINI_VISION_MAX_PDF_PAGES") ?? 250,
  ALLOWED_ORIGINS: allowedOrigins,
  APP_PUBLIC_URL: readPublicUrl(allowedOrigins),
  PASSWORD_RESET_TTL_MINUTES:
    readOptionalPositiveInt("PASSWORD_RESET_TTL_MINUTES") ?? 60,
  INVITATION_TTL_HOURS: readOptionalPositiveInt("INVITATION_TTL_HOURS") ?? 48,
  PLATFORM_TENANT_ACCESS_TTL_MINUTES: platformTenantAccessTtlMinutes,
};

export type ApiEnv = typeof env;
