import { Router, type IRouter } from "express";
import {
  db,
  claims,
  audits,
  auditFindings,
  auditRuns,
  claimActivity,
  evidenceAnchors,
  usersTable,
} from "@workspace/db";
import { and, eq, sql, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import logger from "../lib/logger";

const router: IRouter = Router();

const numericClaimAmount = sql<number | null>`case
  when nullif(
    regexp_replace(${claims.totalClaimAmount}, '[^0-9.-]', '', 'g'),
    ''
  ) ~ '^-?[0-9]+([.][0-9]+)?$'
  then nullif(
    regexp_replace(${claims.totalClaimAmount}, '[^0-9.-]', '', 'g'),
    ''
  )::numeric
  else null
end`;

function formatClaimAmount(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/[^0-9.-]/g, "");
  if (!/^-?[0-9]+([.][0-9]+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount.toFixed(2) : null;
}

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

    const [operationsRow] = await db
      .select({
        backlogCount: sql<number>`count(*) filter (
          where ${claims.systemStatus} in ('uploaded', 'processing', 'error')
             or ${claims.humanReviewStatus} in ('unassigned', 'pending', 'in_review', 'changes_requested')
        )::int`,
        dollarsAtRisk: sql<string>`coalesce(round(sum(${numericClaimAmount}) filter (
          where ${audits.riskLevel} = 'HIGH'
             or ${audits.approvalStatus} in ('REVIEW', 'NOT_READY')
        ), 2), 0)::text`,
        averageAgeDays: sql<number>`coalesce(round(avg(
          extract(epoch from (now() - ${claims.createdAt})) / 86400
        ) filter (
          where ${claims.humanReviewStatus} <> 'approved'
             or ${claims.systemStatus} <> 'ready'
        )), 0)::int`,
        completedLast7Days: sql<number>`count(*) filter (
          where ${audits.createdAt} >= now() - interval '7 days'
        )::int`,
      })
      .from(claims)
      .leftJoin(audits, eq(claims.currentAuditId, audits.id))
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
        openCount: sql<number>`count(*) filter (
          where ${auditFindings.disposition} = 'open'
        )::int`,
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
        totalClaimAmount: claims.totalClaimAmount,
        assigneeUserId: claims.assigneeUserId,
        systemStatus: claims.systemStatus,
        aiStatus: claims.aiStatus,
        humanReviewStatus: claims.humanReviewStatus,
        overallScore: audits.overallScore,
        riskLevel: audits.riskLevel,
        approvalStatus: audits.approvalStatus,
      })
      .from(claims)
      .leftJoin(audits, eq(claims.currentAuditId, audits.id))
      .where(eq(claims.organizationId, req.organization!.organizationId))
      .orderBy(desc(claims.createdAt))
      .limit(12);

    const activityRows = await db
      .select({
        id: claimActivity.id,
        type: claimActivity.activityType,
        metadata: claimActivity.metadata,
        createdAt: claimActivity.createdAt,
        claimId: claims.id,
        claimNumber: claims.claimNumber,
      })
      .from(claimActivity)
      .innerJoin(
        claims,
        and(
          eq(claims.id, claimActivity.claimId),
          eq(claims.organizationId, req.organization!.organizationId),
        ),
      )
      .where(
        eq(claimActivity.organizationId, req.organization!.organizationId),
      )
      .orderBy(desc(claimActivity.createdAt))
      .limit(12);

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
    let openFindingCount = 0;
    for (const f of findingRows) {
      findingSeverity[f.severity || "unknown"] = f.count;
      openFindingCount += f.openCount;
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
      totalClaimAmount: formatClaimAmount(c.totalClaimAmount),
      assigneeUserId: c.assigneeUserId ?? null,
      systemStatus: c.systemStatus,
      aiStatus: c.aiStatus,
      humanReviewStatus: c.humanReviewStatus,
    }));

    res.json({
      stats: {
        totalClaims: statsRow.totalClaims,
        analyzedCount: statsRow.analyzedCount,
        pendingCount: statsRow.pendingCount,
        avgScore: scoreRow.avgScore ?? null,
        backlogCount: operationsRow.backlogCount,
        dollarsAtRisk: operationsRow.dollarsAtRisk,
        averageAgeDays: operationsRow.averageAgeDays,
        completedLast7Days: operationsRow.completedLast7Days,
        openFindingCount,
      },
      riskDistribution,
      approvalDistribution,
      carriers,
      findingSeverity,
      recentClaims,
      recentActivity: activityRows.map((activity) => ({
        id: activity.id,
        type: activity.type,
        claimId: activity.claimId,
        claimNumber: activity.claimNumber,
        metadata: activity.metadata,
        createdAt: activity.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ err }, "Dashboard data error");
    res.status(500).json({ error: "Failed to load dashboard data" });
  }
});

