import assert from "node:assert/strict";
import test from "node:test";
import express, { type Request } from "express";
import request from "supertest";
import {
  isStoredPlatformAccessExpired,
  storedSessionId,
  type SessionUser,
} from "./lib/auth";
import {
  MultipleOrganizationMembershipsError,
  platformLeaseOrganizationContext,
  resolveSingleMembershipContext,
} from "./lib/authorization";
import { organizationContextMiddleware } from "./middlewares/organizationContext";

const organizationId = "10000000-0000-4000-8000-000000000001";

test("single organization membership resolves server-side", () => {
  const context = resolveSingleMembershipContext("user-1", [
    {
      membershipId: "20000000-0000-4000-8000-000000000001",
      organizationId,
      organizationName: "Andover Companies",
      role: "reviewer",
      explicitPermissions: ["claims:create"],
    },
  ]);

  assert.equal(context?.organizationId, organizationId);
  assert.equal(context?.accessMode, "membership");
  assert.equal(context?.permissions.includes("claims:create"), true);
});

test("ordinary tenant owners retain settings management", () => {
  const context = resolveSingleMembershipContext("owner-1", [
    {
      membershipId: "20000000-0000-4000-8000-000000000002",
      organizationId,
      organizationName: "Andover Companies",
      role: "owner",
      explicitPermissions: [],
    },
  ]);

  assert.equal(context?.accessMode, "membership");
  assert.equal(context?.role, "owner");
  assert.equal(context?.permissions.includes("settings:manage"), true);
});

test("multiple organization memberships fail closed", () => {
  assert.throws(
    () =>
      resolveSingleMembershipContext("user-1", [
        {
          membershipId: "membership-1",
          organizationId,
          organizationName: "Tenant A",
          role: "viewer",
          explicitPermissions: [],
        },
        {
          membershipId: "membership-2",
          organizationId: "10000000-0000-4000-8000-000000000002",
          organizationName: "Tenant B",
          role: "viewer",
          explicitPermissions: [],
        },
      ]),
    MultipleOrganizationMembershipsError,
  );
});

test("validated platform leases receive temporary settings management", () => {
  const context = platformLeaseOrganizationContext({
    userId: "platform-user",
    leaseId: "30000000-0000-4000-8000-000000000001",
    organizationId,
    organizationName: "Wawanesa",
    expiresAt: new Date("2026-08-10T21:00:00.000Z"),
  });

  assert.equal(context.membershipId, null);
  assert.equal(context.role, "platform_admin");
  assert.equal(context.accessMode, "platform_lease");
  assert.equal(context.permissions.includes("settings:manage"), true);
});

function platformAdminStub(req: Request): void {
  const user: SessionUser = {
    id: "platform-user",
    email: "platform@example.com",
    firstName: "Pat",
    lastName: "Platform",
    profileImageUrl: null,
    role: "reviewer",
    platformRole: "admin",
  };
  req.user = user;
  req.databaseSessionId = storedSessionId("express-cookie-session-id");
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];
}

function platformContextApp() {
  const app = express();
  app.use((req, _res, next) => {
    platformAdminStub(req);
    next();
  });
  app.use(organizationContextMiddleware);
  app.get("/api/auth/user", (req, res) => {
    res.json({ organization: req.organization ?? null });
  });
  app.get("/api/claims", (_req, res) => {
    res.json({ unsafe: true });
  });
  return app;
}

test("forged organization selection header is denied", async () => {
  const response = await request(platformContextApp())
    .get("/api/auth/user")
    .set("X-Organization-Id", organizationId);

  assert.equal(response.status, 403);
  assert.match(response.body.error, /session-bound/i);
});

test("platform admin has no tenant by default and normal routes are denied", async () => {
  const app = platformContextApp();
  const session = await request(app).get("/api/auth/user");
  const claims = await request(app).get("/api/claims");

  assert.equal(session.status, 200);
  assert.equal(session.body.organization, null);
  assert.equal(claims.status, 403);
  assert.match(claims.body.error, /lease/i);
});

test("session database ID is derived from the actual cookie token", () => {
  const token = "express-cookie-session-id";
  assert.equal(storedSessionId(token).length, 64);
  assert.notEqual(storedSessionId(token), token);
  assert.equal(storedSessionId(token), storedSessionId(token));
});

test("expired platform access is rejected before tenant binding", () => {
  assert.equal(
    isStoredPlatformAccessExpired(
      {
        leaseId: "30000000-0000-4000-8000-000000000001",
        organizationId,
        expiresAt: "2026-08-10T20:00:00.000Z",
      },
      Date.parse("2026-08-10T20:00:00.001Z"),
    ),
    true,
  );
});
