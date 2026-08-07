import assert from "node:assert/strict";
import test from "node:test";
import type { Question } from "./services/questionBank";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:9";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-key";

const {
  normalizeQuestionResults,
  QuestionAuditResponseError,
} = await import("./services/runQuestionAudit");

const question: Question = {
  id: "required_evidence",
  text: "Is required evidence present?",
  weight: 10,
  section: "quality",
  scorecard: "DA",
  categoryKey: "evidence",
  categoryName: "Evidence",
};

const validResult = {
  id: question.id,
  answer: "PASS",
  root_issue: "",
  issue: "",
  impact: "",
  fix: "",
  evidence_locations: ["Page 2"],
  confidence: 94,
};

test("normalizes a complete question response without assigning provider scores", () => {
  const [result] = normalizeQuestionResults([question], [validResult]);
  assert.equal(result.id, question.id);
  assert.equal(result.answer, "PASS");
  assert.equal(result.points_awarded, 0);
  assert.equal(result.points_possible, 10);
});

test("rejects an omitted question instead of converting it into a scored failure", () => {
  assert.throws(
    () => normalizeQuestionResults([question], []),
    (error) =>
      error instanceof QuestionAuditResponseError
      && error.code === "question_audit_response_invalid"
      && error.message.includes(question.id),
  );
});

test("rejects invalid answers and confidence values", () => {
  assert.throws(
    () =>
      normalizeQuestionResults(
        [question],
        [{ ...validResult, answer: "UNKNOWN", confidence: 120 }],
      ),
    QuestionAuditResponseError,
  );
});

test("rejects duplicate provider answers for the same question", () => {
  assert.throws(
    () => normalizeQuestionResults([question], [validResult, validResult]),
    (error) =>
      error instanceof QuestionAuditResponseError
      && error.message.includes("duplicate"),
  );
});
