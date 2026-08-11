import { type NextFunction, type Request, type Response } from "express";
import {
  acquireTenantDatabase,
  runWithTenantDatabase,
  type ScopedDatabaseLease,
} from "@workspace/db";
import {
  hasOrganizationPermission,
  MultipleOrganizationMembershipsError,
  platformLeaseOrganizationContext,
  resolveOrganizationContext,
  type OrganizationContext,
  type OrganizationPermission,
} from "../lib/authorization";
import logger from "../lib/logger";

declare global {
  namespace Express {
    interface Request {
      organization?: OrganizationContext;
    }
  }
}

function isNonTenantRoute(path: string): boolean {
  return (
    path.startsWith("/api/auth") ||
    path.startsWith("/api/platform") ||
    path === "/api/healthz" ||
    path.startsWith("/email/inbound")
  );
}

function releaseOnResponseEnd(res: Response, lease: ScopedDatabaseLease): void {
  let releaseStarted = false;
  const release = () => {
    if (releaseStarted) return;
    releaseStarted = true;
    void lease.release().catch((error: unknown) => {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Tenant database context release failed",
      );
    });
  };
  res.once("finish", release);
  res.once("close", release);
}

export async function organizationContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.headers["x-organization-id"] !== undefined) {
    res.status(403).json({
      error:
        "Organization selection headers are not accepted; tenant context is session-bound.",
    });
    return;
  }

  if (!req.isAuthenticated()) {
    next();
    return;
  }

  try {
    const context =
      req.user.platformRole === "admin" && req.activePlatformTenantAccess
        ? platformLeaseOrganizationContext({
            userId: req.user.id,
            leaseId: req.activePlatformTenantAccess.leaseId,
            organizationId: req.activePlatformTenantAccess.organizationId,
            organizationName: req.activePlatformTenantAccess.organizationName,
            expiresAt: req.activePlatformTenantAccess.expiresAt,
          })
        : req.user.platformRole === "admin"
          ? null
          : await resolveOrganizationContext(req.user.id);

    req.organization = context ?? undefined;
    if (!context) {
      if (isNonTenantRoute(req.path)) {
        next();
        return;
      }
      res.status(403).json({
        error:
          req.user.platformRole === "admin"
            ? "A current platform tenant access lease is required"
            : "Exactly one organization membership is required",
      });
      return;
    }

    if (isNonTenantRoute(req.path)) {
      next();
      return;
    }

    const lease = await acquireTenantDatabase({
      userId: req.user.id,
      organizationId: context.organizationId,
      sessionId: req.databaseSessionId,
    });
    if (res.writableEnded || res.destroyed) {
      await lease.release();
      return;
    }
    releaseOnResponseEnd(res, lease);
    runWithTenantDatabase(lease, next);
  } catch (err) {
    if (err instanceof MultipleOrganizationMembershipsError) {
      res.status(403).json({
        error:
          "Multiple organization memberships are not valid for tenant sessions",
      });
      return;
    }
    logger.error(
      {
        errorName: err instanceof Error ? err.name : "UnknownError",
        userId: req.user.id,
      },
      "Organization context resolution failed",
    );
    res.status(500).json({ error: "Failed to resolve organization context" });
  }
}

export function requireOrganizationPermission(
  permission: OrganizationPermission,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!req.organization) {
      res.status(403).json({ error: "Organization context required" });
      return;
    }
    if (!hasOrganizationPermission(req.organization, permission)) {
      res.status(403).json({ error: "Insufficient organization permission" });
      return;
    }
    next();
  };
}
