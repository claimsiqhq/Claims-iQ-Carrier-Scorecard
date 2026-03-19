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
const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

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

  const auditResult = raw as unknown as AuditResponse;

  if (!auditResult.overall_audit) {
    const fallback: AuditResponse = {
      claim_metadata: {
        claim_number: claim.claimNumber ?? "",
        insured_name: claim.insuredName ?? "",
        carrier_name: claim.carrier ?? "",
      },
      overall_audit: {
        overall_score_percent: Number(audit.overallScore ?? 0),
        overall_points_awarded: 0,
        overall_points_possible: 200,
        readiness: "NOT READY",
        technical_risk: String(audit.riskLevel ?? "MEDIUM") as any,
        failed_count: 0,
        partial_count: 0,
        passed_count: 0,
        warning_count: 0,
        action_required_count: 0,
        executive_summary: audit.executiveSummary ?? "",
      },
      desk_adjuster_scorecard: {
        score_percent: 0,
        points_awarded: 0,
        points_possible: 100,
        denial_letter_applicable: false,
        categories: [],
      },
      field_adjuster_scorecard: {
        score_percent: 0,
        points_awarded: 0,
        points_possible: 100,
        categories: [],
      },
      issues: [],
      validation_checks: [],
      root_issue_groups: [],
      vision_analysis: null,
    };
    return renderAuditEmail({
      claimNumber: claim.claimNumber ?? "",
      insuredName: claim.insuredName ?? "",
      carrier: claim.carrier ?? "",
      auditResult: fallback,
    });
  }

  return renderAuditEmail({
    claimNumber: claim.claimNumber ?? "",
    insuredName: claim.insuredName ?? "",
    carrier: claim.carrier ?? "",
    auditResult,
  });
}

router.get("/claims/:id/email", requireAuth, async (req, res) => {
  try {
    const id = firstParam(req.params.id);
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
    const id = firstParam(req.params.id);
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
