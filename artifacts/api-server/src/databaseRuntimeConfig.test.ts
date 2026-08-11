import assert from "node:assert/strict";
import test from "node:test";
import { resolveDatabaseRuntimeConfig } from "@workspace/db/runtime-config";

test("production fails closed when restricted database URLs are missing", () => {
  assert.throws(
    () =>
      resolveDatabaseRuntimeConfig({
        NODE_ENV: "production",
        MIGRATION_DATABASE_URL:
          "postgresql://postgres:owner@database.example.com/app",
      }),
    /Missing restricted database URLs/,
  );
});

test("production rejects owner credentials and shared runtime roles", () => {
  const base = {
    NODE_ENV: "production",
    MIGRATION_DATABASE_URL:
      "postgresql://postgres:owner@database.example.com/app",
    IDENTITY_DATABASE_URL:
      "postgresql://identity_login:secret@database.example.com/app",
    TENANT_DATABASE_URL:
      "postgresql://tenant_login:secret@database.example.com/app",
    PLATFORM_DATABASE_URL:
      "postgresql://platform_login:secret@database.example.com/app",
    OPERATIONS_DATABASE_URL:
      "postgresql://operations_login:secret@database.example.com/app",
  };

  assert.throws(
    () =>
      resolveDatabaseRuntimeConfig({
        ...base,
        TENANT_DATABASE_URL:
          "postgresql://postgres.project:secret@database.example.com/app",
      }),
    /restricted runtime role/,
  );
  assert.throws(
    () =>
      resolveDatabaseRuntimeConfig({
        ...base,
        PLATFORM_DATABASE_URL: base.TENANT_DATABASE_URL,
      }),
    /distinct connection URLs and roles/,
  );
});

test("local owner fallback requires an explicit opt-in", () => {
  const fallback =
    "postgresql://postgres:postgres@127.0.0.1:5432/complete_iq_test";
  assert.throws(
    () =>
      resolveDatabaseRuntimeConfig({
        NODE_ENV: "test",
        SUPABASE_DATABASE_URL: fallback,
      }),
    /ALLOW_UNRESTRICTED_DATABASE_URL_FALLBACK=true/,
  );

  const config = resolveDatabaseRuntimeConfig({
    NODE_ENV: "test",
    ALLOW_UNRESTRICTED_DATABASE_URL_FALLBACK: "true",
    SUPABASE_DATABASE_URL: fallback,
  });
  assert.equal(config.identityUrl, fallback);
  assert.equal(config.tenantUrl, fallback);
  assert.equal(config.usedUnrestrictedFallback, true);
});

test("worker mode requires only its restricted operations credential", () => {
  const operationsUrl =
    "postgresql://worker_login:secret@database.example.com/app";
  const config = resolveDatabaseRuntimeConfig({
    NODE_ENV: "production",
    DATABASE_RUNTIME_MODE: "worker",
    MIGRATION_DATABASE_URL:
      "postgresql://postgres:owner@database.example.com/app",
    OPERATIONS_DATABASE_URL: operationsUrl,
  });

  assert.equal(config.mode, "worker");
  assert.equal(config.operationsUrl, operationsUrl);
  assert.equal(config.identityUrl, operationsUrl);
});
