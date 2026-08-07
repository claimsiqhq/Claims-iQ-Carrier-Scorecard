import { Router, type IRouter } from "express";
import { db, claims, audits, auditFindings } from "@workspace/db";
import { and, eq, sql, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import logger from "../lib/logger";

const router: IRouter = Router();

router.get("/dashboard", requireAuth, requireOrganizationPermission("claims:read"), async (req, res) => {
  try {
    const [statsRow] = await db
      .select({
        totalClaims: sql<number>`count(*)::int`,
        analyzedCount: sql<number>`count(*) filter (where ${claims.status} = 'analyzed')::int`,
        pendingCount: sql<number>`count(*) filter (where ${claims.status} = 'pending')::int`,
      })
      .from(claims)
      .where(eq(claims.organizationId, req.organization!.organizationId));

    const [scoreRow] = await db
      .select({
        avgScore: sql<number>`round(avg(${audits.overallScore}::numeric))::int`,
      })
      .from(claims)
      .innerJoin(audits, eq(claims.currentAuditId, audits.id))
      .where(eq(claims.organizationId, req.organization!.organizationId));

    const riskRows = await db
      .select({
        riskLevel: audits.riskLevel,
        count: sql<number>`count(*)::int`,
      })
      .from(claims)
      .innerJoin(audits, eq(claims.currentAuditId, audits.id))
      .where(eq(claims.organizationId, req.organization!.organizationId))
      .groupBy(audits.riskLevel);

    const approvalRows = await db
      .select({
        approvalStatus: audits.approvalStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(claims)
      .innerJoin(audits, eq(claims.currentAuditId, audits.id))
      .where(eq(claims.organizationId, req.organization!.organizationId))
      .groupBy(audits.approvalStatus);

    const carrierRows = await db
      .select({
        carrier: sql<string>`coalesce(${claims.carrier}, 'Unknown')`,
        count: sql<number>`count(*)::int`,
        avgScore: sql<number>`round(avg(${audits.overallScore}::numeric))::int`,
      })
      .from(claims)
      .leftJoin(audits, eq(claims.currentAuditId, audits.id))
      .where(eq(claims.organizationId, req.organization!.organizationId))
      .groupBy(sql`coalesce(${claims.carrier}, 'Unknown')`);

    const findingRows = await db
      .select({
        severity: auditFindings.severity,
        count: sql<number>`count(*)::int`,
      })
      .from(auditFindings)
      .innerJoin(audits, eq(audits.id, auditFindings.auditId))
      .innerJoin(
        claims,
        and(
          eq(claims.currentAuditId, audits.id),
          eq(claims.organizationId, req.organization!.organizationId),
        ),
      )
      .where(
        eq(
          auditFindings.organizationId,
          req.organization!.organizationId,
        ),
      )
      .groupBy(auditFindings.severity);

    const recentRows = await db
      .select({
        id: claims.id,
        claimNumber: claims.claimNumber,
        insuredName: claims.insuredName,
        carrier: claims.carrier,
        dateOfLoss: claims.dateOfLoss,
        status: claims.status,
        lossType: claims.lossType,
        createdAt: claims.createdAt,
        overallScore: audits.overallScore,
        riskLevel: audits.riskLevel,
        approvalStatus: audits.approvalStatus,
      })
      .from(claims)
      .leftJoin(audits, eq(claims.currentAuditId, audits.id))
      .where(eq(claims.organizationId, req.organization!.organizationId))
      .orderBy(desc(claims.createdAt));

    const riskDistribution: Record<string, number> = {};
    for (const r of riskRows) {
      riskDistribution[r.riskLevel || "UNKNOWN"] = r.count;
    }

    const approvalDistribution: Record<string, number> = {};
    for (const r of approvalRows) {
      approvalDistribution[r.approvalStatus || "UNKNOWN"] = r.count;
    }

    const carriers = carrierRows.map((r) => ({
      name: r.carrier,
      count: r.count,
      avgScore: r.avgScore ?? null,
    }));

    const findingSeverity: Record<string, number> = {};
    for (const f of findingRows) {
      findingSeverity[f.severity || "unknown"] = f.count;
    }

    const recentClaims = recentRows.map((c) => ({
      id: c.id,
      claimNumber: c.claimNumber,
      insuredName: c.insuredName,
      carrier: c.carrier ?? null,
      status: c.status,
      dateOfLoss: c.dateOfLoss ?? null,
      lossType: c.lossType ?? null,
      createdAt: c.createdAt?.toISOString() ?? null,
      overallScore: c.overallScore ? Number(c.overallScore) : null,
      riskLevel: c.riskLevel ?? null,
      approvalStatus: c.approvalStatus ?? null,
    }));

    res.json({
      stats: {
        totalClaims: statsRow.totalClaims,
        analyzedCount: statsRow.analyzedCount,
        pendingCount: statsRow.pendingCount,
        avgScore: scoreRow.avgScore ?? null,
      },
      riskDistribution,
      approvalDistribution,
      carriers,
      findingSeverity,
      recentClaims,
    });
  } catch (err) {
    logger.error({ err }, "Dashboard data error");
    res.status(500).json({ error: "Failed to load dashboard data" });
  }
});

export default router;
