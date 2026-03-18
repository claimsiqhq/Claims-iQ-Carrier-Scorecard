import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getMetrics } from "../middlewares/requestMetrics";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  const checks: Record<string, string> = {};

  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      checks.database = "ok";
    } finally {
      client.release();
    }
  } catch {
    checks.database = "error";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  res.status(allOk ? 200 : 503).json({ status: allOk ? "ok" : "degraded", checks });
});

router.get("/metrics", async (_req, res) => {
  res.json(getMetrics());
});

export default router;
