import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { claims, documents, audits, auditSections, auditFindings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ListClaimsResponse, GetClaimDetailResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/claims", async (_req, res) => {
  try {
    const allClaims = await db.select().from(claims);
    const mapped = allClaims.map((c) => ({
      id: c.id,
      claimNumber: c.claimNumber ?? "",
      insuredName: c.insuredName ?? "",
      carrier: c.carrier ?? undefined,
      dateOfLoss: c.dateOfLoss ?? undefined,
      status: c.status ?? "pending",
      createdAt: c.createdAt?.toISOString() ?? undefined,
    }));
    const data = ListClaimsResponse.parse(mapped);
    res.json(data);
  } catch (err) {
    console.error("Error listing claims:", err);
    res.status(500).json({ error: "Failed to list claims" });
  }
});

router.get("/claims/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [claim] = await db.select().from(claims).where(eq(claims.id, id));
    if (!claim) {
      res.status(404).json({ error: "Claim not found" });
      return;
    }

    const docs = await db.select().from(documents).where(eq(documents.claimId, id));

    const [audit] = await db.select().from(audits).where(eq(audits.claimId, id));

    let auditResult = undefined;
    if (audit) {
      const sections = await db.select().from(auditSections).where(eq(auditSections.auditId, audit.id));
      const findings = await db.select().from(auditFindings).where(eq(auditFindings.auditId, audit.id));

      auditResult = {
        id: audit.id,
        claimId: audit.claimId ?? "",
        overallScore: audit.overallScore ? Number(audit.overallScore) : 0,
        riskLevel: audit.riskLevel ?? "",
        approvalStatus: audit.approvalStatus ?? "",
        executiveSummary: audit.executiveSummary ?? "",
        sections: sections.map((s) => ({
          id: s.id,
          auditId: s.auditId ?? "",
          section: s.section ?? "",
          score: s.score ? Number(s.score) : 0,
        })),
        findings: findings.map((f) => ({
          id: f.id,
          auditId: f.auditId ?? "",
          type: f.type ?? "",
          severity: f.severity ?? "",
          title: f.title ?? "",
          description: f.description ?? "",
          category: f.type ?? "",
        })),
      };
    }

    const result = {
      claim: {
        id: claim.id,
        claimNumber: claim.claimNumber ?? "",
        insuredName: claim.insuredName ?? "",
        carrier: claim.carrier ?? undefined,
        dateOfLoss: claim.dateOfLoss ?? undefined,
        status: claim.status ?? "pending",
        createdAt: claim.createdAt?.toISOString() ?? undefined,
      },
      documents: docs.map((d) => ({
        id: d.id,
        claimId: d.claimId ?? "",
        type: d.type ?? "",
        fileUrl: d.fileUrl ?? undefined,
        createdAt: d.createdAt?.toISOString() ?? undefined,
      })),
      audit: auditResult,
    };

    const data = GetClaimDetailResponse.parse(result);
    res.json(data);
  } catch (err) {
    console.error("Error getting claim detail:", err);
    res.status(500).json({ error: "Failed to get claim" });
  }
});

export default router;
