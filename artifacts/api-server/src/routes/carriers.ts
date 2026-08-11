import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { listActiveCarriers } from "../services/carrierRulesetService";

const router: IRouter = Router();

router.get("/carriers", requireAuth, async (req, res) => {
  if (!req.organization) {
    res.status(403).json({ error: "Organization context required" });
    return;
  }
  const carriers = await listActiveCarriers(req.organization.organizationId);
  res.json(carriers);
});

// Legacy administration URLs are authenticated redirects only. No carrier or
// claim data is read before the platform route revalidates the active lease.
router.use("/carriers", requireAdmin, (req, res) => {
  const withoutLegacyAll = req.originalUrl.replace(
    /^\/api\/carriers\/all(?=\/|$)/,
    "/api/platform/carriers",
  );
  const target = withoutLegacyAll.replace(
    /^\/api\/carriers(?=\/|$)/,
    "/api/platform/carriers",
  );
  res.redirect(308, target);
});

export default router;
