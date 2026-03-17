import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { claims, audits } from "@workspace/db";
import { eq } from "drizzle-orm";
import { renderAuditEmail } from "../services/email";
import type { AuditResponse } from "../services/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router: IRouter = Router();

router.get("/claims/:id/email", async (req, res) => {
  try {
    const { id } = req.params;

    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid claim ID format" });
      return;
    }

    const [claim] = await db.select().from(claims).where(eq(claims.id, id));
    if (!claim) {
      res.status(404).json({ error: "Claim not found" });
      return;
    }

    const [audit] = await db.select().from(audits).where(eq(audits.claimId, id));
    if (!audit || !audit.rawResponse) {
      res.status(404).json({ error: "No audit found for this claim" });
      return;
    }

    const auditResult = audit.rawResponse as unknown as AuditResponse;

    auditResult.technical_score = auditResult.technical_score ?? 0;
    auditResult.presentation_score = auditResult.presentation_score ?? 0;
    auditResult.presentation_issues = auditResult.presentation_issues ?? [];
    if (!auditResult.section_scores) {
      auditResult.section_scores = {} as any;
    }

    const html = renderAuditEmail({
      claimNumber: claim.claimNumber ?? "",
      insuredName: claim.insuredName ?? "",
      carrier: claim.carrier ?? "",
      auditResult,
    });

    console.log("Email rendered for claim", claim.claimNumber);

    res.json({ html });
  } catch (err) {
    console.error("Error rendering email:", err);
    res.status(500).json({ error: "Failed to render email" });
  }
});

export default router;