router.get(
  "/insights",
  requireAuth,
  requireOrganizationPermission("claims:read"),
  async (req, res) => {
    const organizationId = req.organization!.organizationId;
    try {
      const carrierPerformance = await db
        .select({
          name: sql<string>`coalesce(${claims.carrier}, 'Unknown')`,
          claimCount: sql<number>`count(*)::int`,
          averageScore: sql<number | null>`round(avg(${audits.overallScore}::numeric))::int`,
          dollarsAtRisk: sql<string>`coalesce(round(sum(${numericClaimAmount}) filter (
            where ${audits.riskLevel} = 'HIGH'
               or ${audits.approvalStatus} in ('REVIEW', 'NOT_READY')
          ), 2), 0)::text`,
        })
        .from(claims)
        .leftJoin(audits, eq(claims.currentAuditId, audits.id))
        .where(eq(claims.organizationId, organizationId))
        .groupBy(sql`coalesce(${claims.carrier}, 'Unknown')`)
        .orderBy(desc(sql`count(*)`));

      const reviewerPerformance = await db
        .select({
          userId: claims.assigneeUserId,
          label: sql<string>`coalesce(
            nullif(trim(concat_ws(' ', ${usersTable.firstName}, ${usersTable.lastName})), ''),
            'Unassigned'
          )`,
          assignedCount: sql<number>`count(*)::int`,
          approvedCount: sql<number>`count(*) filter (
            where ${claims.humanReviewStatus} = 'approved'
          )::int`,
          changesRequestedCount: sql<number>`count(*) filter (
            where ${claims.humanReviewStatus} = 'changes_requested'
          )::int`,
          averageScore: sql<number | null>`round(avg(${audits.overallScore}::numeric))::int`,
        })
        .from(claims)
        .leftJoin(usersTable, eq(usersTable.id, claims.assigneeUserId))
        .leftJoin(audits, eq(claims.currentAuditId, audits.id))
        .where(eq(claims.organizationId, organizationId))
        .groupBy(
          claims.assigneeUserId,
          usersTable.firstName,
          usersTable.lastName,
        )
        .orderBy(desc(sql`count(*)`));

      const scoreDistribution = await db
        .select({
          bucket: sql<string>`case
            when ${audits.overallScore} >= 90 then '90–100'
            when ${audits.overallScore} >= 75 then '75–89'
            when ${audits.overallScore} >= 60 then '60–74'
            else 'Below 60'
          end`,
          count: sql<number>`count(*)::int`,
        })
        .from(claims)
        .innerJoin(audits, eq(claims.currentAuditId, audits.id))
        .where(eq(claims.organizationId, organizationId))
        .groupBy(sql`case
          when ${audits.overallScore} >= 90 then '90–100'
          when ${audits.overallScore} >= 75 then '75–89'
          when ${audits.overallScore} >= 60 then '60–74'
          else 'Below 60'
        end`);

      const rootCauses = await db
        .select({
          label: sql<string>`coalesce(
            nullif(${auditFindings.metadata}->>'root_issue', ''),
            nullif(${auditFindings.metadata}->>'category_key', ''),
            ${auditFindings.title}
          )`,
          severity: auditFindings.severity,
          count: sql<number>`count(*)::int`,
        })
        .from(auditFindings)
        .innerJoin(audits, eq(audits.id, auditFindings.auditId))
        .innerJoin(
          claims,
          and(
            eq(claims.currentAuditId, audits.id),
            eq(claims.organizationId, organizationId),
          ),
        )
        .where(
          and(
            eq(auditFindings.organizationId, organizationId),
            sql`${auditFindings.severity} not in ('pass', 'na', 'info')`,
          ),
        )
        .groupBy(
          sql`coalesce(
            nullif(${auditFindings.metadata}->>'root_issue', ''),
            nullif(${auditFindings.metadata}->>'category_key', ''),
            ${auditFindings.title}
          )`,
          auditFindings.severity,
        )
        .orderBy(desc(sql`count(*)`))
        .limit(12);

      const [reviewAgreement] = await db
        .select({
          reviewedCount: sql<number>`count(*) filter (
            where ${auditFindings.disposition} <> 'open'
          )::int`,
          acceptedCount: sql<number>`count(*) filter (
            where ${auditFindings.disposition} in ('accepted', 'remediated')
          )::int`,
          overriddenCount: sql<number>`count(*) filter (
            where ${auditFindings.disposition} = 'overridden'
          )::int`,
        })
        .from(auditFindings)
        .innerJoin(audits, eq(audits.id, auditFindings.auditId))
        .innerJoin(
          claims,
          and(
            eq(claims.currentAuditId, audits.id),
            eq(claims.organizationId, organizationId),
          ),
        )
        .where(eq(auditFindings.organizationId, organizationId));

      const [processingQuality] = await db
        .select({
          runCount: sql<number>`count(*)::int`,
          succeededCount: sql<number>`count(*) filter (
            where ${auditRuns.status} = 'succeeded'
          )::int`,
          degradedCount: sql<number>`count(*) filter (
            where ${auditRuns.status} = 'degraded'
          )::int`,
          failedCount: sql<number>`count(*) filter (
            where ${auditRuns.status} = 'failed'
          )::int`,
          averageLatencySeconds: sql<number | null>`round(avg(
            extract(epoch from (${auditRuns.completedAt} - ${auditRuns.startedAt}))
          ))::int`,
        })
        .from(auditRuns)
        .where(eq(auditRuns.organizationId, organizationId));

      const [citationQuality] = await db
        .select({
          anchorCount: sql<number>`count(*)::int`,
          mappedCount: sql<number>`count(*) filter (
            where ${evidenceAnchors.isMapped} = true
          )::int`,
        })
        .from(evidenceAnchors)
        .innerJoin(auditFindings, eq(auditFindings.id, evidenceAnchors.findingId))
        .innerJoin(audits, eq(audits.id, auditFindings.auditId))
        .innerJoin(
          claims,
          and(
            eq(claims.currentAuditId, audits.id),
            eq(claims.organizationId, organizationId),
          ),
        )
        .where(eq(evidenceAnchors.organizationId, organizationId));

      const workflowDistribution = await db
        .select({
          status: claims.humanReviewStatus,
          count: sql<number>`count(*)::int`,
          averageAgeDays: sql<number>`coalesce(round(avg(
            extract(epoch from (now() - ${claims.createdAt})) / 86400
          )), 0)::int`,
        })
        .from(claims)
        .where(eq(claims.organizationId, organizationId))
        .groupBy(claims.humanReviewStatus);

      const reviewedCount = reviewAgreement.reviewedCount;
      const runCount = processingQuality.runCount;
      const anchorCount = citationQuality.anchorCount;
      res.json({
        summary: {
          reviewAgreementRate: reviewedCount
            ? Math.round((reviewAgreement.acceptedCount / reviewedCount) * 1000) / 10
            : null,
          overrideRate: reviewedCount
            ? Math.round((reviewAgreement.overriddenCount / reviewedCount) * 1000) / 10
            : null,
          processingSuccessRate: runCount
            ? Math.round((processingQuality.succeededCount / runCount) * 1000) / 10
            : null,
          citationMappingRate: anchorCount
            ? Math.round((citationQuality.mappedCount / anchorCount) * 1000) / 10
            : null,
          averageLatencySeconds: processingQuality.averageLatencySeconds,
          runCount,
          degradedCount: processingQuality.degradedCount,
          failedCount: processingQuality.failedCount,
        },
        carrierPerformance,
        reviewerPerformance,
        scoreDistribution,
        rootCauses,
        workflowDistribution,
      });
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Insights data error",
      );
      res.status(500).json({ error: "Failed to load insights data" });
    }
  },
);

export default router;
