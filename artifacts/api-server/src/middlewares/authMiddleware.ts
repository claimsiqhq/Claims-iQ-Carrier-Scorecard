import { type Request, type Response, type NextFunction } from "express";
import {
  clearSession,
  getSessionId,
  getSession,
  type ActivePlatformTenantAccess,
  type SessionUser,
} from "../lib/auth";

declare global {
  namespace Express {
    interface User extends SessionUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User | undefined;
      databaseSessionId?: string;
      activePlatformTenantAccess?: ActivePlatformTenantAccess | null;
    }

    export interface AuthedRequest {
      user: User;
      databaseSessionId: string;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  try {
    const session = await getSession(sid);
    if (!session?.user?.id) {
      await clearSession(res, sid);
      next();
      return;
    }

    req.user = session.user;
    req.databaseSessionId = session.databaseSessionId;
    req.activePlatformTenantAccess = session.activePlatformTenantAccess;
    next();
  } catch (error) {
    next(error);
  }
}
