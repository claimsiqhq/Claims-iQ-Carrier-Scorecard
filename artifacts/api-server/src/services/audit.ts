import logger from "../lib/logger";
import { runQuestionAudit } from "./runQuestionAudit";
import { computeScore, type ScoringResult, type CategoryScore } from "./scoringEngine";
import { runValidation, runVisionValidation, type ValidationResult, type ValidationIssue } from "./validationEngine";
import { buildRootIssueGroups, type RootIssueGroup } from "./rootIssueEngine";
import { runPhotoAnalysis, type VisionAnalysisResult } from "./visionAnalysis";
import type { QuestionResult } from "./questionBank";

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
}

export interface RootIssueGroupOutput {
  root_issue: string;
  affects: string[];
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

export function getFallbackAudit(): AuditResponse {
  return {
    claim_metadata: { claim_number: "", insured_name: "", carrier_name: "" },
    overall_audit: {
      overall_score_percent: 0,
      overall_points_awarded: 0,
      overall_points_possible: 200,
      readiness: "NOT READY",
      technical_risk: "HIGH",
      failed_count: 11,
      partial_count: 0,
      passed_count: 0,
      warning_count: 0,
      action_required_count: 11,
      executive_summary: "The audit could not be completed successfully.",
    },
    desk_adjuster_scorecard: {
      score_percent: 0,
      points_awarded: 0,
      points_possible: 100,
      denial_letter_applicable: false,
      categories: [],
    },
    field_adjuster_scorecard: {
      score_percent: 0,
      points_awarded: 0,
      points_possible: 100,
      categories: [],
    },
    root_issue_groups: [],
    issues: [],
    validation_checks: [],
    vision_analysis: null,
  };
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
  options?: { pdfBuffer?: Buffer; requestId?: string },
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
      logger.error({ err }, "Vision photo analysis failed — continuing without it");
    }
  }

  const qResult = await runQuestionAudit(reportText);
  const scoring = computeScore(
    qResult.da_results,
    qResult.fa_results,
    qResult.denial_letter_applicable,
    validation.checks.length,
    validation.checks,
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
    fix: g.fix,
    impact: g.impact,
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
      executive_summary: qResult.executive_summary || buildDefaultSummary(scoring, validation),
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

function buildDefaultSummary(scoring: ScoringResult, validation: ValidationResult): string {
  const parts: string[] = [];
  parts.push(`Overall score: ${scoring.overall_score_percent}% (DA: ${scoring.da.score_percent}%, FA: ${scoring.fa.score_percent}%).`);

  if (scoring.readiness === "READY") {
    parts.push("The file appears ready for carrier submission.");
  } else if (scoring.readiness === "REVIEW") {
    parts.push("The file needs review before submission.");
  } else {
    parts.push("The file is not ready for carrier submission.");
  }

  if (scoring.failed_count > 0) {
    parts.push(`${scoring.failed_count} question(s) failed.`);
  }
  if (scoring.partial_count > 0) {
    parts.push(`${scoring.partial_count} question(s) received partial credit.`);
  }
  if (validation.checks.length > 0) {
    parts.push(`${validation.checks.length} validation warning(s) flagged.`);
  }

  return parts.join(" ");
}
