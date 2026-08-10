import crypto from "crypto";
import { type Request, type Response } from "express";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export const SESSION_COOKIE = "sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: string;
}

export interface SessionData {
  user: SessionUser;
  authVersion: number;
}

function storedSessionId(sessionId: string): string {
  return crypto.createHash("sha256").update(sessionId).digest("hex");
}

export async function createSession(data: SessionData): Promise<string> {
  const sessionToken = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid: storedSessionId(sessionToken),
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
    userId: data.user.id,
    authVersion: data.authVersion,
  });
  return sessionToken;
}

export async function getSession(sessionToken: string): Promise<SessionData | null> {
  const hashedId = storedSessionId(sessionToken);
  const [row] = await db
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

  const [currentUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, stored.user.id))
    .limit(1);
  if (!currentUser) {
    await deleteSession(sessionToken);
    return null;
  }
  if (
    row.userId !== currentUser.id
    || row.authVersion === null
    || row.authVersion !== currentUser.authVersion
  ) {
    await deleteSession(sessionToken);
    return null;
  }

  return {
    user: {
      id: currentUser.id,
      email: currentUser.email,
      firstName: currentUser.firstName,
      lastName: currentUser.lastName,
      profileImageUrl: currentUser.profileImageUrl,
      role: currentUser.role,
    },
  };
}

export async function deleteSession(sessionToken: string): Promise<void> {
  await db
    .delete(sessionsTable)
    .where(
      inArray(sessionsTable.sid, [
        storedSessionId(sessionToken),
        sessionToken,
      ]),
    );
}

export async function revokeUserSessions(userId: string): Promise<void> {
  await db
    .delete(sessionsTable)
    .where(eq(sessionsTable.userId, userId));
}

export async function clearSession(
  res: Response,
  sid?: string,
): Promise<void> {
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
