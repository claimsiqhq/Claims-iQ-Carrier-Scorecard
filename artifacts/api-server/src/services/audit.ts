import logger from "../lib/logger";
import { runQuestionAudit } from "./runQuestionAudit";
import { computeScore } from "./scoringEngine";
import { runValidation, type ValidationResult } from "./validationEngine";
import { QUESTION_BANK, SECTION_LABELS, type QuestionResult } from "./questionBank";

export interface SectionScores {
  coverage: number;
  scope: number;
  financial: number;
  documentation: number;
  presentation: number;
  [key: string]: number;
}

export interface SectionMax {
  coverage: number;
  scope: number;
  financial: number;
  documentation: number;
  presentation: number;
  [key: string]: number;
}

export type SectionReasoning = Record<string, string>;

export interface AuditResponse {
  overall_score: number;
  total_max: number;
  percent: number;
  technical_score: number;
  technical_max: number;
  presentation_score: number;
  presentation_max: number;
  section_scores: SectionScores;
  section_max: SectionMax;
  section_reasoning: SectionReasoning;
  risk_level: string;
  approval_status: string;
  executive_summary: string;
  questions: QuestionResult[];
  critical_failures: string[];
  ready: boolean;
  validation: ValidationResult;
}

export function getFallbackAudit(): AuditResponse {
  const scoring = computeScore(
    QUESTION_BANK.map((q) => ({ id: q.id, answer: "FAIL" as const, issue: "Audit processing failed", impact: "", fix: "", location: "", confidence: 0 })),
    QUESTION_BANK
  );

  const sectionScores: SectionScores = { coverage: 0, scope: 0, financial: 0, documentation: 0, presentation: 0 };
  const sectionMax: SectionMax = { coverage: 0, scope: 0, financial: 0, documentation: 0, presentation: 0 };
  for (const [key, val] of Object.entries(scoring.sections)) {
    sectionScores[key] = val.score;
    sectionMax[key] = val.max;
  }

  const techSections = ["coverage", "scope", "financial", "documentation"];
  const techMax = techSections.reduce((sum, k) => sum + (sectionMax[k] || 0), 0);
  const presMax = sectionMax.presentation || 0;

  return {
    overall_score: 0,
    total_max: scoring.max,
    percent: 0,
    technical_score: 0,
    technical_max: techMax,
    presentation_score: 0,
    presentation_max: presMax,
    section_scores: sectionScores,
    section_max: sectionMax,
    section_reasoning: {},
    risk_level: "HIGH",
    approval_status: "REQUIRES REVIEW",
    executive_summary: "The audit could not be completed successfully.",
    questions: QUESTION_BANK.map((q) => ({ id: q.id, answer: "FAIL" as const, issue: "Audit processing failed", impact: "", fix: "", location: "", confidence: 0 })),
    critical_failures: ["Audit processing failed"],
    ready: false,
    validation: { critical: [], warnings: [], info: [], ready: false },
  };
}

function deriveRiskLevel(percent: number, failCount: number): string {
  if (failCount >= 3 || percent < 50) return "HIGH";
  if (failCount >= 1 || percent < 75) return "MEDIUM";
  return "LOW";
}

function deriveApprovalStatus(percent: number, failCount: number): string {
  if (failCount >= 3 || percent < 50) return "REJECT";
  if (failCount >= 1) return "REQUIRES REVIEW";
  if (percent < 85) return "APPROVE WITH MINOR CHANGES";
  return "APPROVE";
}

