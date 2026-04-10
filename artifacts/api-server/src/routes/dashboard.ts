import { Router, type IRouter } from "express";
import { db, claims, audits, auditFindings } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import logger from "../lib/logger";

const router: IRouter = Router();

router.get("/dashboard", requireAuth, async (_req, res) => {
  try {
    const [statsRow] = await db
      .select({
        totalClaims: sql<number>`count(*)::int`,
        analyzedCount: sql<number>`count(*) filter (where ${claims.status} = 'analyzed')::int`,
        pendingCount: sql<number>`count(*) filter (where ${claims.status} = 'pending')::int`,
      })
      .from(claims);

    const [scoreRow] = await db
      .select({
        avgScore: sql<number>`round(avg(${audits.overallScore}::numeric))::int`,
      })
      .from(audits);

    const riskRows = await db
      .select({
        riskLevel: audits.riskLevel,
        count: sql<number>`count(*)::int`,
      })
      .from(audits)
      .groupBy(audits.riskLevel);

    const approvalRows = await db
      .select({
        approvalStatus: audits.approvalStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(audits)
      .groupBy(audits.approvalStatus);

    const carrierRows = await db
      .select({
        carrier: sql<string>`coalesce(${claims.carrier}, 'Unknown')`,
        count: sql<number>`count(*)::int`,
        avgScore: sql<number>`round(avg(${audits.overallScore}::numeric))::int`,
      })
      .from(claims)
      .leftJoin(audits, eq(claims.id, audits.claimId))
      .groupBy(sql`coalesce(${claims.carrier}, 'Unknown')`);

    const findingRows = await db
      .select({
        severity: auditFindings.severity,
        count: sql<number>`count(*)::int`,
      })
      .from(auditFindings)
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
      .leftJoin(audits, eq(claims.id, audits.claimId))
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
