import { type NextFunction, type Request, type Response } from "express";
import {
  runWithOperationsContext,
  runWithUnboundDatabaseRequest,
} from "@workspace/db";

function isOperationsRoute(path: string): boolean {
  return path === "/api/healthz" || path.startsWith("/email/inbound");
}

export function databaseContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (isOperationsRoute(req.path)) {
    runWithOperationsContext(next);
    return;
  }
  runWithUnboundDatabaseRequest(next);
}
