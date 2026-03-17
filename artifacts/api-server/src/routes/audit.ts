import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  claims,
  documents,
  audits,
  auditSections,
  auditFindings,
  auditStructured,
  auditVersions,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuditResponse {
  overall_score: number;
  section_scores: {
    coverage_clarity: number;
    scope_completeness: number;
    estimate_accuracy: number;
    documentation_support: number;
    financial_accuracy: number;
    carrier_risk: number;
  };
  risk_level: string;
  approval_status: string;
  critical_failures: string[];
  key_defects: string[];
  carrier_questions: string[];
  deferred_items: string[];
  invoice_adjustments: string[];
  scope_deviations: string[];
  unknowns: string[];
  executive_summary: string;
}

const FALLBACK_AUDIT: AuditResponse = {
  overall_score: 0,
  section_scores: {
    coverage_clarity: 0,
    scope_completeness: 0,
    estimate_accuracy: 0,
    documentation_support: 0,
    financial_accuracy: 0,
    carrier_risk: 0,
  },
  risk_level: "HIGH",
  approval_status: "REQUIRES REVIEW",
  critical_failures: [],
  key_defects: [],
  carrier_questions: [],
  deferred_items: [],
  invoice_adjustments: [],
  scope_deviations: [],
  unknowns: [],
  executive_summary: "Audit failed to process. Please retry.",
};

async function runFinalAudit(reportText: string): Promise<AuditResponse> {
  console.log("Running audit...");

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content: `You are a senior insurance carrier audit reviewer.

You are reviewing a finalized claim submission.

You only have this document.

Be strict. If something is missing or unclear, treat it as a defect.

Return structured JSON only. Do not include any markdown formatting, code fences, or explanation — only raw JSON.`,
      },
      {
        role: "user",
        content: `Evaluate this finalized claim report using a carrier scorecard.

Score:
1. Coverage & Liability Clarity (20)
2. Scope Completeness (20)
3. Estimate Accuracy (20)
4. Documentation Support (15)
5. Financial Accuracy (10)
6. Carrier Risk (15)

Return JSON:

{
  "overall_score": number,
  "section_scores": {
    "coverage_clarity": number,
    "scope_completeness": number,
    "estimate_accuracy": number,
    "documentation_support": number,
    "financial_accuracy": number,
    "carrier_risk": number
  },
  "risk_level": "LOW | MEDIUM | HIGH",
  "approval_status": "APPROVE | APPROVE WITH MINOR CHANGES | REQUIRES REVIEW | REJECT",
  "critical_failures": [],
  "key_defects": [],
  "carrier_questions": [],
  "deferred_items": [],
  "invoice_adjustments": [],
  "scope_deviations": [],
  "unknowns": [],
  "executive_summary": ""
}

REPORT:
${reportText}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty AI response");
  }

  const cleaned = content.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned) as AuditResponse;
    console.log("Audit complete");
    return parsed;
  } catch (e) {
    console.error("JSON parse failed", content);
    throw new Error("Invalid AI response");
  }
}

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
      console.error("OpenAI audit failed, using fallback:", err);
      auditResult = FALLBACK_AUDIT;
    }

    const existingAudits = await db
      .select()
      .from(audits)
      .where(eq(audits.claimId, id));
    for (const existing of existingAudits) {
      await db.delete(auditStructured).where(eq(auditStructured.auditId, existing.id));
      await db.delete(auditFindings).where(eq(auditFindings.auditId, existing.id));
      await db.delete(auditSections).where(eq(auditSections.auditId, existing.id));
    }
    if (existingAudits.length > 0) {
      await db.delete(auditVersions).where(eq(auditVersions.claimId, id));
      await db.delete(audits).where(eq(audits.claimId, id));
    }

    const [newAudit] = await db
      .insert(audits)
      .values({
        claimId: id,
        overallScore: String(auditResult.overall_score),
        riskLevel: auditResult.risk_level,
        approvalStatus: auditResult.approval_status,
        executiveSummary: auditResult.executive_summary,
        rawResponse: auditResult as unknown as Record<string, unknown>,
      })
      .returning();

    const sectionMap: Record<string, number> = {
      coverage_clarity: auditResult.section_scores.coverage_clarity,
      scope_completeness: auditResult.section_scores.scope_completeness,
      estimate_accuracy: auditResult.section_scores.estimate_accuracy,
      documentation_support: auditResult.section_scores.documentation_support,
      financial_accuracy: auditResult.section_scores.financial_accuracy,
      carrier_risk: auditResult.section_scores.carrier_risk,
    };

    for (const [section, score] of Object.entries(sectionMap)) {
      await db.insert(auditSections).values({
        auditId: newAudit.id,
        section,
        score: String(score),
      });
    }

    const findingGroups: { type: string; severity: string; items: string[] }[] = [
      { type: "defect", severity: "critical", items: auditResult.critical_failures || [] },
      { type: "defect", severity: "warning", items: auditResult.key_defects || [] },
      { type: "carrier_question", severity: "info", items: auditResult.carrier_questions || [] },
      { type: "deferred", severity: "info", items: auditResult.deferred_items || [] },
    ];

    for (const group of findingGroups) {
      for (const item of group.items) {
        const title = typeof item === "string" ? item : (item as any)?.title ?? String(item);
        const description = typeof item === "string" ? item : (item as any)?.description ?? String(item);
        await db.insert(auditFindings).values({
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
      await db.insert(auditFindings).values({
        auditId: newAudit.id,
        type: rf.type,
        severity: rf.severity,
        title: title.substring(0, 200),
        description,
        metadata: { category: rf.type },
      });
    }

    await db.insert(auditStructured).values({
      auditId: newAudit.id,
      deferredItems: auditResult.deferred_items || [],
      invoiceAdjustments: auditResult.invoice_adjustments || [],
      scopeDeviations: auditResult.scope_deviations || [],
      unknowns: auditResult.unknowns || [],
      carrierQuestions: auditResult.carrier_questions || [],
    });

    await db
      .update(claims)
      .set({ status: "analyzed" })
      .where(eq(claims.id, id));

    await db.insert(auditVersions).values({
      claimId: id,
      auditId: newAudit.id,
      versionNumber: 1,
    });

    res.json({
      success: true,
      auditId: newAudit.id,
      overallScore: auditResult.overall_score,
      riskLevel: auditResult.risk_level,
      approvalStatus: auditResult.approval_status,
    });
  } catch (err) {
    console.error("Error running audit:", err);
    res.status(500).json({ error: "Failed to run audit" });
  }
});

export default router;
