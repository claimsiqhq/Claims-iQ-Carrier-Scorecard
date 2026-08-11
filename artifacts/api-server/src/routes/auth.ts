import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { identityDb, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  getSessionId,
  createSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";
import { authSessionResponse } from "../lib/authResponse";
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

      const sid = await createSession(sessionData);
      setSessionCookie(res, sid);

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

export default router;
