import { type Request, type Response, type NextFunction } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user.platformRole !== "admin") {
    res.status(403).json({ error: "Platform administrator access required" });
    return;
  }
  next();
}
