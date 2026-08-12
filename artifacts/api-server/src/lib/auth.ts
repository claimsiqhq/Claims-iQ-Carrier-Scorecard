import crypto from "crypto";
import { type Request, type Response } from "express";
import { identityDb, sessionsTable, usersTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  renewPlatformTenantAccess,
  resolveActivePlatformTenantAccess,
} from "../services/platformTenantAccess";

export const SESSION_COOKIE = "sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
export type ApiPlatformRole = "admin" | "none";

export interface SessionUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: string;
  platformRole: ApiPlatformRole;
}

export interface StoredPlatformTenantAccess {
  leaseId: string;
  organizationId: string;
  expiresAt: string;
}

export interface ActivePlatformTenantAccess {
  leaseId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string | null;
  expiresAt: Date;
}

export interface SessionData {
  user: SessionUser;
  authVersion: number;
  /** The tenant this session is currently working in. */
  activeOrganizationId?: string;
  platformTenantAccess?: StoredPlatformTenantAccess;
}

export interface AuthenticatedSession extends SessionData {
  databaseSessionId: string;
  activePlatformTenantAccess: ActivePlatformTenantAccess | null;
}

export function storedSessionId(sessionId: string): string {
  return crypto.createHash("sha256").update(sessionId).digest("hex");
}

export async function createSession(data: SessionData): Promise<string> {
  const sessionToken = crypto.randomBytes(32).toString("hex");
  await identityDb.insert(sessionsTable).values({
    sid: storedSessionId(sessionToken),
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
    userId: data.user.id,
    authVersion: data.authVersion,
  });
  return sessionToken;
}

function storedAccessFromSession(
  stored: SessionData,
): StoredPlatformTenantAccess | null {
  const access = stored.platformTenantAccess;
  if (
    !access ||
    typeof access.leaseId !== "string" ||
    typeof access.organizationId !== "string" ||
    typeof access.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(access.expiresAt))
  ) {
    return null;
  }
  return access;
}

export function isStoredPlatformAccessExpired(
  access: StoredPlatformTenantAccess,
  now = Date.now(),
): boolean {
  const expiresAt = Date.parse(access.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

function normalizePlatformRole(
  platformRole: "platform_admin" | null,
): ApiPlatformRole {
  return platformRole === "platform_admin" ? "admin" : "none";
}

export async function getSession(
  sessionToken: string,
): Promise<AuthenticatedSession | null> {
  const hashedId = storedSessionId(sessionToken);
  const [row] = await identityDb
    .select()
    .from(sessionsTable)
    .where(inArray(sessionsTable.sid, [hashedId, sessionToken]));

  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sessionToken);
    return null;
  }

  const stored = row.sess as unknown as SessionData;
  if (!stored.user?.id) {
    await deleteSession(sessionToken);
    return null;
  }

  const [currentUser] = await identityDb
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, stored.user.id))
    .limit(1);
  if (!currentUser) {
    await deleteSession(sessionToken);
    return null;
  }
  if (
    row.userId !== currentUser.id ||
    row.authVersion === null ||
    row.authVersion !== currentUser.authVersion
  ) {
    await deleteSession(sessionToken);
    return null;
  }

  const user: SessionUser = {
    id: currentUser.id,
    email: currentUser.email,
    firstName: currentUser.firstName,
    lastName: currentUser.lastName,
    profileImageUrl: currentUser.profileImageUrl,
    role: currentUser.role,
    platformRole: normalizePlatformRole(currentUser.platformRole),
  };
  const storedAccess = storedAccessFromSession(stored);
  let activePlatformTenantAccess: ActivePlatformTenantAccess | null = null;
  if (
    user.platformRole === "admin" &&
    storedAccess &&
    !isStoredPlatformAccessExpired(storedAccess)
  ) {
    activePlatformTenantAccess = await resolveActivePlatformTenantAccess({
      userId: user.id,
      sessionId: row.sid,
      leaseId: storedAccess.leaseId,
      organizationId: storedAccess.organizationId,
      expiresAt: storedAccess.expiresAt,
    });
  }

  // Platform-admin tenant access is renewed silently so administrators are
  // never bounced out of a tenant mid-session when a lease expires.
  const renewalOrganizationId =
    storedAccess?.organizationId ??
    (typeof stored.activeOrganizationId === "string"
      ? stored.activeOrganizationId
      : undefined);
  if (
    user.platformRole === "admin" &&
    !activePlatformTenantAccess &&
    renewalOrganizationId
  ) {
    activePlatformTenantAccess = await renewPlatformTenantAccess({
      userId: user.id,
      sessionId: row.sid,
      organizationId: renewalOrganizationId,
    });
  }
  if (
    stored.platformTenantAccess &&
    (!storedAccess || !activePlatformTenantAccess)
  ) {
    await clearSessionPlatformTenantAccess(row.sid, user.id);
  }

  const activeOrganizationId =
    user.platformRole === "admin"
      ? activePlatformTenantAccess?.organizationId
      : typeof stored.activeOrganizationId === "string"
        ? stored.activeOrganizationId
        : undefined;

  return {
    databaseSessionId: row.sid,
    authVersion: currentUser.authVersion,
    user,
    activePlatformTenantAccess,
    ...(activeOrganizationId ? { activeOrganizationId } : {}),
    ...(activePlatformTenantAccess
      ? {
          platformTenantAccess: {
            leaseId: activePlatformTenantAccess.leaseId,
            organizationId: activePlatformTenantAccess.organizationId,
            expiresAt: activePlatformTenantAccess.expiresAt.toISOString(),
          },
        }
      : {}),
  };
}

