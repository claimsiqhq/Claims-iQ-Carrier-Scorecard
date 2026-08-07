import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  auditFindings,
  auditSections,
  audits,
  claimActivity,
  claims,
  documents,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { ListClaimsResponse, GetClaimDetailResponse } from "@workspace/api-zod";
import { getCurrentAuthorizedAudit } from "../lib/authorization";
import { requireAuth } from "../middlewares/requireAuth";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import logger from "../lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

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
    ownerUserId: c.ownerUserId ?? null,
    assigneeUserId: c.assigneeUserId ?? null,
    systemStatus: c.systemStatus ?? "uploaded",
    aiStatus: c.aiStatus ?? "not_started",
    humanReviewStatus: c.humanReviewStatus ?? "unassigned",
    createdAt: c.createdAt?.toISOString() ?? undefined,
  };
}

const router: IRouter = Router();

router.post(
  "/claims",
  requireAuth,
  requireOrganizationPermission("claims:create"),
  async (req, res) => {
  try {
    const { claimNumber, insuredName, carrier, dateOfLoss } = req.body;
    if (!claimNumber || !insuredName) {
      res.status(400).json({ error: "claimNumber and insuredName are required" });
      return;
    }

    const [newClaim] = await db.insert(claims).values({
      organizationId: req.organization!.organizationId,
      ownerUserId: req.user!.id,
      claimNumber,
      insuredName,
      carrier: carrier || null,
      dateOfLoss: dateOfLoss || null,
      status: "pending",
      systemStatus: "uploaded",
      aiStatus: "not_started",
    }).returning();

    await db.insert(claimActivity).values({
      organizationId: req.organization!.organizationId,
      claimId: newClaim.id,
      actorUserId: req.user!.id,
      activityType: "claim_created",
      metadata: {},
    });

    res.status(201).json(mapClaim(newClaim));
  } catch (err) {
    logger.error({ err }, "Error creating claim");
    res.status(500).json({ error: "Failed to create claim" });
  }
  },
);

router.get(
  "/claims",
  requireAuth,
  requireOrganizationPermission("claims:read"),
  async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const allClaims = await db
      .select({
        claim: claims,
        overallScore: audits.overallScore,
        riskLevel: audits.riskLevel,
        approvalStatus: audits.approvalStatus,
      })
      .from(claims)
      .leftJoin(audits, eq(claims.currentAuditId, audits.id))
      .where(eq(claims.organizationId, req.organization!.organizationId))
      .limit(limit)
      .offset(offset)
      .orderBy(sql`${claims.createdAt} DESC NULLS LAST`);
    const mapped = allClaims.map((row) => ({
      ...mapClaim(row.claim),
      overallScore:
        row.overallScore == null ? null : Number(row.overallScore),
      riskLevel: row.riskLevel,
      approvalStatus: row.approvalStatus,
    }));
    const data = ListClaimsResponse.parse(mapped);
    res.json(data.map((claim, index) => ({
      ...claim,
      ownerUserId: mapped[index]?.ownerUserId,
      assigneeUserId: mapped[index]?.assigneeUserId,
      systemStatus: mapped[index]?.systemStatus,
      aiStatus: mapped[index]?.aiStatus,
      humanReviewStatus: mapped[index]?.humanReviewStatus,
      overallScore: mapped[index]?.overallScore,
      riskLevel: mapped[index]?.riskLevel,
      approvalStatus: mapped[index]?.approvalStatus,
    })));
  } catch (err) {
    logger.error({ err }, "Error listing claims");
    res.status(500).json({ error: "Failed to list claims" });
  }
  },
);

