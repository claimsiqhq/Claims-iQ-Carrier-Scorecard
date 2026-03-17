import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { claims, documents, audits, auditSections, auditFindings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ListClaimsResponse, GetClaimDetailResponse } from "@workspace/api-zod";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router: IRouter = Router();

router.post("/claims", async (req, res) => {
  try {
    const { claimNumber, insuredName, carrier, dateOfLoss } = req.body;
    if (!claimNumber || !insuredName) {
      res.status(400).json({ error: "claimNumber and insuredName are required" });
      return;
    }

    const [newClaim] = await db.insert(claims).values({
      claimNumber,
      insuredName,
      carrier: carrier || null,
      dateOfLoss: dateOfLoss || null,
      status: "pending",
    }).returning();

    res.status(201).json({
      id: newClaim.id,
      claimNumber: newClaim.claimNumber ?? "",
      insuredName: newClaim.insuredName ?? "",
      carrier: newClaim.carrier ?? undefined,
      dateOfLoss: newClaim.dateOfLoss ?? undefined,
      status: newClaim.status ?? "pending",
      createdAt: newClaim.createdAt?.toISOString() ?? undefined,
    });
  } catch (err) {
    console.error("Error creating claim:", err);
    res.status(500).json({ error: "Failed to create claim" });
  }
});

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

    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid claim ID format" });
      return;
    }

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
        technicalScore: audit.technicalScore ? Number(audit.technicalScore) : 0,
        presentationScore: audit.presentationScore ? Number(audit.presentationScore) : 0,
        riskLevel: audit.riskLevel ?? "",
        approvalStatus: audit.approvalStatus ?? "",
        executiveSummary: audit.executiveSummary ?? "",
        sections: sections.map((s) => ({
          id: s.id,
          auditId: s.auditId ?? "",
          section: s.section ?? "",
          score: s.score ? Number(s.score) : 0,
        })),
        findings: findings.map((f) => {
          const meta = f.metadata as Record<string, unknown> | null;
          return {
            id: f.id,
            auditId: f.auditId ?? "",
            type: f.type ?? "",
            severity: f.severity ?? "",
            title: f.title ?? "",
            description: f.description ?? "",
            category: (meta?.category as string) ?? f.type ?? "",
          };
        }),
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
        extractedText: d.extractedText ?? undefined,
        metadata: d.metadata ?? undefined,
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
