import { Router, type IRouter } from "express";
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router: IRouter = Router();

router.post("/claims/:id/audit", async (req, res) => {
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
      console.error("OpenAI audit failed:", err);
      res.status(502).json({
        error: "Audit failed. Please retry.",
        overall_score: 0,
        technical_score: 0,
        presentation_score: 0,
        risk_level: "HIGH",
        approval_status: "REQUIRES REVIEW",
        executive_summary: "Audit failed to process. Please retry.",
      });
      return;
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

      const sectionEntries: { section: string; score: number }[] = [
        { section: "coverage_clarity", score: auditResult.section_scores.coverage_clarity },
        { section: "scope_completeness", score: auditResult.section_scores.scope_completeness },
        { section: "estimate_accuracy", score: auditResult.section_scores.estimate_accuracy },
        { section: "documentation_support", score: auditResult.section_scores.documentation_support },
        { section: "financial_accuracy", score: auditResult.section_scores.financial_accuracy },
        { section: "carrier_risk", score: auditResult.section_scores.carrier_risk },
        { section: "file_stack_order", score: auditResult.section_scores.file_stack_order },
        { section: "payment_match", score: auditResult.section_scores.payment_match },
        { section: "estimate_operational_order", score: auditResult.section_scores.estimate_operational_order },
        { section: "photo_organization", score: auditResult.section_scores.photo_organization },
        { section: "da_report_quality", score: auditResult.section_scores.da_report_quality },
        { section: "fa_report_quality", score: auditResult.section_scores.fa_report_quality },
        { section: "policy_provisions", score: auditResult.section_scores.policy_provisions },
      ];

      for (const entry of sectionEntries) {
        await txDb.insert(auditSections).values({
          auditId: newAudit.id,
          section: entry.section,
          score: String(entry.score),
        });
      }

      const findingGroups: { type: string; severity: string; items: string[] }[] = [
        { type: "defect", severity: "critical", items: auditResult.critical_failures || [] },
        { type: "defect", severity: "warning", items: auditResult.key_defects || [] },
        { type: "presentation_issue", severity: "warning", items: auditResult.presentation_issues || [] },
        { type: "carrier_question", severity: "info", items: auditResult.carrier_questions || [] },
        { type: "deferred", severity: "info", items: auditResult.deferred_items || [] },
      ];

      for (const group of findingGroups) {
        for (const item of group.items) {
          const title = typeof item === "string" ? item : (item as any)?.title ?? String(item);
          const description = typeof item === "string" ? item : (item as any)?.description ?? String(item);
          await txDb.insert(auditFindings).values({
            auditId: newAudit.id,
            type: group.type,
            severity: group.severity,
            title: title.substring(0, 200),
            description,
            metadata: { category: group.type },
          });
        }
      }

      const riskFindings = [
        ...(auditResult.scope_deviations || []).map((item) => ({
          type: "risk" as const,
          severity: "warning" as const,
          item,
        })),
        ...(auditResult.unknowns || []).map((item) => ({
          type: "risk" as const,
          severity: "info" as const,
          item,
        })),
        ...(auditResult.invoice_adjustments || []).map((item) => ({
          type: "risk" as const,
          severity: "warning" as const,
          item,
        })),
      ];

      for (const rf of riskFindings) {
        const title = typeof rf.item === "string" ? rf.item : (rf.item as any)?.title ?? String(rf.item);
        const description = typeof rf.item === "string" ? rf.item : (rf.item as any)?.description ?? String(rf.item);
        await txDb.insert(auditFindings).values({
          auditId: newAudit.id,
          type: rf.type,
          severity: rf.severity,
          title: title.substring(0, 200),
          description,
          metadata: { category: rf.type },
        });
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

      console.log("Audit saved to database");

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
    console.error("Error running audit:", err);
    res.status(500).json({ error: "Failed to run audit" });
  }
});

export default router;
