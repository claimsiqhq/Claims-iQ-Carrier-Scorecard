import logger from "../lib/logger";
import {
  runQuestionAudit,
  type QuestionAuditConfiguration,
} from "./runQuestionAudit";
import { computeScore, type ScoringResult, type CategoryScore } from "./scoringEngine";
import { runValidation, runVisionValidation, type ValidationIssue } from "./validationEngine";
import { buildRootIssueGroups, type RootIssueGroup } from "./rootIssueEngine";
import { runPhotoAnalysis, type VisionAnalysisResult } from "./visionAnalysis";
import type { QuestionResult } from "./questionBank";

export class AuditOperationalError extends Error {
  readonly code: string;
  readonly outcome: "degraded" | "failed";
  readonly metadata?: Record<string, unknown>;

  constructor(input: {
    message: string;
    code: string;
    outcome: "degraded" | "failed";
    metadata?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "AuditOperationalError";
    this.code = input.code;
    this.outcome = input.outcome;
    this.metadata = input.metadata;
  }
}

export interface AuditResponse {
  claim_metadata: {
    claim_number: string;
    insured_name: string;
    carrier_name: string;
  };
  overall_audit: {
    overall_score_percent: number;
    overall_points_awarded: number;
    overall_points_possible: number;
    readiness: "READY" | "REVIEW" | "NOT READY";
    technical_risk: "LOW" | "MEDIUM" | "HIGH";
    failed_count: number;
    partial_count: number;
    passed_count: number;
    warning_count: number;
    action_required_count: number;
    executive_summary: string;
  };
  desk_adjuster_scorecard: {
    score_percent: number;
    points_awarded: number;
    points_possible: number;
    denial_letter_applicable: boolean;
    categories: CategoryScore[];
  };
  field_adjuster_scorecard: {
    score_percent: number;
    points_awarded: number;
    points_possible: number;
    categories: CategoryScore[];
  };
  root_issue_groups: RootIssueGroupOutput[];
  issues: IssueItem[];
  validation_checks: ValidationIssue[];
  vision_analysis: VisionAnalysisResult | null;
  provider_request_ids: string[];
}

export interface RootIssueGroupOutput {
  root_issue: string;
  affects: string[];
  issue: string;
  fix: string;
  impact: string;
  evidence_locations: string[];
}

export interface IssueItem {
  source_scorecard: "DA" | "FA";
  category_key: string;
  question_key: string;
  root_issue: string;
  severity: string;
  issue: string;
  impact: string;
  fix: string;
  evidence_locations: string[];
}

function buildIssues(scoring: ScoringResult): IssueItem[] {
  const issues: IssueItem[] = [];

  for (const cat of scoring.da.categories) {
    for (const q of cat.questions) {
      if (q.answer === "FAIL" || q.answer === "PARTIAL") {
        issues.push({
          source_scorecard: "DA",
          category_key: cat.category_key,
          question_key: q.id,
          root_issue: q.root_issue,
          severity: q.answer === "FAIL" ? "fail" : "partial",
          issue: q.issue,
          impact: q.impact,
          fix: q.fix,
          evidence_locations: q.evidence_locations,
        });
      }
    }
  }

  for (const cat of scoring.fa.categories) {
    for (const q of cat.questions) {
      if (q.answer === "FAIL" || q.answer === "PARTIAL") {
        issues.push({
          source_scorecard: "FA",
          category_key: cat.category_key,
          question_key: q.id,
          root_issue: q.root_issue,
          severity: q.answer === "FAIL" ? "fail" : "partial",
          issue: q.issue,
          impact: q.impact,
          fix: q.fix,
          evidence_locations: q.evidence_locations,
        });
      }
    }
  }

  return issues;
}

export async function runFinalAudit(
  reportText: string,
  claimMeta?: { claim_number?: string; insured_name?: string; carrier_name?: string },
  options?: {
    pdfBuffer?: Buffer;
    requestId?: string;
    questionAuditConfiguration?: QuestionAuditConfiguration;
  },
): Promise<AuditResponse> {
  logger.info("DA/FA carrier audit started");

  const validation = runValidation(reportText);

  let visionResult: VisionAnalysisResult | null = null;
  if (options?.pdfBuffer) {
    try {
      visionResult = await runPhotoAnalysis({
        pdfBuffer: options.pdfBuffer,
        extractedText: reportText,
        requestId: options.requestId ?? "audit",
      });

      const visionChecks = runVisionValidation(reportText, visionResult);
      validation.checks.push(...visionChecks);
      if (visionChecks.some((c) => c.severity === "critical")) {
        validation.ready = false;
      }
    } catch (err) {
      logger.error({ err }, "Vision photo analysis failed");
      throw new AuditOperationalError({
        message: "Vision analysis failed; an incomplete audit will not be scored.",
        code: "vision_analysis_failed",
        outcome: "degraded",
        metadata: {
          cause: err instanceof Error ? err.message : "Unknown vision provider error",
        },
      });
    }
  }

  if (!options?.questionAuditConfiguration) {
    throw new AuditOperationalError({
      message:
        "A server-resolved organization carrier policy is required for auditing.",
      code: "organization_carrier_policy_required",
      outcome: "failed",
    });
  }
  const qResult = await runQuestionAudit(
    reportText,
    options.questionAuditConfiguration,
  );
  const scoring = computeScore(
    qResult.da_results,
    qResult.fa_results,
    qResult.denial_letter_applicable,
    validation.checks.length,
    validation.checks,
    { da: qResult.da_questions, fa: qResult.fa_questions },
  );

  const issues = buildIssues(scoring);
  const actionRequiredCount = issues.filter((i) => i.severity === "fail").length;

  const rootGroups = buildRootIssueGroups(
    scoring.da.categories.flatMap((c) => c.questions),
    scoring.fa.categories.flatMap((c) => c.questions),
  );

  const rootIssueGroupsOutput: RootIssueGroupOutput[] = rootGroups.map((g) => ({
    root_issue: g.root_issue,
    affects: g.affects,
    issue: g.primary.issue || g.all.map((q) => q.issue).filter(Boolean).join("; "),
    fix: g.fix || g.all.map((q) => q.fix).filter(Boolean).join("; "),
    impact: g.impact || g.all.map((q) => q.impact).filter(Boolean).join("; "),
    evidence_locations: g.evidence_locations,
  }));

  const result: AuditResponse = {
    claim_metadata: {
      claim_number: claimMeta?.claim_number ?? "",
      insured_name: claimMeta?.insured_name ?? "",
      carrier_name: claimMeta?.carrier_name ?? "",
    },
    overall_audit: {
      overall_score_percent: scoring.overall_score_percent,
      overall_points_awarded: scoring.overall_points_awarded,
      overall_points_possible: scoring.overall_points_possible,
      readiness: scoring.readiness,
      technical_risk: scoring.technical_risk,
      failed_count: scoring.failed_count,
      partial_count: scoring.partial_count,
      passed_count: scoring.passed_count,
      warning_count: scoring.warning_count,
      action_required_count: actionRequiredCount,
      executive_summary: qResult.executive_summary,
    },
    desk_adjuster_scorecard: {
      score_percent: scoring.da.score_percent,
      points_awarded: scoring.da.points_awarded,
      points_possible: scoring.da.points_possible,
      denial_letter_applicable: scoring.da.denial_letter_applicable,
      categories: scoring.da.categories,
    },
    field_adjuster_scorecard: {
      score_percent: scoring.fa.score_percent,
      points_awarded: scoring.fa.points_awarded,
      points_possible: scoring.fa.points_possible,
      categories: scoring.fa.categories,
    },
    root_issue_groups: rootIssueGroupsOutput,
    issues,
    validation_checks: validation.checks,
    vision_analysis: visionResult,
    provider_request_ids: qResult.provider_request_ids,
  };

  logger.info({
    overallPercent: scoring.overall_score_percent,
    daPercent: scoring.da.score_percent,
    faPercent: scoring.fa.score_percent,
    readiness: scoring.readiness,
    risk: scoring.technical_risk,
    failCount: scoring.failed_count,
    issueCount: issues.length,
    rootIssueGroupCount: rootIssueGroupsOutput.length,
    hasVisionAnalysis: !!visionResult,
    photoPages: visionResult?.total_photo_pages ?? 0,
    toolReadings: visionResult?.tool_readings.length ?? 0,
  }, "DA/FA carrier audit completed");

  return result;
}
