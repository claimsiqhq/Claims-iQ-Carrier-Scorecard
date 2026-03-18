import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { db, pool } from "@workspace/db";
import {
  claims,
  documents,
  audits,
  auditSections,
  auditFindings,
  auditStructured,
  auditVersions,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { runFinalAudit, type AuditResponse } from "../services/audit";
import { requireAuth } from "../middlewares/requireAuth";
import logger from "../lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractFindingText(item: unknown): { title: string; description: string } {
  if (typeof item === "string") return { title: item, description: item };
  if (item && typeof item === "object") {
    const obj = item as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.item === "string") parts.push(obj.item);
    else if (typeof obj.title === "string") parts.push(obj.title);
    if (typeof obj.reason === "string") parts.push(obj.reason);
    if (typeof obj.next_step === "string") parts.push(`Next: ${obj.next_step}`);
    if (typeof obj.description === "string" && !parts.includes(obj.description as string)) parts.push(obj.description as string);
    const text = parts.length > 0 ? parts.join(" — ") : JSON.stringify(item);
    const title = (typeof obj.title === "string" ? obj.title : typeof obj.item === "string" ? obj.item : text).substring(0, 200);
    return { title, description: text };
  }
  return { title: String(item), description: String(item) };
}

const auditLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Audit rate limit exceeded. Try again later." },
});

const router: IRouter = Router();
const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

router.post("/claims/:id/audit", requireAuth, auditLimiter, async (req, res) => {
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

    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.claimId, id));

    const reportParts: string[] = [];
    reportParts.push(`Claim Number: ${claim.claimNumber}`);
    reportParts.push(`Insured: ${claim.insuredName}`);
    reportParts.push(`Carrier: ${claim.carrier}`);
    reportParts.push(`Date of Loss: ${claim.dateOfLoss}`);
    reportParts.push(`Status: ${claim.status}`);
    reportParts.push("");

    for (const doc of docs) {
      reportParts.push(`--- Document: ${doc.type} ---`);
      if (doc.extractedText) {
        reportParts.push(doc.extractedText);
      } else {
        reportParts.push("[No text content available]");
      }
      reportParts.push("");
    }

    const reportText = reportParts.join("\n");

    let auditResult: AuditResponse;
    try {
      auditResult = await runFinalAudit(reportText);
    } catch (err) {
      logger.error({ err }, "OpenAI audit call failed");
      const { getFallbackAudit } = await import("../services/audit");
      auditResult = getFallbackAudit();
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const txDb = drizzle(client, { schema });

      const existingAudits = await txDb
        .select()
        .from(audits)
        .where(eq(audits.claimId, id));
      for (const existing of existingAudits) {
        await txDb.delete(auditStructured).where(eq(auditStructured.auditId, existing.id));
        await txDb.delete(auditFindings).where(eq(auditFindings.auditId, existing.id));
        await txDb.delete(auditSections).where(eq(auditSections.auditId, existing.id));
      }
      if (existingAudits.length > 0) {
        await txDb.delete(auditVersions).where(eq(auditVersions.claimId, id));
        await txDb.delete(audits).where(eq(audits.claimId, id));
      }

      const [newAudit] = await txDb
        .insert(audits)
        .values({
          claimId: id,
          overallScore: String(auditResult.overall_score),
          technicalScore: String(auditResult.technical_score),
          presentationScore: String(auditResult.presentation_score),
          riskLevel: auditResult.risk_level,
          approvalStatus: auditResult.approval_status,
          executiveSummary: auditResult.executive_summary,
          rawResponse: auditResult as unknown as Record<string, unknown>,
        })
        .returning();

      const sectionKeys = [
        "coverage_clarity", "scope_completeness", "estimate_accuracy",
        "documentation_support", "financial_accuracy", "carrier_risk",
        "file_stack_order", "payment_match", "estimate_operational_order",
        "photo_organization", "da_report_quality", "fa_report_quality",
        "policy_provisions",
      ] as const;

      const reasoning = auditResult.section_reasoning ?? {};

      await txDb.insert(auditSections).values(
        sectionKeys.map((key) => ({
          auditId: newAudit.id,
          section: key,
          score: String(auditResult.section_scores[key] ?? 0),
          reasoning: (reasoning as Record<string, string>)[key] || null,
        }))
      );

      const allFindings: { type: string; severity: string; title: string; description: string }[] = [];

      const findingGroups = [
        { type: "defect", severity: "critical", items: auditResult.critical_failures || [] },
        { type: "defect", severity: "warning", items: auditResult.key_defects || [] },
        { type: "presentation_issue", severity: "warning", items: auditResult.presentation_issues || [] },
        { type: "carrier_question", severity: "info", items: auditResult.carrier_questions || [] },
        { type: "deferred", severity: "info", items: auditResult.deferred_items || [] },
      ];

      for (const group of findingGroups) {
        for (const item of group.items) {
          const { title, description } = extractFindingText(item);
          allFindings.push({ type: group.type, severity: group.severity, title: title.substring(0, 200), description });
        }
      }

      const riskItems = [
        ...(auditResult.scope_deviations || []).map((item) => ({ type: "risk", severity: "warning", item })),
        ...(auditResult.unknowns || []).map((item) => ({ type: "risk", severity: "info", item })),
        ...(auditResult.invoice_adjustments || []).map((item) => ({ type: "risk", severity: "warning", item })),
      ];

      for (const rf of riskItems) {
        const { title, description } = extractFindingText(rf.item);
        allFindings.push({ type: rf.type, severity: rf.severity, title: title.substring(0, 200), description });
      }

      if (allFindings.length > 0) {
        await txDb.insert(auditFindings).values(
          allFindings.map((f) => ({
            auditId: newAudit.id,
            type: f.type,
            severity: f.severity,
            title: f.title,
            description: f.description,
            metadata: { category: f.type },
          }))
        );
      }

      await txDb.insert(auditStructured).values({
        auditId: newAudit.id,
        deferredItems: auditResult.deferred_items || [],
        invoiceAdjustments: auditResult.invoice_adjustments || [],
        scopeDeviations: auditResult.scope_deviations || [],
        unknowns: auditResult.unknowns || [],
        carrierQuestions: auditResult.carrier_questions || [],
      });

      await txDb
        .update(claims)
        .set({ status: "analyzed" })
        .where(eq(claims.id, id));

      await txDb.insert(auditVersions).values({
        claimId: id,
        auditId: newAudit.id,
        versionNumber: 1,
      });

      await client.query("COMMIT");

      logger.info({ claimId: id, auditId: newAudit.id }, "Audit saved");

      res.json({
        success: true,
        auditId: newAudit.id,
        overallScore: auditResult.overall_score,
        technicalScore: auditResult.technical_score,
        presentationScore: auditResult.presentation_score,
        riskLevel: auditResult.risk_level,
        approvalStatus: auditResult.approval_status,
      });
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, "Error running audit");
    res.status(500).json({ error: "Failed to run audit" });
  }
});

export default router;
