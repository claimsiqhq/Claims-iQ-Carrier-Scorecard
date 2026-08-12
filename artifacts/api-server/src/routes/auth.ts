import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { identityDb, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  getSessionId,
  createSession,
  setSessionActiveOrganization,
  storedSessionId,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";
import { authSessionResponse } from "../lib/authResponse";
import {
  listMembershipContexts,
  membershipOrganizationContext,
  platformLeaseOrganizationContext,
} from "../lib/authorization";
import {
  PlatformAccessInputError,
  platformTenantAccessService,
} from "../services/platformTenantAccess";
import logger from "../lib/logger";

const router: IRouter = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many sign-in attempts. Try again later." },
});

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
    priority: "high",
  });
}

async function recordLastActiveOrganization(
  userId: string,
  organizationId: string,
): Promise<void> {
  try {
    await identityDb
      .update(usersTable)
      .set({ lastActiveOrganizationId: organizationId })
      .where(eq(usersTable.id, userId));
  } catch (err) {
    logger.warn(
      { err, userId },
      "Failed to record the last active organization",
    );
  }
}

/**
 * Open the platform administrator's tenant workspace at sign-in: the tenant
 * they last worked in, falling back to the first available tenant. Sign-in
 * still succeeds when no tenant can be opened.
 */
async function openInitialPlatformTenant(
  userId: string,
  databaseSessionId: string,
  lastActiveOrganizationId: string | null,
): Promise<void> {
  try {
    const actor = { userId, sessionId: databaseSessionId };
    const tenants = await platformTenantAccessService.listTenants(actor);
    const target =
      tenants.find((tenant) => tenant.id === lastActiveOrganizationId) ??
      tenants[0];
    if (!target) return;
    const access = await platformTenantAccessService.enterTenant({
      ...actor,
      organizationId: target.id,
    });
    await setSessionActiveOrganization(
      databaseSessionId,
      userId,
      access.organizationId,
    );
    await recordLastActiveOrganization(userId, access.organizationId);
  } catch (err) {
    logger.warn(
      { err, userId },
      "Platform tenant workspace could not be opened at sign-in",
    );
  }
}

router.get("/auth/user", (req: Request, res: Response) => {
  if (req.isAuthenticated()) {
    res.json(authSessionResponse(req.user, req.organization));
  } else {
    res.json({ user: null, organization: null });
  }
});

router.post(
  "/auth/login",
  loginLimiter,
  async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    try {
      const [user] = await identityDb
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email.toLowerCase().trim()));

      if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const sessionData: SessionData = {
        authVersion: user.authVersion,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
          role: user.role,
          platformRole:
            user.platformRole === "platform_admin" ? "admin" : "none",
        },
      };

      if (sessionData.user.platformRole !== "admin") {
        const memberships = await listMembershipContexts(user.id);
        const initial =
          memberships.find(
            (membership) =>
              membership.organizationId === user.lastActiveOrganizationId,
          ) ?? memberships[0];
        if (initial) {
          sessionData.activeOrganizationId = initial.organizationId;
        }
      }

      const sid = await createSession(sessionData);
      setSessionCookie(res, sid);

      if (sessionData.user.platformRole === "admin") {
        await openInitialPlatformTenant(
          user.id,
          storedSessionId(sid),
          user.lastActiveOrganizationId,
        );
      } else if (sessionData.activeOrganizationId) {
        await recordLastActiveOrganization(
          user.id,
          sessionData.activeOrganizationId,
        );
      }

      logger.info({ userId: user.id }, "User logged in");

      res.json({
        user: sessionData.user,
      });
    } catch (err) {
      logger.error({ err }, "Login error");
      res.status(500).json({ error: "Login failed" });
    }
  },
);

router.post("/auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.json({ success: true });
});

router.get("/auth/organizations", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.databaseSessionId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    if (req.user.platformRole === "admin") {
      const tenants = await platformTenantAccessService.listTenants({
        userId: req.user.id,
        sessionId: req.databaseSessionId,
      });
      res.json(
        tenants.map(({ id, name, slug }) => ({
          id,
          name,
          slug,
          role: "platform_admin",
        })),
      );
      return;
    }

    const memberships = await listMembershipContexts(req.user.id);
    res.json(
      memberships.map((membership) => ({
        id: membership.organizationId,
        name: membership.organizationName,
        slug: null,
        role: membership.role,
      })),
    );
  } catch (err) {
    logger.error({ err, userId: req.user.id }, "Organization list failed");
    res.status(500).json({ error: "Organizations could not be listed" });
  }
});

router.post(
  "/auth/active-organization",
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated() || !req.databaseSessionId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const organizationId =
      typeof req.body?.organizationId === "string"
        ? req.body.organizationId.trim()
        : "";
    if (!organizationId) {
      res.status(400).json({ error: "Organization is required" });
      return;
    }

    try {
      if (req.user.platformRole === "admin") {
        const access = await platformTenantAccessService.enterTenant({
          userId: req.user.id,
          sessionId: req.databaseSessionId,
          organizationId,
        });
        await setSessionActiveOrganization(
          req.databaseSessionId,
          req.user.id,
          access.organizationId,
        );
        await recordLastActiveOrganization(req.user.id, access.organizationId);
        res.json(
          authSessionResponse(
            req.user,
            platformLeaseOrganizationContext({
              userId: req.user.id,
              leaseId: access.leaseId,
              organizationId: access.organizationId,
              organizationName: access.organizationName,
              expiresAt: access.expiresAt,
            }),
          ),
        );
        return;
      }

      const memberships = await listMembershipContexts(req.user.id);
      const membership = memberships.find(
        (candidate) => candidate.organizationId === organizationId,
      );
      if (!membership) {
        res
          .status(403)
          .json({ error: "You do not have access to that organization" });
        return;
      }
      await setSessionActiveOrganization(
        req.databaseSessionId,
        req.user.id,
        membership.organizationId,
      );
      await recordLastActiveOrganization(
        req.user.id,
        membership.organizationId,
      );
      res.json(
        authSessionResponse(
          req.user,
          membershipOrganizationContext(req.user.id, membership),
        ),
      );
    } catch (err) {
      if (err instanceof PlatformAccessInputError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err, userId: req.user.id }, "Organization switch failed");
      res.status(500).json({ error: "Organization could not be switched" });
    }
  },
);

export default router;
