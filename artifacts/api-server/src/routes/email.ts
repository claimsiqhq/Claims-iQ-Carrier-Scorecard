import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import { claims, audits } from "@workspace/db";
import { eq } from "drizzle-orm";
import { renderAuditEmail } from "../services/email";
import { sendEmail } from "../services/sendgrid";
import { requireAuth } from "../middlewares/requireAuth";
import logger from "../lib/logger";
import type { AuditResponse } from "../services/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emailSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Email rate limit exceeded. Try again later." },
});

const router: IRouter = Router();

function getAuditHtml(claim: any, audit: any): string {
  const raw = audit.rawResponse as Record<string, unknown>;
  const sectionScores = (raw.section_scores ?? {}) as AuditResponse["section_scores"];
  const sectionReasoning = (raw.section_reasoning ?? {}) as AuditResponse["section_reasoning"];
  const auditResult: AuditResponse = {
    overall_score: Number(raw.overall_score ?? 0),
    technical_score: Number(raw.technical_score ?? 0),
    presentation_score: Number(raw.presentation_score ?? 0),
    section_scores: sectionScores,
    section_reasoning: sectionReasoning,
    risk_level: String(raw.risk_level ?? ""),
    approval_status: String(raw.approval_status ?? ""),
    critical_failures: Array.isArray(raw.critical_failures) ? raw.critical_failures : [],
    key_defects: Array.isArray(raw.key_defects) ? raw.key_defects : [],
    presentation_issues: Array.isArray(raw.presentation_issues) ? raw.presentation_issues : [],
    carrier_questions: Array.isArray(raw.carrier_questions) ? raw.carrier_questions : [],
    deferred_items: Array.isArray(raw.deferred_items) ? raw.deferred_items : [],
    invoice_adjustments: Array.isArray(raw.invoice_adjustments) ? raw.invoice_adjustments : [],
    scope_deviations: Array.isArray(raw.scope_deviations) ? raw.scope_deviations : [],
    unknowns: Array.isArray(raw.unknowns) ? raw.unknowns : [],
    executive_summary: String(raw.executive_summary ?? ""),
  };
  return renderAuditEmail({
    claimNumber: claim.claimNumber ?? "",
    insuredName: claim.insuredName ?? "",
    carrier: claim.carrier ?? "",
    auditResult,
  });
}

router.get("/claims/:id/email", requireAuth, async (req, res) => {
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
    logger.error({ err }, "Error rendering email");
    res.status(500).json({ error: "Failed to render email" });
  }
});

router.post("/claims/:id/email/send", requireAuth, emailSendLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid claim ID format" });
      return;
    }

    const { to, subject } = req.body;
    if (!to || typeof to !== "string") {
      res.status(400).json({ error: "Recipient email (to) is required" });
      return;
    }

    if (!EMAIL_RE.test(to.trim())) {
      res.status(400).json({ error: "Invalid email address format" });
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

    await sendEmail({ to: to.trim(), subject: emailSubject, html });

    logger.info({ claimId: claim.id }, "Audit email sent");
    res.json({ success: true, message: "Email sent successfully" });
  } catch (err: any) {
    logger.error({ err }, "Error sending email");
    if (err.message?.includes("SENDGRID_API_KEY")) {
      res.status(500).json({ error: "Email service is not configured." });
    } else {
      res.status(500).json({ error: "Failed to send email" });
    }
  }
});

export default router;
