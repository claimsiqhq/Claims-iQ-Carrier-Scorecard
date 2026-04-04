import type { Answer, Question, QuestionResult } from "./questionBank";
import { DA_QUESTIONS, FA_QUESTIONS, DA_CATEGORY_KEYS, FA_CATEGORY_KEYS, getCategoryName } from "./questionBank";
import { groupByRootIssue, isMaterial } from "./rootIssueEngine";
import type { ValidationIssue } from "./validationEngine";
import logger from "../lib/logger";

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

const POLICY_PROVISION_IDS = new Set([
  "are_unique_policy_provisions_addressed",
  "does_fa_address_unique_policy_provisions",
]);

function applyPolicyProvisionGuard(results: QuestionResult[]): QuestionResult[] {
  return results.map((r) => {
    if (!POLICY_PROVISION_IDS.has(r.id)) return r;
    if (r.answer !== "FAIL") return r;
    const lowerIssue = (r.issue + " " + r.fix).toLowerCase();
    const explicitlyMissing =
      lowerIssue.includes("not addressed") ||
      lowerIssue.includes("missing") ||
      lowerIssue.includes("omitted") ||
      lowerIssue.includes("ignored") ||
      lowerIssue.includes("no mention");
    if (!explicitlyMissing) {
      logger.info({ questionId: r.id }, "Policy provision downgraded from FAIL to PARTIAL (not explicitly missing)");
      return { ...r, answer: "PARTIAL" as Answer };
    }
    return r;
  });
}

function applyRootIssueDedup(results: QuestionResult[]): QuestionResult[] {
  const groups = groupByRootIssue(results);
  const adjusted: QuestionResult[] = [];

  for (const [rootKey, items] of groups) {
    if (items.every((r) => r.answer === "PASS" || r.answer === "NOT_APPLICABLE")) {
      adjusted.push(...items);
      continue;
    }

    const failing = items.filter((r) => r.answer === "FAIL" || r.answer === "PARTIAL");
    const passing = items.filter((r) => r.answer === "PASS" || r.answer === "NOT_APPLICABLE");
    adjusted.push(...passing);

    const primary = failing.find((q) => q.answer === "FAIL") ?? failing[0];
    const material = isMaterial(rootKey);

    for (const q of failing) {
      if (q === primary) {
        if (!material && q.answer === "FAIL") {
          adjusted.push({ ...q, answer: "PARTIAL" as Answer });
          logger.info({ questionId: q.id, rootIssue: rootKey }, "Non-material issue softened FAIL to PARTIAL");
        } else {
          adjusted.push(q);
        }
      } else {
        const damped: Answer = q.answer === "FAIL" ? "PARTIAL" : q.answer;
        adjusted.push({ ...q, answer: damped });
        logger.info({ questionId: q.id, rootIssue: rootKey, primary: primary.id }, "Duplicate root issue damped to PARTIAL");
      }
    }
  }

  return adjusted;
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
          return {
            id: q.id,
            answer: "FAIL" as Answer,
            points_awarded: 0,
            points_possible: maxPts,
            root_issue: "",
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

  const guardedDa = applyPolicyProvisionGuard(daResults);
  const guardedFa = applyPolicyProvisionGuard(faResults);

  const allAdjusted = applyRootIssueDedup([...guardedDa, ...guardedFa]);
  const adjDa = allAdjusted.filter((r) => guardedDa.some((d) => d.id === r.id));
  const adjFa = allAdjusted.filter((r) => guardedFa.some((f) => f.id === r.id));

  const daCategories = buildCategories(daQs, adjDa, daCatKeys, denialApplicable);
  const faCategories = buildCategories(faQs, adjFa, faCatKeys, denialApplicable);

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