export async function deleteSession(sessionToken: string): Promise<void> {
  await identityDb
    .delete(sessionsTable)
    .where(
      inArray(sessionsTable.sid, [storedSessionId(sessionToken), sessionToken]),
    );
}

export async function revokeUserSessions(userId: string): Promise<void> {
  await identityDb
    .delete(sessionsTable)
    .where(eq(sessionsTable.userId, userId));
}

export async function setSessionPlatformTenantAccess(
  databaseSessionId: string,
  userId: string,
  access: StoredPlatformTenantAccess,
): Promise<boolean> {
  const [updated] = await identityDb
    .update(sessionsTable)
    .set({
      sess: sql`jsonb_set(
        ${sessionsTable.sess},
        '{platformTenantAccess}',
        ${JSON.stringify(access)}::jsonb,
        true
      )`,
    })
    .where(
      and(
        eq(sessionsTable.sid, databaseSessionId),
        eq(sessionsTable.userId, userId),
      ),
    )
    .returning({ sid: sessionsTable.sid });
  return Boolean(updated);
}

export async function setSessionActiveOrganization(
  databaseSessionId: string,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const [updated] = await identityDb
    .update(sessionsTable)
    .set({
      sess: sql`jsonb_set(
        ${sessionsTable.sess},
        '{activeOrganizationId}',
        ${JSON.stringify(organizationId)}::jsonb,
        true
      )`,
    })
    .where(
      and(
        eq(sessionsTable.sid, databaseSessionId),
        eq(sessionsTable.userId, userId),
      ),
    )
    .returning({ sid: sessionsTable.sid });
  return Boolean(updated);
}

export async function clearSessionPlatformTenantAccess(
  databaseSessionId: string,
  userId: string,
): Promise<void> {
  await identityDb
    .update(sessionsTable)
    .set({
      sess: sql`${sessionsTable.sess} - 'platformTenantAccess'`,
    })
    .where(
      and(
        eq(sessionsTable.sid, databaseSessionId),
        eq(sessionsTable.userId, userId),
      ),
    );
}

export async function clearSession(res: Response, sid?: string): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
  });
}

export function getSessionId(req: Request): string | undefined {
  return req.cookies?.[SESSION_COOKIE];
}
