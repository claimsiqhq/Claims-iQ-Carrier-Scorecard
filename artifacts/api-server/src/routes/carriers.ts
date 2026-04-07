import { Router, type IRouter } from "express";
import { db, carrierRulesets } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { listActiveCarriers } from "../services/carrierRulesetService";

const router: IRouter = Router();

router.get("/carriers", async (_req, res) => {
  const carriers = await listActiveCarriers();
  res.json(carriers);
});

router.get("/carriers/all", requireAuth, async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(carrierRulesets);
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to load carriers" });
  }
});

router.get("/carriers/:key", requireAuth, async (req, res) => {
  const key = req.params.key as string;
  const [row] = await db
    .select()
    .from(carrierRulesets)
    .where(eq(carrierRulesets.carrierKey, key))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Carrier not found" });
    return;
  }
  res.json(row);
});

router.put("/carriers/:key", requireAdmin, async (req, res) => {
  const key = req.params.key as string;
  const { displayName, logoUrl, ruleset, active } = req.body;
  await db
    .insert(carrierRulesets)
    .values({ carrierKey: key, displayName, logoUrl, ruleset, active })
    .onConflictDoUpdate({
      target: carrierRulesets.carrierKey,
      set: { displayName, logoUrl, ruleset, active, updatedAt: new Date() },
    });
  res.json({ success: true });
});

router.delete("/carriers/:key", requireAdmin, async (req, res) => {
  const key = req.params.key as string;
  const result = await db
    .delete(carrierRulesets)
    .where(eq(carrierRulesets.carrierKey, key));
  if (result.rowCount === 0) {
    res.status(404).json({ error: "Carrier not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
