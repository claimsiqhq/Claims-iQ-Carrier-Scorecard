import { openai } from "@workspace/integrations-openai-ai-server";
import { DA_QUESTIONS, FA_QUESTIONS, type QuestionResult, type Answer } from "./questionBank";
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from "./prompts";
import logger from "../lib/logger";

const VALID_ANSWERS: Answer[] = ["PASS", "PARTIAL", "FAIL", "NOT_APPLICABLE"];

export interface QuestionAuditOutput {
  denial_letter_applicable: boolean;
  da_results: QuestionResult[];
  fa_results: QuestionResult[];
  executive_summary: string;
}

function normalizeResult(questions: typeof DA_QUESTIONS, rawResults: any[]): QuestionResult[] {
  return questions.map((q) => {
    const match = rawResults.find((r: any) => r?.id === q.id);
    if (!match) {
      return {
        id: q.id,
        answer: "FAIL" as Answer,
        points_awarded: 0,
        points_possible: q.weight,
        issue: "Question not answered by AI",
        impact: "",
        fix: "",
        evidence_locations: [],
        confidence: 0,
      };
    }

    const answer: Answer = VALID_ANSWERS.includes(match.answer) ? match.answer : "FAIL";
    const issue = typeof match.issue === "string" ? match.issue : "";
    const impact = typeof match.impact === "string" ? match.impact : "";
    const fix = typeof match.fix === "string" ? match.fix : "";
    const evidence_locations = Array.isArray(match.evidence_locations)
      ? match.evidence_locations.filter((e: unknown) => typeof e === "string")
      : [];
    const confidence = typeof match.confidence === "number" ? match.confidence : 0;

    return {
      id: q.id,
      answer,
      points_awarded: 0,
      points_possible: q.weight,
      issue,
      impact,
      fix,
      evidence_locations,
      confidence,
    };
  });
}

function buildFallback(): QuestionAuditOutput {
  return {
    denial_letter_applicable: false,
    da_results: DA_QUESTIONS.map((q) => ({
      id: q.id,
      answer: "FAIL" as Answer,
      points_awarded: 0,
      points_possible: q.weight,
      issue: "Audit processing failed",
      impact: "",
      fix: "",
      evidence_locations: [],
      confidence: 0,
    })),
    fa_results: FA_QUESTIONS.map((q) => ({
      id: q.id,
      answer: "FAIL" as Answer,
      points_awarded: 0,
      points_possible: q.weight,
      issue: "Audit processing failed",
      impact: "",
      fix: "",
      evidence_locations: [],
      confidence: 0,
    })),
    executive_summary: "The audit could not be completed successfully.",
  };
}

export async function runQuestionAudit(reportText: string): Promise<QuestionAuditOutput> {
  const daQuestionsText = DA_QUESTIONS.map((q) => `- ${q.id}: ${q.text}`).join("\n");
  const faQuestionsText = FA_QUESTIONS.map((q) => `- ${q.id}: ${q.text}`).join("\n");

  const userPrompt = USER_PROMPT_TEMPLATE
    .replace("{{DA_QUESTIONS}}", daQuestionsText)
    .replace("{{FA_QUESTIONS}}", faQuestionsText)
    .replace("{{REPORT}}", reportText);

  logger.info({
    daQuestionCount: DA_QUESTIONS.length,
    faQuestionCount: FA_QUESTIONS.length,
  }, "Running DA/FA question-level audit");

  let response;
  try {
    response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }, { signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    logger.error({ err }, "OpenAI request failed");
    return buildFallback();
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    logger.error("Empty AI response for question audit");
    return buildFallback();
  }

  const cleaned = content
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    logger.error({ contentPreview: content.substring(0, 300) }, "Question audit: invalid JSON");
    return buildFallback();
  }

  const denialApplicable = typeof parsed.denial_letter_applicable === "boolean"
    ? parsed.denial_letter_applicable
    : false;

  const daRaw = Array.isArray(parsed.da_results) ? parsed.da_results : [];
  const faRaw = Array.isArray(parsed.fa_results) ? parsed.fa_results : [];

  const daResults = normalizeResult(DA_QUESTIONS, daRaw);
  const faResults = normalizeResult(FA_QUESTIONS, faRaw);

  const executiveSummary = typeof parsed.executive_summary === "string"
    ? parsed.executive_summary
    : "";

  const allResults = [...daResults, ...faResults];
  logger.info({
    denialApplicable,
    pass: allResults.filter((r) => r.answer === "PASS").length,
    partial: allResults.filter((r) => r.answer === "PARTIAL").length,
    fail: allResults.filter((r) => r.answer === "FAIL").length,
    na: allResults.filter((r) => r.answer === "NOT_APPLICABLE").length,
  }, "DA/FA question audit complete");

  return { denial_letter_applicable: denialApplicable, da_results: daResults, fa_results: faResults, executive_summary: executiveSummary };
}
