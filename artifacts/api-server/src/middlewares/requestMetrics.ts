import { type Request, type Response, type NextFunction } from "express";
import logger from "../lib/logger";

const MAX_ROUTE_KEYS = 200;
const routeMetrics: Record<string, { count: number; totalMs: number; errors: number }> = {};

function normalizeRoute(req: Request): string {
  const routePath = req.route?.path;
  if (routePath) {
    return `${req.method} ${routePath}`;
  }
  const path = req.path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
  return `${req.method} ${path}`;
}

export function requestMetrics(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const route = normalizeRoute(req);

    if (Object.keys(routeMetrics).length < MAX_ROUTE_KEYS || routeMetrics[route]) {
      if (!routeMetrics[route]) {
        routeMetrics[route] = { count: 0, totalMs: 0, errors: 0 };
      }
      routeMetrics[route].count++;
      routeMetrics[route].totalMs += duration;
      if (res.statusCode >= 400) {
        routeMetrics[route].errors++;
      }
    }

    if (duration > 5000) {
      logger.warn({ route, duration, statusCode: res.statusCode }, "Slow request detected");
    }
  });

  next();
}

export function getMetrics() {
  const result: Record<string, { count: number; avgMs: number; errors: number }> = {};
  for (const [route, data] of Object.entries(routeMetrics)) {
    result[route] = {
      count: data.count,
      avgMs: data.count > 0 ? Math.round(data.totalMs / data.count) : 0,
      errors: data.errors,
    };
  }
  return result;
}
