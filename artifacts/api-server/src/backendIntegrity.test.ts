import test from "node:test";
import assert from "node:assert/strict";
import {
  nextAuditVersion,
  selectLatestSuccessfulVersion,
} from "./services/auditVersioning";
import {
  buildJobIdempotencyKey,
  isTerminalJobState,
} from "./services/jobPolicy";
import {
  hasOrganizationPermission,
  organizationScopeMatches,
  permissionsForRole,
} from "./lib/authorizationPolicy";

test("audit versions append and current selection keeps latest success", () => {
  const existing = [1, 2] as const;
  assert.equal(nextAuditVersion(existing), 3);
  assert.deepEqual(existing, [1, 2]);

  const selected = selectLatestSuccessfulVersion([
    { versionNumber: 1, outcome: "succeeded", auditId: "audit-1" },
    { versionNumber: 2, outcome: "succeeded", auditId: "audit-2" },
    { versionNumber: 3, outcome: "failed", auditId: null },
    { versionNumber: 4, outcome: "degraded", auditId: null },
  ]);
  assert.equal(selected?.auditId, "audit-2");
});

test("duplicate job requests produce the same organization-scoped key", () => {
  const first = buildJobIdempotencyKey({
    organizationId: "org-a",
    type: "reprocess",
    claimId: "claim-1",
    documentId: "document-1",
    carrierEntityId: "carrier-entity-1",
    callerKey: "request-123",
  });
  const duplicate = buildJobIdempotencyKey({
    organizationId: "org-a",
    type: "reprocess",
    claimId: "claim-1",
    documentId: "document-1",
    carrierEntityId: "carrier-entity-1",
    callerKey: "request-123",
  });
  const otherTenant = buildJobIdempotencyKey({
    organizationId: "org-b",
    type: "reprocess",
    claimId: "claim-1",
    documentId: "document-1",
    carrierEntityId: "carrier-entity-1",
    callerKey: "request-123",
  });

  assert.equal(first, duplicate);
  assert.notEqual(first, otherTenant);
  const rendition = buildJobIdempotencyKey({
    organizationId: "org-a",
    type: "rendition",
    claimId: "claim-1",
    documentId: "document-1",
    sourceHash: "source-hash",
    callerKey: "page-jpeg-v1",
  });
  const nextRenditionVersion = buildJobIdempotencyKey({
    organizationId: "org-a",
    type: "rendition",
    claimId: "claim-1",
    documentId: "document-1",
    sourceHash: "source-hash",
    callerKey: "page-jpeg-v2",
  });
  assert.notEqual(first, rendition);
  assert.notEqual(rendition, nextRenditionVersion);
  assert.equal(isTerminalJobState("running"), false);
  assert.equal(isTerminalJobState("degraded"), true);
});

test("tenant isolation and granular role permissions deny cross-tenant writes", () => {
  const viewer = { permissions: permissionsForRole("viewer") };
  const reviewer = { permissions: permissionsForRole("reviewer") };
  const admin = { permissions: permissionsForRole("admin") };

  assert.equal(organizationScopeMatches("org-a", "org-a"), true);
  assert.equal(organizationScopeMatches("org-b", "org-a"), false);
  assert.equal(hasOrganizationPermission(viewer, "claims:update"), false);
  assert.equal(hasOrganizationPermission(reviewer, "findings:review"), true);
  assert.equal(hasOrganizationPermission(reviewer, "claims:delete"), false);
  assert.equal(hasOrganizationPermission(reviewer, "settings:manage"), false);
  assert.equal(hasOrganizationPermission(admin, "settings:manage"), true);
});
