import { Router, type IRouter, type Request, type Response } from "express";
import { authSessionResponse } from "../lib/authResponse";
import { platformLeaseOrganizationContext } from "../lib/authorization";
import logger from "../lib/logger";
import {
  PlatformAccessInputError,
  platformTenantAccessService,
  type PlatformTenantAccessService,
} from "../services/platformTenantAccess";

function platformActor(
  req: Request,
  res: Response,
): { userId: string; sessionId: string } | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  if (req.user.platformRole !== "admin") {
    res.status(403).json({ error: "Platform administrator access required" });
    return null;
  }
  if (!req.databaseSessionId) {
    res.status(401).json({ error: "Authenticated session is unavailable" });
    return null;
  }
  return {
    userId: req.user.id,
    sessionId: req.databaseSessionId,
  };
}

function platformFailure(error: unknown, res: Response): void {
  if (error instanceof PlatformAccessInputError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error(
    { errorName: error instanceof Error ? error.name : "UnknownError" },
    "Platform tenant access request failed",
  );
  res.status(500).json({ error: "Platform tenant access request failed" });
}

export function createPlatformTenantAccessRouter(
  service: PlatformTenantAccessService = platformTenantAccessService,
): IRouter {
  const router: IRouter = Router();

  router.get("/platform/tenants", async (req, res) => {
    const actor = platformActor(req, res);
    if (!actor) return;
    try {
      const tenants = await service.listTenants(actor);
      res.json(tenants.map(({ id, name, slug }) => ({ id, name, slug })));
    } catch (error) {
      platformFailure(error, res);
    }
  });

  router.post("/platform/tenant-access", async (req, res) => {
    const actor = platformActor(req, res);
    if (!actor) return;
    if (
      typeof req.body?.organizationId !== "string" ||
      !req.body.organizationId.trim()
    ) {
      res.status(400).json({
        error: "Organization is required for tenant access",
      });
      return;
    }
    try {
      const access = await service.enterTenant({
        ...actor,
        organizationId: req.body.organizationId,
        reason:
          typeof req.body.reason === "string" ? req.body.reason : undefined,
      });
      res.json(
        authSessionResponse(
          req.user!,
          platformLeaseOrganizationContext({
            userId: actor.userId,
            leaseId: access.leaseId,
            organizationId: access.organizationId,
            organizationName: access.organizationName,
            expiresAt: access.expiresAt,
          }),
        ),
      );
    } catch (error) {
      platformFailure(error, res);
    }
  });

  router.delete("/platform/tenant-access", async (req, res) => {
    const actor = platformActor(req, res);
    if (!actor) return;
    try {
      await service.exitTenant(actor);
      res.json(authSessionResponse(req.user!, null));
    } catch (error) {
      platformFailure(error, res);
    }
  });

  return router;
}

export default createPlatformTenantAccessRouter();
