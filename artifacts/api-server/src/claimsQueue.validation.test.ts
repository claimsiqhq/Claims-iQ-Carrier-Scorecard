import assert from "node:assert/strict";
import test from "node:test";
import { claimsQueueQuerySchema } from "./routes/claims";

test("claims queue query enforces bounded pagination and known workflow presets", () => {
  assert.equal(
    claimsQueueQuerySchema.safeParse({ page: "0", pageSize: "20" }).success,
    false,
  );
  assert.equal(
    claimsQueueQuerySchema.safeParse({ page: "1", pageSize: "101" }).success,
    false,
  );
  assert.equal(
    claimsQueueQuerySchema.safeParse({ preset: "delete-everything" }).success,
    false,
  );
});

test("claims queue query normalizes safe operational filters", () => {
  const result = claimsQueueQuerySchema.parse({
    page: "2",
    pageSize: "50",
    search: "  CIQ-2026  ",
    preset: "mine",
    sort: "score",
  });

  assert.deepEqual(result, {
    page: 2,
    pageSize: 50,
    search: "CIQ-2026",
    carrier: "all",
    status: "all",
    risk: "all",
    readiness: "all",
    preset: "mine",
    sort: "score",
  });
});
