export const RUNTIME_DATABASE_ENV_KEYS = [
  "IDENTITY_DATABASE_URL",
  "TENANT_DATABASE_URL",
  "PLATFORM_DATABASE_URL",
  "OPERATIONS_DATABASE_URL",
] as const;

export type RuntimeDatabaseEnvKey = (typeof RUNTIME_DATABASE_ENV_KEYS)[number];

export interface DatabaseRuntimeConfig {
  identityUrl: string;
  tenantUrl: string;
  platformUrl: string;
  operationsUrl: string;
  usedUnrestrictedFallback: boolean;
  mode: "api" | "worker" | "migration";
}

type Environment = Record<string, string | undefined>;

function optionalValue(
  environment: Environment,
  key: string,
): string | undefined {
  const value = environment[key]?.trim();
  return value ? value : undefined;
}

function parseDatabaseUrl(value: string, key: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid PostgreSQL connection URL.`);
  }

  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.username
  ) {
    throw new Error(
      `${key} must be a PostgreSQL URL with a hostname and database role.`,
    );
  }
  return parsed;
}

function databaseRole(url: URL): string {
  return decodeURIComponent(url.username).trim().toLowerCase();
}

function isOwnerLikeRole(role: string): boolean {
  const baseRole = role.split(".")[0];
  return [
    "postgres",
    "supabase_admin",
    "supabase_owner",
    "rdsadmin",
    "cloudsqlsuperuser",
  ].includes(baseRole);
}

function assertRestrictedProductionUrls(
  urls: Record<RuntimeDatabaseEnvKey, string>,
  environment: Environment,
  requiredKeys: readonly RuntimeDatabaseEnvKey[],
): void {
  const parsedEntries = requiredKeys.map((key) => {
    const parsed = parseDatabaseUrl(urls[key], key);
    const role = databaseRole(parsed);
    if (isOwnerLikeRole(role)) {
      throw new Error(
        `${key} must use a restricted runtime role, not database owner role "${role}".`,
      );
    }
    return { key, value: urls[key], role };
  });

  const migrationUrl =
    optionalValue(environment, "MIGRATION_DATABASE_URL") ??
    optionalValue(environment, "SUPABASE_DATABASE_URL") ??
    optionalValue(environment, "DATABASE_URL");
  if (migrationUrl) {
    const migrationRole = databaseRole(
      parseDatabaseUrl(migrationUrl, "MIGRATION_DATABASE_URL"),
    );
    for (const entry of parsedEntries) {
      if (entry.value === migrationUrl || entry.role === migrationRole) {
        throw new Error(
          `${entry.key} must not use the migration/owner database role.`,
        );
      }
    }
  }

  const seenUrls = new Set<string>();
  const seenRoles = new Set<string>();
  for (const entry of parsedEntries) {
    if (seenUrls.has(entry.value) || seenRoles.has(entry.role)) {
      throw new Error(
        "Production database planes must use distinct connection URLs and roles.",
      );
    }
    seenUrls.add(entry.value);
    seenRoles.add(entry.role);
  }
}

export function resolveDatabaseRuntimeConfig(
  environment: Environment = process.env,
): DatabaseRuntimeConfig {
  const production = environment.NODE_ENV === "production";
  const rawMode = optionalValue(environment, "DATABASE_RUNTIME_MODE") ?? "api";
  if (!["api", "worker", "migration"].includes(rawMode)) {
    throw new Error("DATABASE_RUNTIME_MODE must be api, worker, or migration.");
  }
  const mode = rawMode as DatabaseRuntimeConfig["mode"];
  const requiredKeys: readonly RuntimeDatabaseEnvKey[] =
    mode === "worker"
      ? ["OPERATIONS_DATABASE_URL"]
      : mode === "migration"
        ? []
        : RUNTIME_DATABASE_ENV_KEYS;
  const fallbackAllowed =
    !production &&
    optionalValue(environment, "ALLOW_UNRESTRICTED_DATABASE_URL_FALLBACK") ===
      "true";
  const unrestrictedFallback =
    optionalValue(environment, "SUPABASE_DATABASE_URL") ??
    optionalValue(environment, "DATABASE_URL");
  const processPlaneFallback =
    mode === "worker"
      ? optionalValue(environment, "OPERATIONS_DATABASE_URL")
      : mode === "migration"
        ? (optionalValue(environment, "MIGRATION_DATABASE_URL") ??
          unrestrictedFallback)
        : undefined;

  const resolved = Object.fromEntries(
    RUNTIME_DATABASE_ENV_KEYS.map((key) => [
      key,
      optionalValue(environment, key) ??
        processPlaneFallback ??
        (fallbackAllowed ? unrestrictedFallback : undefined),
    ]),
  ) as Record<RuntimeDatabaseEnvKey, string | undefined>;

  const missing = requiredKeys.filter((key) => !resolved[key]);
  if (missing.length > 0) {
    const fallbackHint = production
      ? "Production does not permit owner-credential fallback."
      : "For local/test use only, set ALLOW_UNRESTRICTED_DATABASE_URL_FALLBACK=true with SUPABASE_DATABASE_URL or DATABASE_URL.";
    throw new Error(
      `Missing restricted database URLs: ${missing.join(", ")}. ${fallbackHint}`,
    );
  }

  if (
    mode === "migration" &&
    RUNTIME_DATABASE_ENV_KEYS.some((key) => !resolved[key])
  ) {
    throw new Error(
      "MIGRATION_DATABASE_URL must be set for migration runtime mode.",
    );
  }
  const urls = resolved as Record<RuntimeDatabaseEnvKey, string>;
  for (const key of RUNTIME_DATABASE_ENV_KEYS) {
    parseDatabaseUrl(urls[key], key);
  }
  if (production && mode !== "migration") {
    assertRestrictedProductionUrls(urls, environment, requiredKeys);
  }

  return {
    identityUrl: urls.IDENTITY_DATABASE_URL,
    tenantUrl: urls.TENANT_DATABASE_URL,
    platformUrl: urls.PLATFORM_DATABASE_URL,
    operationsUrl: urls.OPERATIONS_DATABASE_URL,
    usedUnrestrictedFallback:
      fallbackAllowed &&
      RUNTIME_DATABASE_ENV_KEYS.some((key) => !optionalValue(environment, key)),
    mode,
  };
}

export function resolveMigrationDatabaseUrl(
  environment: Environment = process.env,
): string {
  const url =
    optionalValue(environment, "MIGRATION_DATABASE_URL") ??
    optionalValue(environment, "SUPABASE_DATABASE_URL") ??
    optionalValue(environment, "DATABASE_URL");
  if (!url) {
    throw new Error(
      "MIGRATION_DATABASE_URL must be set (legacy SUPABASE_DATABASE_URL or DATABASE_URL fallback is supported for migrations).",
    );
  }
  parseDatabaseUrl(url, "MIGRATION_DATABASE_URL");
  return url;
}

export function databaseUrlUsesTls(connectionString: string): boolean {
  const parsed = parseDatabaseUrl(connectionString, "database URL");
  return (
    parsed.hostname.endsWith(".supabase.co") ||
    parsed.hostname.endsWith(".pooler.supabase.com") ||
    parsed.searchParams.get("sslmode") === "require"
  );
}
