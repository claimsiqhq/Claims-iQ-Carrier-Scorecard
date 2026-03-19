import { openai } from "@workspace/integrations-openai-ai-server";
import { QUESTION_BANK, type QuestionResult, type Answer } from "./questionBank";
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from "./prompts";
import logger from "../lib/logger";

const VALID_ANSWERS: Answer[] = ["PASS", "PARTIAL", "FAIL", "NOT_APPLICABLE"];

export async function runQuestionAudit(reportText: string): Promise<QuestionResult[]> {
  const questionsText = QUESTION_BANK.map((q) => `- ${q.id}: ${q.text}`).join("\n");

  const userPrompt = USER_PROMPT_TEMPLATE
    .replace("{{QUESTIONS}}", questionsText)
    .replace("{{REPORT}}", reportText);

  logger.info({ questionCount: QUESTION_BANK.length }, "Running question-level audit");

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  }, { signal: AbortSignal.timeout(120_000) });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    logger.error("Empty AI response for question audit");
    return QUESTION_BANK.map((q) => ({
      id: q.id,
      answer: "FAIL" as Answer,
      issue: "No response from AI",
      impact: "",
      fix: "",
      location: "",
      confidence: 0,
    }));
  }

  const cleaned = content
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    logger.error({ contentPreview: content.substring(0, 200) }, "Question audit: invalid JSON");
    return QUESTION_BANK.map((q) => ({
      id: q.id,
      answer: "FAIL" as Answer,
      issue: "Failed to parse AI response",
      impact: "",
      fix: "",
      location: "",
      confidence: 0,
    }));
  }

  const rawResults = Array.isArray(parsed) ? parsed : [];

  const results: QuestionResult[] = QUESTION_BANK.map((q) => {
    const match = rawResults.find((r: any) => r?.id === q.id);
    if (!match) {
      return {
        id: q.id,
        answer: "FAIL" as Answer,
        issue: "Question not answered by AI",
        impact: "",
        fix: "",
        location: "",
        confidence: 0,
      };
    }

    const answer: Answer = VALID_ANSWERS.includes(match.answer) ? match.answer : "FAIL";
    const issue = typeof match.issue === "string" ? match.issue : "";
    const impact = typeof match.impact === "string" ? match.impact : "";
    const fix = typeof match.fix === "string" ? match.fix : "";
    const location = typeof match.location === "string" ? match.location : "";
    const confidence = typeof match.confidence === "number" ? match.confidence : 0;

    return { id: q.id, answer, issue, impact, fix, location, confidence };
  });

  logger.info({
    pass: results.filter((r) => r.answer === "PASS").length,
    partial: results.filter((r) => r.answer === "PARTIAL").length,
    fail: results.filter((r) => r.answer === "FAIL").length,
    na: results.filter((r) => r.answer === "NOT_APPLICABLE").length,
  }, "Question audit complete");

  return results;
}