router.get(
  "/claims/:id",
  requireAuth,
  requireOrganizationPermission("claims:read"),
  async (req, res) => {
  try {
    const id = firstParam(req.params.id);

    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid claim ID format" });
      return;
    }

    const [claim] = await db
      .select()
      .from(claims)
      .where(
        and(
          eq(claims.id, id),
          eq(claims.organizationId, req.organization!.organizationId),
        ),
      );
    if (!claim) {
      res.status(404).json({ error: "Claim not found" });
      return;
    }

    const docs = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.claimId, id),
          eq(documents.organizationId, req.organization!.organizationId),
        ),
      );

    const audit = claim.currentAuditId
      ? await getCurrentAuthorizedAudit(req.organization!.organizationId, id)
      : undefined;

    let auditResult = undefined;
    if (audit) {
      const [sectionRows, findingRows] = await Promise.all([
        db
          .select()
          .from(auditSections)
          .where(
            and(
              eq(auditSections.auditId, audit.id),
              eq(
                auditSections.organizationId,
                req.organization!.organizationId,
              ),
            ),
          ),
        db
          .select()
          .from(auditFindings)
          .where(
            and(
              eq(auditFindings.auditId, audit.id),
              eq(
                auditFindings.organizationId,
                req.organization!.organizationId,
              ),
            ),
          ),
      ]);

      const raw = audit.rawResponse as Record<string, unknown> | null;

      const overallAudit = raw?.overall_audit as Record<string, unknown> | undefined;
      const daCard = raw?.desk_adjuster_scorecard as Record<string, unknown> | undefined;
      const faCard = raw?.field_adjuster_scorecard as Record<string, unknown> | undefined;
      const rawIssues = Array.isArray(raw?.issues) ? raw.issues as any[] : [];
      const rawValidation = Array.isArray(raw?.validation_checks) ? raw.validation_checks as any[] : [];
      const rawRootIssueGroups = Array.isArray(raw?.root_issue_groups) ? raw.root_issue_groups as any[] : [];

      const isNewFormat = !!overallAudit;

      const overallScore = isNewFormat
        ? Number(overallAudit?.overall_score_percent ?? 0)
        : (audit.overallScore ? Number(audit.overallScore) : 0);
      const daPercent = isNewFormat ? Number(daCard?.score_percent ?? 0) : (audit.technicalScore ? Number(audit.technicalScore) : 0);
      const faPercent = isNewFormat ? Number(faCard?.score_percent ?? 0) : (audit.presentationScore ? Number(audit.presentationScore) : 0);
      const daAwarded = isNewFormat ? Number(daCard?.points_awarded ?? 0) : daPercent;
      const daPossible = isNewFormat ? Number(daCard?.points_possible ?? 100) : 100;
      const faAwarded = isNewFormat ? Number(faCard?.points_awarded ?? 0) : faPercent;
      const faPossible = isNewFormat ? Number(faCard?.points_possible ?? 100) : 100;
      const denialApplicable = isNewFormat ? Boolean(daCard?.denial_letter_applicable) : false;

      const readiness = isNewFormat
        ? String(overallAudit?.readiness ?? audit.approvalStatus ?? "")
        : (audit.approvalStatus ?? "");
      const technicalRisk = isNewFormat
        ? String(overallAudit?.technical_risk ?? audit.riskLevel ?? "")
        : (audit.riskLevel ?? "");
      const failedCount = isNewFormat ? Number(overallAudit?.failed_count ?? 0) : 0;
      const partialCount = isNewFormat ? Number(overallAudit?.partial_count ?? 0) : 0;
      const passedCount = isNewFormat ? Number(overallAudit?.passed_count ?? 0) : 0;
      const warningCount = isNewFormat ? Number(overallAudit?.warning_count ?? 0) : 0;
      const actionRequiredCount = isNewFormat ? Number(overallAudit?.action_required_count ?? 0) : 0;

      const daCats = isNewFormat && Array.isArray(daCard?.categories) ? (daCard.categories as any[]) : [];
      const faCats = isNewFormat && Array.isArray(faCard?.categories) ? (faCard.categories as any[]) : [];

      auditResult = {
        id: audit.id,
        claimId: audit.claimId ?? "",
        overallScore,
        daScore: daPercent,
        daPointsAwarded: daAwarded,
        daPointsPossible: daPossible,
        denialLetterApplicable: denialApplicable,
        faScore: faPercent,
        faPointsAwarded: faAwarded,
        faPointsPossible: faPossible,
        readiness,
        technicalRisk,
        failedCount,
        partialCount,
        passedCount,
        warningCount,
        actionRequiredCount,
        executiveSummary: audit.executiveSummary ?? "",
        technicalScore: daPercent,
        technicalMax: daPossible,
        presentationScore: faPercent,
        presentationMax: faPossible,
        totalMax: daPossible + faPossible,
        riskLevel: technicalRisk,
        approvalStatus: readiness,
        daCategories: daCats.map((c: any) => ({
          category_key: c.category_key ?? "",
          category_name: c.category_name ?? "",
          points_awarded: Number(c.points_awarded ?? 0),
          points_possible: Number(c.points_possible ?? 0),
          questions: Array.isArray(c.questions) ? c.questions.map((q: any) => ({
            id: q.id ?? "",
            answer: q.answer ?? "FAIL",
            points_awarded: Number(q.points_awarded ?? 0),
            points_possible: Number(q.points_possible ?? 0),
            root_issue: q.root_issue ?? "",
            issue: q.issue ?? "",
            impact: q.impact ?? "",
            fix: q.fix ?? "",
            evidence_locations: Array.isArray(q.evidence_locations) ? q.evidence_locations : [],
            confidence: Number(q.confidence ?? 0),
          })) : [],
        })),
        faCategories: faCats.map((c: any) => ({
          category_key: c.category_key ?? "",
          category_name: c.category_name ?? "",
          points_awarded: Number(c.points_awarded ?? 0),
          points_possible: Number(c.points_possible ?? 0),
          questions: Array.isArray(c.questions) ? c.questions.map((q: any) => ({
            id: q.id ?? "",
            answer: q.answer ?? "FAIL",
            points_awarded: Number(q.points_awarded ?? 0),
            points_possible: Number(q.points_possible ?? 0),
            root_issue: q.root_issue ?? "",
            issue: q.issue ?? "",
            impact: q.impact ?? "",
            fix: q.fix ?? "",
            evidence_locations: Array.isArray(q.evidence_locations) ? q.evidence_locations : [],
            confidence: Number(q.confidence ?? 0),
          })) : [],
        })),
        rootIssueGroups: rawRootIssueGroups.map((g: any) => ({
          root_issue: g.root_issue ?? "",
          affects: Array.isArray(g.affects) ? g.affects : [],
          issue: g.issue ?? "",
          fix: g.fix ?? "",
          impact: g.impact ?? "",
          evidence_locations: Array.isArray(g.evidence_locations) ? g.evidence_locations : [],
        })),
        issues: rawIssues.map((iss: any) => ({
          source_scorecard: iss.source_scorecard ?? "DA",
          category_key: iss.category_key ?? "",
          question_key: iss.question_key ?? "",
          root_issue: iss.root_issue ?? "",
          severity: iss.severity ?? "",
          issue: iss.issue ?? "",
          impact: iss.impact ?? "",
          fix: iss.fix ?? "",
          evidence_locations: Array.isArray(iss.evidence_locations) ? iss.evidence_locations : [],
        })),
        validationChecks: rawValidation.map((v: any) => ({
          key: v.key ?? "",
          severity: v.severity ?? "info",
          message: v.message ?? "",
        })),
        visionAnalysis: (audit.visionAnalysis as Record<string, unknown> | null) ?? (raw?.vision_analysis as Record<string, unknown> | null) ?? null,
        sections: sectionRows.map((s) => ({
          id: s.id,
          auditId: s.auditId ?? "",
          section: s.section ?? "",
          score: s.score ? Number(s.score) : 0,
          max: 0,
          reasoning: s.reasoning ?? "",
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
            answer: (meta?.answer as string) ?? undefined,
            issue: (meta?.issue as string) ?? undefined,
            impact: (meta?.impact as string) ?? undefined,
            fix: (meta?.fix as string) ?? undefined,
            evidence_locations: Array.isArray(meta?.evidence_locations) ? meta.evidence_locations as string[] : undefined,
            confidence: typeof meta?.confidence === "number" ? meta.confidence : undefined,
            scorecard: (meta?.scorecard as string) ?? undefined,
            category_key: (meta?.category_key as string) ?? undefined,
            points_awarded: typeof meta?.points_awarded === "number" ? meta.points_awarded : undefined,
            points_possible: typeof meta?.points_possible === "number" ? meta.points_possible : undefined,
            sourceDocumentId: f.sourceDocumentId ?? null,
            disposition: f.disposition,
            overrideReason: f.overrideReason ?? null,
            reviewNotes: f.reviewNotes ?? null,
            reviewedByUserId: f.reviewedByUserId ?? null,
            reviewedAt: f.reviewedAt?.toISOString() ?? null,
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
    const rawFindings =
      auditResult && "findings" in auditResult && Array.isArray(auditResult.findings)
        ? auditResult.findings
        : [];
    res.json({
      ...data,
      claim: {
        ...data.claim,
        ownerUserId: claim.ownerUserId,
        assigneeUserId: claim.assigneeUserId,
        systemStatus: claim.systemStatus,
        aiStatus: claim.aiStatus,
        humanReviewStatus: claim.humanReviewStatus,
      },
      audit: data.audit
        ? {
            ...data.audit,
            versionNumber: audit?.versionNumber,
            findings: data.audit.findings.map((finding, index) => ({
              ...finding,
              ...(rawFindings[index] ?? {}),
            })),
          }
        : undefined,
    });
  } catch (err) {
    logger.error({ err }, "Error getting claim detail");
    res.status(500).json({ error: "Failed to get claim" });
  }
  },
);

router.delete(
  "/claims/:id",
  requireAuth,
  requireOrganizationPermission("claims:delete"),
  async (req, res) => {
  try {
    const id = firstParam(req.params.id);

    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid claim ID format" });
      return;
    }

    const [claim] = await db
      .select()
      .from(claims)
      .where(
        and(
          eq(claims.id, id),
          eq(claims.organizationId, req.organization!.organizationId),
        ),
      );
    if (!claim) {
      res.status(404).json({ error: "Claim not found" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(claims)
        .set({
          status: "archived",
          systemStatus: "archived",
        })
        .where(
          and(
            eq(claims.id, id),
            eq(claims.organizationId, req.organization!.organizationId),
          ),
        );
      await tx.insert(claimActivity).values({
        organizationId: req.organization!.organizationId,
        claimId: id,
        actorUserId: req.user!.id,
        activityType: "claim_archived",
        metadata: {
          retainedAuditId: claim.currentAuditId,
          retentionReason: "append_only_audit_provenance",
        },
      });
    });

    logger.info({ claimId: id }, "Claim archived with audit provenance retained");
    res.json({ success: true, message: "Claim archived" });
  } catch (err) {
    logger.error({ err }, "Error deleting claim");
    res.status(500).json({ error: "Failed to delete claim" });
  }
  },
);

export default router;
