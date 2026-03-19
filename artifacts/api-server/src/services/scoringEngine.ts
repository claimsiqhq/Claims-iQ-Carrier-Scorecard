import type { Answer, Question, QuestionResult } from "./questionBank";
import { DA_QUESTIONS, FA_QUESTIONS, DA_CATEGORY_KEYS, FA_CATEGORY_KEYS, getCategoryName } from "./questionBank";

function scoreAnswer(answer: Answer, maxPoints: number): number {
  switch (answer) {
    case "PASS": return maxPoints;
    case "PARTIAL": return Math.round(maxPoints * 0.5);
    case "FAIL": return 0;
    case "NOT_APPLICABLE": return maxPoints;
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

function buildCategories(
  questions: Question[],
  results: QuestionResult[],
  categoryKeys: string[],
  denialApplicable: boolean,
): CategoryScore[] {
  return categoryKeys
    .filter((key) => {
      if (key === "denial_letters" && !denialApplicable) return false;
      return true;
    })
    .map((key) => {
      const catQuestions = questions.filter((q) => q.categoryKey === key);
      const catResults: QuestionResult[] = catQuestions.map((q) => {
        const r = results.find((r) => r.id === q.id);
        const maxPts = getEffectiveWeight(q, denialApplicable);
        if (!r) {
          return {
            id: q.id,
            answer: "FAIL" as Answer,
            points_awarded: 0,
            points_possible: maxPts,
            issue: "Not evaluated",
            impact: "",
            fix: "",
            evidence_locations: [],
            confidence: 0,
          };
        }
        const pts = scoreAnswer(r.answer, maxPts);
        return { ...r, points_awarded: pts, points_possible: maxPts };
      });

      return {
        category_key: key,
        category_name: getCategoryName(key),
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
): ScoringResult {
  const daCategories = buildCategories(DA_QUESTIONS, daResults, DA_CATEGORY_KEYS, denialApplicable);
  const faCategories = buildCategories(FA_QUESTIONS, faResults, FA_CATEGORY_KEYS, denialApplicable);

  const daAwarded = daCategories.reduce((s, c) => s + c.points_awarded, 0);
  const daPossible = daCategories.reduce((s, c) => s + c.points_possible, 0);
  const daPercent = daPossible > 0 ? Math.round((daAwarded / daPossible) * 100) : 0;

  const faAwarded = faCategories.reduce((s, c) => s + c.points_awarded, 0);
  const faPossible = faCategories.reduce((s, c) => s + c.points_possible, 0);
  const faPercent = faPossible > 0 ? Math.round((faAwarded / faPossible) * 100) : 0;

  const overallPercent = Math.round((daPercent + faPercent) / 2);
  const overallAwarded = daAwarded + faAwarded;
  const overallPossible = daPossible + faPossible;

  const allScoredQuestions = [...daCategories, ...faCategories].flatMap((c) => c.questions);
  const failedCount = allScoredQuestions.filter((r) => r.answer === "FAIL").length;
  const partialCount = allScoredQuestions.filter((r) => r.answer === "PARTIAL").length;
  const passedCount = allScoredQuestions.filter((r) => r.answer === "PASS").length;

  let readiness: "READY" | "REVIEW" | "NOT READY";
  if (overallPercent >= 90) readiness = "READY";
  else if (overallPercent >= 75) readiness = "REVIEW";
  else readiness = "NOT READY";

  let technicalRisk: "LOW" | "MEDIUM" | "HIGH";
  if (failedCount >= 3 || overallPercent < 50) technicalRisk = "HIGH";
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