function buildExecutiveSummary(questionResults: QuestionResult[], percent: number, validation: ValidationResult): string {
  const fails = questionResults.filter((q) => q.answer === "FAIL");
  const partials = questionResults.filter((q) => q.answer === "PARTIAL");

  const parts: string[] = [];
  parts.push(`The claim file scored ${percent}% overall.`);

  if (validation.ready && fails.length === 0) {
    parts.push("No critical failures were identified — the file appears ready for carrier submission.");
  } else {
    parts.push(`${fails.length} question(s) failed audit.`);
  }

  if (partials.length > 0) {
    parts.push(`${partials.length} question(s) received partial credit.`);
  }

  if (fails.length > 0) {
    parts.push("Failed items: " + fails.map((f) => {
      const q = QUESTION_BANK.find((qb) => qb.id === f.id);
      return q ? q.text : f.id;
    }).join("; ") + ".");
  }

  if (validation.warnings.length > 0) {
    parts.push(`Validation flagged ${validation.warnings.length} warning(s): ${validation.warnings.map((w) => w.message).join("; ")}.`);
  }

  return parts.join(" ");
}

export async function runFinalAudit(reportText: string): Promise<AuditResponse> {
  logger.info("Question-level audit started");

  const validation = runValidation(reportText);
  const questionResults = await runQuestionAudit(reportText);
  const scoring = computeScore(questionResults, QUESTION_BANK);

  const sectionScores: SectionScores = { coverage: 0, scope: 0, financial: 0, documentation: 0, presentation: 0 };
  const sectionMax: SectionMax = { coverage: 0, scope: 0, financial: 0, documentation: 0, presentation: 0 };
  const sectionReasoning: SectionReasoning = {};

  for (const [key, val] of Object.entries(scoring.sections)) {
    sectionScores[key] = val.score;
    sectionMax[key] = val.max;

    const sectionQuestions = questionResults.filter((q) => {
      const qDef = QUESTION_BANK.find((qb) => qb.id === q.id);
      return qDef?.section === key;
    });
    const reasonParts = sectionQuestions
      .filter((q) => q.issue || q.fix)
      .map((q) => {
        const qDef = QUESTION_BANK.find((qb) => qb.id === q.id);
        const icon = q.answer === "PASS" ? "✔" : q.answer === "PARTIAL" ? "◐" : "✖";
        const detail = q.answer === "PASS" ? (q.issue || "OK") : `${q.issue}${q.fix ? ` → Fix: ${q.fix}` : ""}`;
        return `${icon} ${qDef?.text || q.id}: ${detail}`;
      });
    sectionReasoning[key] = reasonParts.join("\n");
  }

  const criticalFailures = questionResults
    .filter((q) => q.answer === "FAIL")
    .map((q) => {
      const qDef = QUESTION_BANK.find((qb) => qb.id === q.id);
      return `${qDef?.text || q.id} — ${q.issue}${q.fix ? ` (Fix: ${q.fix})` : ""}`;
    });

  const ready = criticalFailures.length === 0 && validation.ready;
  const riskLevel = deriveRiskLevel(scoring.percent, criticalFailures.length);
  const approvalStatus = deriveApprovalStatus(scoring.percent, criticalFailures.length);
  const executiveSummary = buildExecutiveSummary(questionResults, scoring.percent, validation);

  logger.info({
    percent: scoring.percent,
    total: scoring.total,
    max: scoring.max,
    fails: criticalFailures.length,
    validationReady: validation.ready,
    ready,
  }, "Question-level audit completed");

  const techSections = ["coverage", "scope", "financial", "documentation"];
  const technicalScore = techSections.reduce((sum, k) => sum + (sectionScores[k] || 0), 0);
  const technicalMax = techSections.reduce((sum, k) => sum + (sectionMax[k] || 0), 0);
  const presentationScoreVal = sectionScores.presentation || 0;
  const presentationMaxVal = sectionMax.presentation || 0;

  return {
    overall_score: scoring.total,
    total_max: scoring.max,
    percent: scoring.percent,
    technical_score: technicalScore,
    technical_max: technicalMax,
    presentation_score: presentationScoreVal,
    presentation_max: presentationMaxVal,
    section_scores: sectionScores,
    section_max: sectionMax,
    section_reasoning: sectionReasoning,
    risk_level: riskLevel,
    approval_status: approvalStatus,
    executive_summary: executiveSummary,
    questions: questionResults,
    critical_failures: criticalFailures,
    ready,
    validation,
  };
}
