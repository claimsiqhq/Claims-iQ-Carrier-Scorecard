import { type NextFunction, type Request, type Response } from "express";
import {
  hasOrganizationPermission,
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

export async function organizationContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const organizationOptionalAuthPaths = [
    "/api/auth/invitations/",
    "/api/auth/password/forgot",
    "/api/auth/password/reset",
  ];
  if (
    organizationOptionalAuthPaths.some((path) => req.path.startsWith(path))
  ) {
    next();
    return;
  }

  if (!req.isAuthenticated()) {
    next();
    return;
  }

  const requestedOrganizationId =
    typeof req.headers["x-organization-id"] === "string"
      ? req.headers["x-organization-id"].trim()
      : undefined;

  try {
    const context = await resolveOrganizationContext(
      req.user.id,
      requestedOrganizationId || undefined,
    );
    if (!context) {
      res.status(requestedOrganizationId ? 403 : 401).json({
        error: requestedOrganizationId
          ? "Organization access denied"
          : "No organization membership found",
      });
      return;
    }

    req.organization = context;
    next();
  } catch (err) {
    logger.error({ err, userId: req.user.id }, "Organization context resolution failed");
    res.status(500).json({ error: "Failed to resolve organization context" });
  }
}

export function requireOrganizationPermission(permission: OrganizationPermission) {
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
