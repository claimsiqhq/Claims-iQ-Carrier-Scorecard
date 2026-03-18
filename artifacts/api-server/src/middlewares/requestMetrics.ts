import { type Request, type Response, type NextFunction } from "express";
import logger from "../lib/logger";

const routeMetrics: Record<string, { count: number; totalMs: number; errors: number }> = {};

export function requestMetrics(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const route = `${req.method} ${req.route?.path || req.path}`;

    if (!routeMetrics[route]) {
      routeMetrics[route] = { count: 0, totalMs: 0, errors: 0 };
    }
    routeMetrics[route].count++;
    routeMetrics[route].totalMs += duration;
    if (res.statusCode >= 400) {
      routeMetrics[route].errors++;
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
