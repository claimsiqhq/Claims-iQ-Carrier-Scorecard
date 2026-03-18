import { Router, type IRouter } from "express";
import { db, pool } from "@workspace/db";
import { claims, documents, audits, auditSections, auditFindings, auditStructured, auditVersions } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { ListClaimsResponse, GetClaimDetailResponse } from "@workspace/api-zod";
import { deleteFile } from "../lib/supabaseStorage";
import { requireAuth } from "../middlewares/requireAuth";
import logger from "../lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapClaim(c: any) {
  return {
    id: c.id,
    claimNumber: c.claimNumber ?? "",
    insuredName: c.insuredName ?? "",
    carrier: c.carrier ?? undefined,
    dateOfLoss: c.dateOfLoss ?? undefined,
    status: c.status ?? "pending",
    policyNumber: c.policyNumber ?? undefined,
    lossType: c.lossType ?? undefined,
    propertyAddress: c.propertyAddress ?? undefined,
    adjuster: c.adjuster ?? undefined,
    totalClaimAmount: c.totalClaimAmount ?? undefined,
    deductible: c.deductible ?? undefined,
    summary: c.summary ?? undefined,
    createdAt: c.createdAt?.toISOString() ?? undefined,
  };
}

const router: IRouter = Router();

router.post("/claims", requireAuth, async (req, res) => {
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

    res.status(201).json(mapClaim(newClaim));
  } catch (err) {
    logger.error({ err }, "Error creating claim");
    res.status(500).json({ error: "Failed to create claim" });
  }
});

router.get("/claims", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const allClaims = await db.select().from(claims).limit(limit).offset(offset).orderBy(sql`${claims.createdAt} DESC NULLS LAST`);
    const mapped = allClaims.map(mapClaim);
    const data = ListClaimsResponse.parse(mapped);
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Error listing claims");
    res.status(500).json({ error: "Failed to list claims" });
  }
});

router.get("/claims/:id", requireAuth, async (req, res) => {
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
      const [sectionRows, findingRows] = await Promise.all([
        db.select().from(auditSections).where(eq(auditSections.auditId, audit.id)),
        db.select().from(auditFindings).where(eq(auditFindings.auditId, audit.id)),
      ]);

      auditResult = {
        id: audit.id,
        claimId: audit.claimId ?? "",
        overallScore: audit.overallScore ? Number(audit.overallScore) : 0,
        technicalScore: audit.technicalScore ? Number(audit.technicalScore) : 0,
        presentationScore: audit.presentationScore ? Number(audit.presentationScore) : 0,
        riskLevel: audit.riskLevel ?? "",
        approvalStatus: audit.approvalStatus ?? "",
        executiveSummary: audit.executiveSummary ?? "",
        sections: sectionRows.map((s) => ({
          id: s.id,
          auditId: s.auditId ?? "",
          section: s.section ?? "",
          score: s.score ? Number(s.score) : 0,
        })),
        findings: findingRows.map((f) => {
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
      claim: mapClaim(claim),
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
    logger.error({ err }, "Error getting claim detail");
    res.status(500).json({ error: "Failed to get claim" });
  }
});

router.delete("/claims/:id", requireAuth, async (req, res) => {
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

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const txDb = drizzle(client, { schema });

      const existingDocs = await txDb.select().from(documents).where(eq(documents.claimId, id));
      await txDb.delete(claims).where(eq(claims.id, id));

      await client.query("COMMIT");

      for (const doc of existingDocs) {
        if (doc.fileUrl) {
          deleteFile(doc.fileUrl).catch((e) => logger.error({ err: e }, "Storage cleanup error"));
        }
      }

      logger.info({ claimId: id }, "Claim deleted");
      res.json({ success: true, message: "Claim deleted" });
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, "Error deleting claim");
    res.status(500).json({ error: "Failed to delete claim" });
  }
});

export default router;
