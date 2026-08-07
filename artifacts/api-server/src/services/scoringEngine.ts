import type { Answer, Question, QuestionResult } from "./questionBank";
import { DA_QUESTIONS, FA_QUESTIONS, DA_CATEGORY_KEYS, FA_CATEGORY_KEYS, getCategoryName } from "./questionBank";
import { isMaterial } from "./rootIssueEngine";
import type { ValidationIssue } from "./validationEngine";

export class InsufficientAuditEvidenceError extends Error {
  readonly code = "insufficient_audit_evidence";

  constructor(message: string) {
    super(message);
    this.name = "InsufficientAuditEvidenceError";
  }
}

export function scoreAnswer(answer: Answer, maxPoints: number): number {
  switch (answer) {
    case "PASS": return maxPoints;
    case "PARTIAL": return maxPoints / 2;
    case "FAIL": return 0;
    case "NOT_APPLICABLE": return 0;
    default: return 0;
  }
}

export interface CategoryScore {
  category_key: string;
  category_name: string;
  points_awarded: number;
  points_possible: number;
  questions: QuestionResult[];
}

export interface ScorecardResult {
  score_percent: number;
  points_awarded: number;
  points_possible: number;
  categories: CategoryScore[];
}

export interface ScoringResult {
  da: ScorecardResult & { denial_letter_applicable: boolean };
  fa: ScorecardResult;
  overall_score_percent: number;
  overall_points_awarded: number;
  overall_points_possible: number;
  readiness: "READY" | "REVIEW" | "NOT READY";
  technical_risk: "LOW" | "MEDIUM" | "HIGH";
  failed_count: number;
  partial_count: number;
  passed_count: number;
  warning_count: number;
}

function getEffectiveWeight(q: Question, denialApplicable: boolean): number {
  if (q.scorecard !== "DA") return q.weight;
  if (denialApplicable) return q.weight;
  return q.weightIfNoDenial ?? q.weight;
}

export function assertCompleteAuditResults(
  questions: Question[],
  results: QuestionResult[],
): void {
  const resultById = new Map(results.map((result) => [result.id, result]));
  const missing = questions
    .filter((question) => !resultById.has(question.id))
    .map((question) => question.id);
  const operationallyMissing = results
    .filter((result) =>
      result.confidence === 0
      && (
        result.issue === "Question not answered by AI"
        || result.issue === "Audit processing failed"
        || result.issue === "Not evaluated"
      ))
    .map((result) => result.id);

  const insufficient = [...new Set([...missing, ...operationallyMissing])];
  if (insufficient.length > 0) {
    throw new InsufficientAuditEvidenceError(
      `Audit provider did not produce usable answers for: ${insufficient.join(", ")}`,
    );
  }
}

function buildCategories(
  questions: Question[],
  results: QuestionResult[],
  categoryKeys: string[],
  denialApplicable: boolean,
): CategoryScore[] {
  return categoryKeys
    .filter((key) => {
      if (!denialApplicable) {
        const catQs = questions.filter((q) => q.categoryKey === key);
        const allZeroWeight = catQs.length > 0 && catQs.every((q) => getEffectiveWeight(q, false) === 0);
        if (allZeroWeight) return false;
      }
      return true;
    })
    .map((key) => {
      const catQuestions = questions.filter((q) => q.categoryKey === key);
      const catResults: QuestionResult[] = catQuestions.map((q) => {
        const r = results.find((r) => r.id === q.id);
        const maxPts = getEffectiveWeight(q, denialApplicable);
        if (!r) {
          throw new InsufficientAuditEvidenceError(
            `Audit result is missing question ${q.id}`,
          );
        }
        const pts = scoreAnswer(r.answer, maxPts);
        const applicablePossible = r.answer === "NOT_APPLICABLE" ? 0 : maxPts;
        return {
          ...r,
          points_awarded: pts,
          points_possible: applicablePossible,
        };
      });

      const catName = catQuestions[0]?.categoryName ?? getCategoryName(key);

      return {
        category_key: key,
        category_name: catName,
        points_awarded: catResults.reduce((s, r) => s + r.points_awarded, 0),
        points_possible: catResults.reduce((s, r) => s + r.points_possible, 0),
        questions: catResults,
      };
    });
}

