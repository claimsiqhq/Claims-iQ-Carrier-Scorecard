import test from "node:test";
import assert from "node:assert/strict";
import {
  computeScore,
  InsufficientAuditEvidenceError,
} from "./services/scoringEngine";
import type {
  Answer,
  Question,
  QuestionResult,
  Scorecard,
} from "./services/questionBank";

function question(
  id: string,
  weight: number,
  scorecard: Scorecard,
): Question {
  return {
    id,
    text: id,
    weight,
    section: scorecard.toLowerCase(),
    scorecard,
    categoryKey: `${scorecard.toLowerCase()}_category`,
    categoryName: `${scorecard} Category`,
  };
}

function result(id: string, answer: Answer): QuestionResult {
  return {
    id,
    answer,
    points_awarded: 0,
    points_possible: 0,
    root_issue: answer === "FAIL" ? "non_material_formatting" : "",
    issue: answer === "PASS" ? "" : "Evidence result",
    impact: "",
    fix: "",
    evidence_locations: [],
    confidence: 90,
  };
}

test("overall score uses total applicable points for unequal DA and FA totals", () => {
  const da = question("da_pass", 30, "DA");
  const fa = question("fa_fail", 70, "FA");
  const scored = computeScore(
    [result(da.id, "PASS")],
    [result(fa.id, "FAIL")],
    false,
    0,
    [],
    { da: [da], fa: [fa] },
  );

  assert.equal(scored.da.score_percent, 100);
  assert.equal(scored.fa.score_percent, 0);
  assert.equal(scored.overall_points_awarded, 30);
  assert.equal(scored.overall_points_possible, 100);
  assert.equal(scored.overall_score_percent, 30);
});

test("PARTIAL awards exactly half of odd weights without inflation", () => {
  const da = question("odd_partial", 5, "DA");
  const scored = computeScore(
    [result(da.id, "PARTIAL")],
    [],
    false,
    0,
    [],
    { da: [da], fa: [] },
  );

  assert.equal(scored.da.points_awarded, 2.5);
  assert.equal(scored.da.points_possible, 5);
  assert.equal(scored.overall_score_percent, 50);
});

test("NOT_APPLICABLE is removed from the denominator", () => {
  const applicable = question("applicable", 10, "DA");
  const notApplicable = {
    ...question("not_applicable", 10, "DA"),
    categoryKey: applicable.categoryKey,
  };
  const scored = computeScore(
    [
      result(applicable.id, "PASS"),
      result(notApplicable.id, "NOT_APPLICABLE"),
    ],
    [],
    false,
    0,
    [],
    { da: [applicable, notApplicable], fa: [] },
  );

  const na = scored.da.categories[0]!.questions.find(
    (item) => item.id === notApplicable.id,
  )!;
  assert.equal(na.points_awarded, 0);
  assert.equal(na.points_possible, 0);
  assert.equal(scored.da.points_possible, 10);
  assert.equal(scored.overall_score_percent, 100);
});

test("provider omissions are an operational failure, not a score", () => {
  const missing = question("provider_missing", 10, "DA");
  assert.throws(
    () =>
      computeScore([], [], false, 0, [], {
        da: [missing],
        fa: [],
      }),
    InsufficientAuditEvidenceError,
  );
});

test("non-material FAIL remains FAIL without model-controlled softening", () => {
  const da = question("strict_fail", 9, "DA");
  const scored = computeScore(
    [result(da.id, "FAIL")],
    [],
    false,
    0,
    [],
    { da: [da], fa: [] },
  );
  assert.equal(scored.da.categories[0]!.questions[0]!.answer, "FAIL");
  assert.equal(scored.da.points_awarded, 0);
});
