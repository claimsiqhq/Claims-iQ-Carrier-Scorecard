import { Router, type IRouter } from "express";
import { db, carrierRulesets } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { listActiveCarriers } from "../services/carrierRulesetService";

const router: IRouter = Router();

router.get("/carriers", async (_req, res) => {
  const carriers = await listActiveCarriers();
  res.json(carriers);
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

router.put("/carriers/:key", requireAuth, async (req, res) => {
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

export default router;