export function computeScore(
  daResults: QuestionResult[],
  faResults: QuestionResult[],
  denialApplicable: boolean,
  warningCount: number = 0,
  validationChecks: ValidationIssue[] = [],
  carrierQuestions?: { da: Question[]; fa: Question[] },
): ScoringResult {
  const daQs = carrierQuestions?.da ?? DA_QUESTIONS;
  const faQs = carrierQuestions?.fa ?? FA_QUESTIONS;
  const daCatKeys = carrierQuestions?.da
    ? [...new Set(carrierQuestions.da.map((q) => q.categoryKey))]
    : DA_CATEGORY_KEYS;
  const faCatKeys = carrierQuestions?.fa
    ? [...new Set(carrierQuestions.fa.map((q) => q.categoryKey))]
    : FA_CATEGORY_KEYS;

  assertCompleteAuditResults(daQs, daResults);
  assertCompleteAuditResults(faQs, faResults);

  const daCategories = buildCategories(daQs, daResults, daCatKeys, denialApplicable);
  const faCategories = buildCategories(faQs, faResults, faCatKeys, denialApplicable);

  const daAwarded = daCategories.reduce((s, c) => s + c.points_awarded, 0);
  const daPossible = daCategories.reduce((s, c) => s + c.points_possible, 0);
  const daPercent = daPossible > 0 ? Math.round((daAwarded / daPossible) * 100) : 0;

  const faAwarded = faCategories.reduce((s, c) => s + c.points_awarded, 0);
  const faPossible = faCategories.reduce((s, c) => s + c.points_possible, 0);
  const faPercent = faPossible > 0 ? Math.round((faAwarded / faPossible) * 100) : 0;

  const overallAwarded = daAwarded + faAwarded;
  const overallPossible = daPossible + faPossible;
  const overallPercent = overallPossible > 0
    ? Math.round((overallAwarded / overallPossible) * 100)
    : 0;

  const allScoredQuestions = [...daCategories, ...faCategories].flatMap((c) => c.questions);
  const failedCount = allScoredQuestions.filter((r) => r.answer === "FAIL").length;
  const partialCount = allScoredQuestions.filter((r) => r.answer === "PARTIAL").length;
  const passedCount = allScoredQuestions.filter((r) => r.answer === "PASS").length;

  const hasCriticalValidation = validationChecks.some((c) => c.severity === "critical");
  const materialFailures = allScoredQuestions.filter(
    (r) => r.answer === "FAIL" && isMaterial(r.root_issue),
  );

  let readiness: "READY" | "REVIEW" | "NOT READY";
  if (hasCriticalValidation || materialFailures.length > 0) {
    readiness = "NOT READY";
  } else if (overallPercent >= 90) {
    readiness = "READY";
  } else if (overallPercent >= 75) {
    readiness = "REVIEW";
  } else {
    readiness = "NOT READY";
  }

  let technicalRisk: "LOW" | "MEDIUM" | "HIGH";
  if (materialFailures.length >= 2 || failedCount >= 3 || overallPercent < 50) technicalRisk = "HIGH";
  else if (failedCount >= 1 || overallPercent < 75) technicalRisk = "MEDIUM";
  else technicalRisk = "LOW";

  return {
    da: {
      denial_letter_applicable: denialApplicable,
      score_percent: daPercent,
      points_awarded: daAwarded,
      points_possible: daPossible,
      categories: daCategories,
    },
    fa: {
      score_percent: faPercent,
      points_awarded: faAwarded,
      points_possible: faPossible,
      categories: faCategories,
    },
    overall_score_percent: overallPercent,
    overall_points_awarded: overallAwarded,
    overall_points_possible: overallPossible,
    readiness,
    technical_risk: technicalRisk,
    failed_count: failedCount,
    partial_count: partialCount,
    passed_count: passedCount,
    warning_count: warningCount,
  };
}
