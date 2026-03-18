import { type Request, type Response, type NextFunction } from "express";
import logger from "../lib/logger";

const SENSITIVE_ROUTES = [
  { method: "POST", pattern: /\/claims\/[^/]+\/audit$/, action: "run_audit" },
  { method: "POST", pattern: /\/claims\/[^/]+\/email\/send$/, action: "send_email" },
  { method: "DELETE", pattern: /\/claims\/[^/]+$/, action: "delete_claim" },
  { method: "PUT", pattern: /\/settings\/prompts$/, action: "update_prompts" },
  { method: "POST", pattern: /\/settings\/prompts\/reset$/, action: "reset_prompts" },
  { method: "POST", pattern: /\/ingest$/, action: "ingest_claim" },
];

export function auditLog(req: Request, res: Response, next: NextFunction) {
  const match = SENSITIVE_ROUTES.find(
    (r) => r.method === req.method && r.pattern.test(req.path)
  );

  if (match) {
    const userId = req.isAuthenticated() ? req.user.id : "anonymous";
    res.on("finish", () => {
      logger.info({
        audit: true,
        action: match.action,
        userId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        timestamp: new Date().toISOString(),
      }, `AUDIT: ${match.action} by ${userId} → ${res.statusCode}`);
    });
  }

  next();
}
