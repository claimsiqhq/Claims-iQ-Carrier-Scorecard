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
import { downloadFile } from "../lib/supabaseStorage";
import { requireAuth } from "../middlewares/requireAuth";
import logger from "../lib/logger";
import { randomUUID } from "crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    let pdfBuffer: Buffer | undefined;
    const pdfDoc = docs.find((d) => d.fileUrl && (d.type === "claim_file" || d.fileUrl?.endsWith(".pdf")));
    if (pdfDoc?.fileUrl) {
      try {
        pdfBuffer = await downloadFile(pdfDoc.fileUrl);
        logger.info({ claimId: id, storagePath: pdfDoc.fileUrl, bytes: pdfBuffer.length }, "Downloaded PDF for vision analysis");
      } catch (dlErr) {
        logger.warn({ err: dlErr, claimId: id }, "Could not download PDF for vision analysis — proceeding without it");
      }
    }

    const requestId = randomUUID();
    let auditResult: AuditResponse;
    try {
      auditResult = await runFinalAudit(reportText, {
        claim_number: claim.claimNumber ?? "",
        insured_name: claim.insuredName ?? "",
        carrier_name: claim.carrier ?? "",
      }, {
        pdfBuffer,
        requestId,
      });
    } catch (err) {
      logger.error({ err }, "OpenAI audit call failed");
      const { getFallbackAudit } = await import("../services/audit");
      auditResult = getFallbackAudit();
    }

    const oa = auditResult.overall_audit;
    const da = auditResult.desk_adjuster_scorecard;
    const fa = auditResult.field_adjuster_scorecard;

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
          overallScore: String(oa.overall_score_percent),
          technicalScore: String(da.points_awarded),
          presentationScore: String(fa.points_awarded),
          riskLevel: oa.technical_risk,
          approvalStatus: oa.readiness,
          executiveSummary: oa.executive_summary,
          rawResponse: auditResult as unknown as Record<string, unknown>,
          visionAnalysis: auditResult.vision_analysis as unknown as Record<string, unknown> ?? null,
        })
        .returning();

      const sectionValues = [
        ...da.categories.map((c) => ({
          auditId: newAudit.id,
          section: `da_${c.category_key}`,
          score: String(c.points_awarded),
          reasoning: c.questions
            .filter((q) => q.issue)
            .map((q) => `${q.answer}: ${q.issue}${q.fix ? ` → ${q.fix}` : ""}`)
            .join("\n") || null,
        })),
        ...fa.categories.map((c) => ({
          auditId: newAudit.id,
          section: `fa_${c.category_key}`,
          score: String(c.points_awarded),
          reasoning: c.questions
            .filter((q) => q.issue)
            .map((q) => `${q.answer}: ${q.issue}${q.fix ? ` → ${q.fix}` : ""}`)
            .join("\n") || null,
        })),
      ];

      if (sectionValues.length > 0) {
        await txDb.insert(auditSections).values(sectionValues);
      }

      const allQuestions = [
        ...da.categories.flatMap((c) => c.questions.map((q) => ({ ...q, scorecard: "DA" as const, categoryKey: c.category_key }))),
        ...fa.categories.flatMap((c) => c.questions.map((q) => ({ ...q, scorecard: "FA" as const, categoryKey: c.category_key }))),
      ];

      const questionFindings = allQuestions.map((q) => ({
        auditId: newAudit.id,
        type: "question_result",
        severity: q.answer === "PASS" ? "pass" : q.answer === "PARTIAL" ? "partial" : q.answer === "NOT_APPLICABLE" ? "na" : "fail",
        title: q.id,
        description: q.issue || "",
        metadata: {
          category: "question_result",
          scorecard: q.scorecard,
          category_key: q.categoryKey,
          answer: q.answer,
          points_awarded: q.points_awarded,
          points_possible: q.points_possible,
          issue: q.issue,
          impact: q.impact,
          fix: q.fix,
          evidence_locations: q.evidence_locations,
          confidence: q.confidence,
        } as Record<string, unknown>,
      }));

      const issueFindings = auditResult.issues.map((iss) => ({
        auditId: newAudit.id,
        type: "issue",
        severity: iss.severity,
        title: `[${iss.source_scorecard}] ${iss.question_key}`,
        description: iss.issue,
        metadata: {
          category: "issue",
          source_scorecard: iss.source_scorecard,
          category_key: iss.category_key,
          question_key: iss.question_key,
          impact: iss.impact,
          fix: iss.fix,
          evidence_locations: iss.evidence_locations,
        } as Record<string, unknown>,
      }));

      const validationFindings = auditResult.validation_checks.map((v) => ({
        auditId: newAudit.id,
        type: "validation",
        severity: v.severity,
        title: v.key,
        description: v.message,
        metadata: {
          category: "validation",
          key: v.key,
          severity: v.severity,
        } as Record<string, unknown>,
      }));

      const visionFindings: typeof questionFindings = [];
      if (auditResult.vision_analysis) {
        const va = auditResult.vision_analysis;
        for (const tr of va.tool_readings) {
          visionFindings.push({
            auditId: newAudit.id,
            type: "vision_tool_reading",
            severity: "info",
            title: `${tr.tool_type}: ${tr.reading_value} ${tr.reading_unit}`,
            description: `${tr.tool_model} reading at ${tr.material_or_location} (page ${tr.page_number})`,
            metadata: {
              category: "vision_analysis",
              ...tr,
            } as Record<string, unknown>,
          });
        }
        for (const dv of va.damage_verifications) {
          visionFindings.push({
            auditId: newAudit.id,
            type: "vision_damage_verification",
            severity: dv.damage_visible ? "pass" : "warning",
            title: `Damage check: ${dv.caption_claim}`,
            description: dv.damage_visible
              ? `Confirmed: ${dv.damage_type} visible (page ${dv.page_number})`
              : `Discrepancy: ${dv.discrepancy || "damage not apparent"} (page ${dv.page_number})`,
            metadata: {
              category: "vision_analysis",
              ...dv,
            } as Record<string, unknown>,
          });
        }
        if (va.sequence_issues.length > 0) {
          for (const issue of va.sequence_issues) {
            visionFindings.push({
              auditId: newAudit.id,
              type: "vision_sequence",
              severity: "warning",
              title: "Photo sequence issue",
              description: issue,
              metadata: {
                category: "vision_analysis",
                photo_sequence_valid: false,
              } as Record<string, unknown>,
            });
          }
        }
      }

      const allFindings = [...questionFindings, ...issueFindings, ...validationFindings, ...visionFindings];

      if (allFindings.length > 0) {
        await txDb.insert(auditFindings).values(allFindings);
      }

      await txDb.insert(auditStructured).values({
        auditId: newAudit.id,
        deferredItems: [],
        invoiceAdjustments: [],
        scopeDeviations: [],
        unknowns: [],
        carrierQuestions: [],
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

      logger.info({ claimId: id, auditId: newAudit.id }, "DA/FA audit saved");

      res.json({
        success: true,
        auditId: newAudit.id,
        overallScore: oa.overall_score_percent,
        daScore: da.score_percent,
        faScore: fa.score_percent,
        readiness: oa.readiness,
        technicalRisk: oa.technical_risk,
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
