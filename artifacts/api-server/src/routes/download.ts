import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { claims, audits, auditFindings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import logger from "../lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

function escCsv(val: string | null | undefined): string {
  if (val == null || val === "") return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const router: IRouter = Router();

router.get("/claims/:id/download", requireAuth, async (req, res) => {
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
    if (!audit) {
      res.status(404).json({ error: "No audit report found for this claim" });
      return;
    }

    const findings = await db
      .select()
      .from(auditFindings)
      .where(eq(auditFindings.auditId, audit.id));

    const raw = audit.rawResponse as Record<string, unknown> | null;
    const overallAudit = raw?.overall_audit as Record<string, unknown> | undefined;
    const daCard = raw?.desk_adjuster_scorecard as Record<string, unknown> | undefined;
    const faCard = raw?.field_adjuster_scorecard as Record<string, unknown> | undefined;

    const isNewFormat = !!overallAudit;
    const overallScore = isNewFormat
      ? Number(overallAudit?.overall_score_percent ?? 0)
      : (audit.overallScore ? Number(audit.overallScore) : 0);
    const daPercent = isNewFormat ? Number(daCard?.score_percent ?? 0) : (audit.technicalScore ? Number(audit.technicalScore) : 0);
    const faPercent = isNewFormat ? Number(faCard?.score_percent ?? 0) : (audit.presentationScore ? Number(audit.presentationScore) : 0);
    const readiness = isNewFormat
      ? String(overallAudit?.readiness ?? audit.approvalStatus ?? "")
      : (audit.approvalStatus ?? "");
    const technicalRisk = isNewFormat
      ? String(overallAudit?.technical_risk ?? audit.riskLevel ?? "")
      : (audit.riskLevel ?? "");

    const lines: string[] = [];

    lines.push("CLAIMS iQ AUDIT REPORT");
    lines.push("");
    lines.push("CLAIM INFORMATION");
    lines.push(`Claim Number,${escCsv(claim.claimNumber)}`);
    lines.push(`Insured Name,${escCsv(claim.insuredName)}`);
    lines.push(`Carrier,${escCsv(claim.carrier)}`);
    lines.push(`Date of Loss,${escCsv(claim.dateOfLoss)}`);
    lines.push(`Loss Type,${escCsv(claim.lossType)}`);
    lines.push(`Policy Number,${escCsv(claim.policyNumber)}`);
    lines.push(`Property Address,${escCsv(claim.propertyAddress)}`);
    lines.push(`Adjuster,${escCsv(claim.adjuster)}`);
    lines.push("");

    lines.push("AUDIT SCORES");
    lines.push(`Overall Score,${overallScore}%`);
    lines.push(`Desk Adjuster Score,${daPercent}%`);
    lines.push(`Field Adjuster Score,${faPercent}%`);
    lines.push(`Readiness,${escCsv(readiness)}`);
    lines.push(`Risk Level,${escCsv(technicalRisk)}`);
    lines.push("");

    if (audit.executiveSummary) {
      lines.push("EXECUTIVE SUMMARY");
      lines.push(escCsv(audit.executiveSummary));
      lines.push("");
    }

    const daCats = isNewFormat && Array.isArray(daCard?.categories) ? (daCard!.categories as any[]) : [];
    if (daCats.length > 0) {
      lines.push("DESK ADJUSTER SCORECARD");
      lines.push("Category,Points Awarded,Points Possible,Question,Answer,Issue,Impact,Fix");
      for (const cat of daCats) {
        const questions = Array.isArray(cat.questions) ? cat.questions : [];
        for (const q of questions) {
          lines.push([
            escCsv(cat.category_name),
            q.points_awarded ?? "",
            q.points_possible ?? "",
            escCsv(q.id),
            escCsv(q.answer),
            escCsv(q.issue),
            escCsv(q.impact),
            escCsv(q.fix),
          ].join(","));
        }
      }
      lines.push("");
    }

    const faCats = isNewFormat && Array.isArray(faCard?.categories) ? (faCard!.categories as any[]) : [];
    if (faCats.length > 0) {
      lines.push("FIELD ADJUSTER SCORECARD");
      lines.push("Category,Points Awarded,Points Possible,Question,Answer,Issue,Impact,Fix");
      for (const cat of faCats) {
        const questions = Array.isArray(cat.questions) ? cat.questions : [];
        for (const q of questions) {
          lines.push([
            escCsv(cat.category_name),
            q.points_awarded ?? "",
            q.points_possible ?? "",
            escCsv(q.id),
            escCsv(q.answer),
            escCsv(q.issue),
            escCsv(q.impact),
            escCsv(q.fix),
          ].join(","));
        }
      }
      lines.push("");
    }

    if (findings.length > 0) {
      lines.push("FINDINGS");
      lines.push("Severity,Title,Description,Impact,Fix");
      for (const f of findings) {
        const meta = f.metadata as Record<string, unknown> | null;
        lines.push([
          escCsv(f.severity),
          escCsv(f.title),
          escCsv(f.description),
          escCsv(meta?.impact as string),
          escCsv(meta?.fix as string),
        ].join(","));
      }
    }

    const csvContent = lines.join("\r\n");
    const filename = `${claim.claimNumber || "claim"}_audit_report.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    logger.error({ err }, "Error generating audit download");
    res.status(500).json({ error: "Failed to generate report download" });
  }
});

export default router;
