import assert from "node:assert/strict";
import test from "node:test";
import express, { type Request } from "express";
import request from "supertest";
import { storedSessionId, type SessionUser } from "./lib/auth";
import { createPlatformTenantAccessRouter } from "./routes/platformTenantAccess";
import {
  createPlatformTenantAccessService,
  type PlatformAccessRepository,
  type PlatformTenantAccessService,
} from "./services/platformTenantAccess";

const actor = {
  userId: "platform-user",
  sessionId: storedSessionId("session-cookie"),
};
const organizationId = "10000000-0000-4000-8000-000000000001";

test("platform tenant access enters, attaches to session, exits, and expires", async () => {
  let active: Awaited<
    ReturnType<PlatformAccessRepository["findActiveAccess"]>
  > = null;
  let storedAccess:
    | Parameters<PlatformAccessRepository["setSessionAccess"]>[1]
    | null = null;
  const revocationReasons: string[] = [];

  const repository: PlatformAccessRepository = {
    async listTenants() {
      return [
        { id: organizationId, name: "Andover Companies", slug: "andover" },
      ];
    },
    async findActiveAccess(input) {
      if (
        !active ||
        active.leaseId !== input.leaseId ||
        active.organizationId !== input.organizationId ||
        active.expiresAt <= new Date()
      ) {
        return null;
      }
      return active;
    },
    async grantAccess(input) {
      active = {
        leaseId: "30000000-0000-4000-8000-000000000001",
        organizationId: input.organizationId,
        organizationName: "Andover Companies",
        organizationSlug: "andover",
        expiresAt: new Date(Date.now() + input.ttlMinutes * 60 * 1000),
      };
      return active;
    },
    async revokeAccess(input) {
      revocationReasons.push(input.reason);
      active = null;
    },
    async getSessionAccess() {
      return storedAccess;
    },
    async setSessionAccess(_input, access) {
      storedAccess = access;
      return true;
    },
    async clearSessionAccess() {
      storedAccess = null;
    },
  };
  const service = createPlatformTenantAccessService(repository);

  const entered = await service.enterTenant({
    ...actor,
    organizationId,
    reason: "  Investigate support case CIQ-1842  ",
  });
  assert.equal(entered.organizationId, organizationId);
  assert.equal(
    (storedAccess as { leaseId: string } | null)?.leaseId,
    entered.leaseId,
  );
  assert.ok(entered.expiresAt.getTime() <= Date.now() + 60 * 60 * 1000);

  active = { ...entered, expiresAt: new Date(Date.now() - 1) };
  assert.equal(
    await service.resolveActive({
      ...actor,
      leaseId: entered.leaseId,
      organizationId,
      expiresAt: entered.expiresAt.toISOString(),
    }),
    null,
  );

  active = entered;
  await service.exitTenant(actor);
  assert.equal(storedAccess, null);
  assert.equal(active, null);
  assert.match(revocationReasons.at(-1) ?? "", /exited tenant access/i);
});

function sessionUser(platformRole: "admin" | "none"): SessionUser {
  return {
    id: actor.userId,
    email: "platform@example.com",
    firstName: "Pat",
    lastName: "Platform",
    profileImageUrl: null,
    role: "reviewer",
    platformRole,
  };
}

function routeApp(
  service: PlatformTenantAccessService,
  platformRole: "admin" | "none" = "admin",
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = sessionUser(platformRole);
    req.databaseSessionId = actor.sessionId;
    req.isAuthenticated = function (this: Request) {
      return this.user != null;
    } as Request["isAuthenticated"];
    next();
  });
  app.use("/api", createPlatformTenantAccessRouter(service));
  return app;
}

test("platform routes require admin and return tenant identity only", async () => {
  let enterCalls = 0;
  const service: PlatformTenantAccessService = {
    async listTenants() {
      return [
        {
          id: organizationId,
          name: "Andover Companies",
          slug: "andover",
          metrics: { claimCount: 99 },
        } as never,
      ];
    },
    async enterTenant() {
      enterCalls += 1;
      return {
        leaseId: "30000000-0000-4000-8000-000000000001",
        organizationId,
        organizationName: "Andover Companies",
        organizationSlug: "andover",
        expiresAt: new Date("2026-08-10T23:00:00.000Z"),
      };
    },
    async exitTenant() {},
    async resolveActive() {
      return null;
    },
  };

  const forbidden = await request(routeApp(service, "none")).get(
    "/api/platform/tenants",
  );
  assert.equal(forbidden.status, 403);

  const tenants = await request(routeApp(service)).get("/api/platform/tenants");
  assert.equal(tenants.status, 200);
  assert.deepEqual(tenants.body, [
    { id: organizationId, name: "Andover Companies", slug: "andover" },
  ]);
  assert.equal("metrics" in tenants.body[0], false);

  const missingReason = await request(routeApp(service))
    .post("/api/platform/tenant-access")
    .send({ organizationId, reason: "  " });
  assert.equal(missingReason.status, 400);
  assert.equal(enterCalls, 0);
});

test("platform enter and exit responses update session tenant state", async () => {
  let exited = false;
  const service: PlatformTenantAccessService = {
    async listTenants() {
      return [];
    },
    async enterTenant() {
      return {
        leaseId: "30000000-0000-4000-8000-000000000001",
        organizationId,
        organizationName: "Andover Companies",
        organizationSlug: "andover",
        expiresAt: new Date("2026-08-10T23:00:00.000Z"),
      };
    },
    async exitTenant() {
      exited = true;
    },
    async resolveActive() {
      return null;
    },
  };
  const app = routeApp(service);

  const entered = await request(app)
    .post("/api/platform/tenant-access")
    .send({ organizationId, reason: "Support investigation" });
  assert.equal(entered.status, 200);
  assert.equal(entered.body.user.platformRole, "admin");
  assert.equal(entered.body.organization.id, organizationId);
  assert.equal(entered.body.organization.accessMode, "platform_lease");
  assert.equal(entered.body.organization.role, "platform_admin");
  assert.equal(
    entered.body.organization.permissions.includes("settings:manage"),
    true,
  );

  const exitedResponse = await request(app).delete(
    "/api/platform/tenant-access",
  );
  assert.equal(exitedResponse.status, 200);
  assert.equal(exitedResponse.body.organization, null);
  assert.equal(exited, true);
});
