import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { claims, audits } from "@workspace/db";
import { eq } from "drizzle-orm";
import { renderAuditEmail } from "../services/email";
import { sendEmail } from "../services/sendgrid";
import type { AuditResponse } from "../services/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router: IRouter = Router();

function getAuditHtml(claim: any, audit: any): string {
  const auditResult = audit.rawResponse as unknown as AuditResponse;
  auditResult.technical_score = auditResult.technical_score ?? 0;
  auditResult.presentation_score = auditResult.presentation_score ?? 0;
  auditResult.presentation_issues = auditResult.presentation_issues ?? [];
  if (!auditResult.section_scores) {
    auditResult.section_scores = {} as any;
  }
  return renderAuditEmail({
    claimNumber: claim.claimNumber ?? "",
    insuredName: claim.insuredName ?? "",
    carrier: claim.carrier ?? "",
    auditResult,
  });
}

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

    const html = getAuditHtml(claim, audit);
    res.json({ html });
  } catch (err) {
    console.error("Error rendering email:", err);
    res.status(500).json({ error: "Failed to render email" });
  }
});

router.post("/claims/:id/email/send", async (req, res) => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid claim ID format" });
      return;
    }

    const { to, subject } = req.body;
    if (!to) {
      res.status(400).json({ error: "Recipient email (to) is required" });
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

    const html = getAuditHtml(claim, audit);
    const emailSubject = subject || `Claims iQ Audit — ${claim.claimNumber} — ${claim.insuredName}`;

    await sendEmail({ to, subject: emailSubject, html });

    console.log(`Audit email sent for claim ${claim.claimNumber} to ${to}`);
    res.json({ success: true, message: `Email sent to ${to}` });
  } catch (err: any) {
    console.error("Error sending email:", err);
    if (err.message?.includes("SENDGRID_API_KEY")) {
      res.status(500).json({ error: "SendGrid API key is not configured. Add SENDGRID_API_KEY to Replit Secrets." });
    } else {
      res.status(500).json({ error: err.message || "Failed to send email" });
    }
  }
});

export default router;
