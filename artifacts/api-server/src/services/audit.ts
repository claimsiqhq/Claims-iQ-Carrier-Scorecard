import logger from "../lib/logger";
import { runQuestionAudit } from "./runQuestionAudit";
import { computeScore, type ScoringResult, type CategoryScore } from "./scoringEngine";
import { runValidation, type ValidationResult, type ValidationIssue } from "./validationEngine";
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
  issues: IssueItem[];
  validation_checks: ValidationIssue[];
}

export interface IssueItem {
  source_scorecard: "DA" | "FA";
  category_key: string;
  question_key: string;
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
    issues: [],
    validation_checks: [],
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
): Promise<AuditResponse> {
  logger.info("DA/FA carrier audit started");

  const validation = runValidation(reportText);
  const qResult = await runQuestionAudit(reportText);
  const scoring = computeScore(
    qResult.da_results,
    qResult.fa_results,
    qResult.denial_letter_applicable,
    validation.checks.length,
  );

  const issues = buildIssues(scoring);
  const actionRequiredCount = issues.length;

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
    issues,
    validation_checks: validation.checks,
  };

  logger.info({
    overallPercent: scoring.overall_score_percent,
    daPercent: scoring.da.score_percent,
    faPercent: scoring.fa.score_percent,
    readiness: scoring.readiness,
    risk: scoring.technical_risk,
    failCount: scoring.failed_count,
    issueCount: issues.length,
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
