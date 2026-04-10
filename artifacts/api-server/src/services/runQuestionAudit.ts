import { openai } from "@workspace/integrations-openai-ai-server";
import { DA_QUESTIONS, FA_QUESTIONS, type Question, type QuestionResult, type Answer } from "./questionBank";
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from "./prompts";
import { getCarrierRuleset } from "./carrierRulesetService";
import logger from "../lib/logger";

const VALID_ANSWERS: Answer[] = ["PASS", "PARTIAL", "FAIL", "NOT_APPLICABLE"];

const BATCH_THRESHOLD = 15;

export interface QuestionAuditOutput {
  denial_letter_applicable: boolean;
  da_results: QuestionResult[];
  fa_results: QuestionResult[];
  executive_summary: string;
  da_questions: Question[];
  fa_questions: Question[];
}

function normalizeResult(questions: Question[], rawResults: any[]): QuestionResult[] {
  return questions.map((q) => {
    const match = rawResults.find((r: any) => r?.id === q.id);
    if (!match) {
      return {
        id: q.id,
        answer: "FAIL" as Answer,
        points_awarded: 0,
        points_possible: q.weight,
        root_issue: "",
        issue: "Question not answered by AI",
        impact: "",
        fix: "",
        evidence_locations: [],
        confidence: 0,
      };
    }

    const answer: Answer = VALID_ANSWERS.includes(match.answer) ? match.answer : "FAIL";
    const root_issue = typeof match.root_issue === "string" ? match.root_issue : "";
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
      root_issue,
      issue,
      impact,
      fix,
      evidence_locations,
      confidence,
    };
  });
}

function buildFallback(daQuestions: Question[], faQuestions: Question[]): QuestionAuditOutput {
  return {
    denial_letter_applicable: false,
    da_results: daQuestions.map((q) => ({
      id: q.id,
      answer: "FAIL" as Answer,
      points_awarded: 0,
      points_possible: q.weight,
      root_issue: "",
      issue: "Audit processing failed",
      impact: "",
      fix: "",
      evidence_locations: [],
      confidence: 0,
    })),
    fa_results: faQuestions.map((q) => ({
      id: q.id,
      answer: "FAIL" as Answer,
      points_awarded: 0,
      points_possible: q.weight,
      root_issue: "",
      issue: "Audit processing failed",
      impact: "",
      fix: "",
      evidence_locations: [],
      confidence: 0,
    })),
    executive_summary: "The audit could not be completed successfully.",
    da_questions: daQuestions,
    fa_questions: faQuestions,
  };
}

function repairJson(raw: string): any | null {
  let s = raw
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  try { return JSON.parse(s); } catch {}

  s = s.replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(s); } catch {}

  const lastBrace = s.lastIndexOf("}");
  const lastBracket = s.lastIndexOf("]");
  if (lastBrace > 0 || lastBracket > 0) {
    let truncated = s.substring(0, Math.max(lastBrace, lastBracket) + 1);
    const openBraces = (truncated.match(/\{/g) || []).length;
    const closeBraces = (truncated.match(/\}/g) || []).length;
    const openBrackets = (truncated.match(/\[/g) || []).length;
    const closeBrackets = (truncated.match(/\]/g) || []).length;
    truncated += "]".repeat(Math.max(0, openBrackets - closeBrackets));
    truncated += "}".repeat(Math.max(0, openBraces - closeBraces));
    try { return JSON.parse(truncated); } catch {}
  }

  return null;
}

function groupQuestionsByCategory(questions: Question[]): Map<string, Question[]> {
  const groups = new Map<string, Question[]>();
  for (const q of questions) {
    const key = q.categoryKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(q);
  }
  return groups;
}

const BATCH_SYSTEM_PROMPT = `You are a carrier-grade insurance audit assistant evaluating a finalized claim file.

You must evaluate a SUBSET of audit questions from a scorecard.

For each question, you must return:
- answer: PASS, PARTIAL, FAIL, or NOT_APPLICABLE
- root_issue: a short snake_case grouping key for the underlying problem
- issue: specific problem found (empty if PASS)
- impact: why it matters to the carrier (empty if PASS)
- fix: exact actionable fix the adjuster must take (empty if PASS)
- evidence_locations: where in the document evidence was found
- confidence: 0-100

CRITICAL RULES:
- Be strict, objective, and carrier-specific.
- DO NOT assign scores — only answer questions.
- "fix" must be executable and specific.
- "issue" must describe the specific problem, not restate the question.
- "impact" must explain the business consequence if not fixed.
- For PASS answers: set root_issue, issue, impact, fix to empty strings.
- You MUST answer EVERY question listed below. Do not skip any.
- Return JSON only. No markdown, no code fences.`;

function buildBatchUserPrompt(questions: Question[], categoryLabel: string, reportText: string): string {
  const qText = questions.map((q) => `- ${q.id}: ${q.text}`).join("\n");
  return `Evaluate the following finalized claim report for the "${categoryLabel}" category.

Answer EVERY question below. Do NOT skip any question.

For EACH question return a JSON object:
{
  "id": "<question_id>",
  "answer": "PASS | PARTIAL | FAIL | NOT_APPLICABLE",
  "root_issue": "<snake_case_grouping_key>",
  "issue": "",
  "impact": "",
  "fix": "",
  "evidence_locations": ["<section or page reference>"],
  "confidence": 0
}

Return this exact JSON structure:
{
  "results": [
    { question results here }
  ]
}

=== QUESTIONS (${questions.length}) ===

${qText}

=== REPORT PACKAGE ===

${reportText}`;
}

async function callOpenAIForBatch(
  systemPrompt: string,
  userPrompt: string,
  questionCount: number,
  categoryKey: string,
  attempt: number = 1,
): Promise<any[]> {
  const maxTokens = Math.max(4096, questionCount * 350);
  let response;
  try {
    response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }, { signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    logger.error({ err, categoryKey, attempt }, "Batch OpenAI request failed");
    if (attempt < 2) {
      logger.info({ categoryKey }, "Retrying batch after failure");
      return callOpenAIForBatch(systemPrompt, userPrompt, questionCount, categoryKey, attempt + 1);
    }
    return [];
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    logger.error({ categoryKey, attempt }, "Empty AI response for batch");
    if (attempt < 2) {
      return callOpenAIForBatch(systemPrompt, userPrompt, questionCount, categoryKey, attempt + 1);
    }
    return [];
  }

  let parsed = repairJson(content);
  if (!parsed) {
    logger.error({ categoryKey, attempt, contentPreview: content.substring(0, 300) }, "Batch audit: invalid JSON");
    if (attempt < 2) {
      logger.info({ categoryKey }, "Retrying batch after JSON failure");
      return callOpenAIForBatch(systemPrompt, userPrompt, questionCount, categoryKey, attempt + 1);
    }
    return [];
  }

  const results = Array.isArray(parsed.results) ? parsed.results
    : Array.isArray(parsed.da_results) ? parsed.da_results
    : Array.isArray(parsed.fa_results) ? parsed.fa_results
    : Array.isArray(parsed) ? parsed
    : [];

  logger.info({ categoryKey, answeredCount: results.length, expectedCount: questionCount, attempt }, "Batch audit results received");
  return results;
}

async function runBatchedAudit(
  daQuestions: Question[],
  faQuestions: Question[],
  reportText: string,
  systemPromptOverride?: string,
): Promise<{ daRaw: any[]; faRaw: any[]; denialApplicable: boolean; executiveSummary: string }> {
  const sysPrompt = systemPromptOverride ?? BATCH_SYSTEM_PROMPT;

  const daCategoryGroups = groupQuestionsByCategory(daQuestions);
  const faCategoryGroups = groupQuestionsByCategory(faQuestions);

  const batchJobs: { scorecard: "da" | "fa"; categoryKey: string; categoryName: string; questions: Question[] }[] = [];

  for (const [catKey, questions] of daCategoryGroups) {
    batchJobs.push({ scorecard: "da", categoryKey: catKey, categoryName: questions[0]?.categoryName ?? catKey, questions });
  }
  for (const [catKey, questions] of faCategoryGroups) {
    batchJobs.push({ scorecard: "fa", categoryKey: catKey, categoryName: questions[0]?.categoryName ?? catKey, questions });
  }

  logger.info({
    totalBatches: batchJobs.length,
    daBatches: daCategoryGroups.size,
    faBatches: faCategoryGroups.size,
    totalQuestions: daQuestions.length + faQuestions.length,
  }, "Starting batched audit calls");

  const CONCURRENCY = 10;
  const allResults: { scorecard: "da" | "fa"; results: any[] }[] = [];

  for (let i = 0; i < batchJobs.length; i += CONCURRENCY) {
    const batch = batchJobs.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (job) => {
      const userPrompt = buildBatchUserPrompt(job.questions, job.categoryName, reportText);
      const results = await callOpenAIForBatch(sysPrompt, userPrompt, job.questions.length, job.categoryKey);
      return { scorecard: job.scorecard, results };
    });
    const batchResults = await Promise.all(promises);
    allResults.push(...batchResults);
  }

  const daRaw: any[] = [];
  const faRaw: any[] = [];
  for (const r of allResults) {
    if (r.scorecard === "da") daRaw.push(...r.results);
    else faRaw.push(...r.results);
  }

  let denialApplicable = false;
  let executiveSummary = "";

  try {
    const summaryResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 1024,
      messages: [
        { role: "system", content: "You are an insurance audit assistant. Based on the audit results provided, generate a concise executive summary and determine if a denial letter is applicable. Return JSON only, no markdown." },
        { role: "user", content: `Based on the following audit question results for an insurance claim, provide:
1. Whether a denial letter is applicable (true/false)
2. A concise 2-3 sentence executive summary stating overall readiness, key root issues, and what needs to happen next.

Return this exact JSON:
{
  "denial_letter_applicable": true | false,
  "executive_summary": "<summary>"
}

DA Results (${daRaw.length} answers):
${JSON.stringify(daRaw.map(r => ({ id: r.id, answer: r.answer, root_issue: r.root_issue, issue: r.issue })), null, 0)}

FA Results (${faRaw.length} answers):
${JSON.stringify(faRaw.map(r => ({ id: r.id, answer: r.answer, root_issue: r.root_issue, issue: r.issue })), null, 0)}` },
      ],
    }, { signal: AbortSignal.timeout(30_000) });

    const summaryContent = summaryResponse.choices[0]?.message?.content;
    if (summaryContent) {
      const summaryParsed = repairJson(summaryContent);
      if (summaryParsed) {
        denialApplicable = typeof summaryParsed.denial_letter_applicable === "boolean" ? summaryParsed.denial_letter_applicable : false;
        executiveSummary = typeof summaryParsed.executive_summary === "string" ? summaryParsed.executive_summary : "";
      }
    }
  } catch (err) {
    logger.warn({ err }, "Executive summary generation failed");
  }

  return { daRaw, faRaw, denialApplicable, executiveSummary };
}

export async function runQuestionAudit(reportText: string, carrier?: string): Promise<QuestionAuditOutput> {
  const ruleset = await getCarrierRuleset(carrier ?? "");
  const daQuestions = ruleset.da_questions;
  const faQuestions = ruleset.fa_questions;
  const systemPrompt = ruleset.system_prompt_override ?? SYSTEM_PROMPT;

  const totalQuestions = daQuestions.length + faQuestions.length;

  logger.info({
    carrier: carrier ?? "default",
    daQuestionCount: daQuestions.length,
    faQuestionCount: faQuestions.length,
  }, "Running DA/FA question-level audit");

  if (totalQuestions > BATCH_THRESHOLD) {
    logger.info({ totalQuestions, threshold: BATCH_THRESHOLD }, "Using batched audit mode");

    // FIX: Always pass the carrier-specific system prompt to batch mode.
    // Previously this used: systemPrompt !== SYSTEM_PROMPT ? systemPrompt : undefined
    // which dropped the carrier prompt when it matched the default, causing batch mode
    // to fall back to the generic BATCH_SYSTEM_PROMPT and lose all carrier-specific rules.
    // The carrier system_prompt_override contains critical evaluation rules (prior loss logic,
    // payment suppression, mitigation rules, etc.) that MUST reach every batch call.
    const { daRaw, faRaw, denialApplicable, executiveSummary } = await runBatchedAudit(
      daQuestions, faQuestions, reportText, systemPrompt,
    );

    const daResults = normalizeResult(daQuestions, daRaw);
    const faResults = normalizeResult(faQuestions, faRaw);

    const allResults = [...daResults, ...faResults];
    const unanswered = allResults.filter((r) => r.issue === "Question not answered by AI").length;
    logger.info({
      carrier: carrier ?? "default",
      denialApplicable,
      pass: allResults.filter((r) => r.answer === "PASS").length,
      partial: allResults.filter((r) => r.answer === "PARTIAL").length,
      fail: allResults.filter((r) => r.answer === "FAIL").length,
      na: allResults.filter((r) => r.answer === "NOT_APPLICABLE").length,
      unanswered,
    }, "DA/FA batched question audit complete");

    return { denial_letter_applicable: denialApplicable, da_results: daResults, fa_results: faResults, executive_summary: executiveSummary, da_questions: daQuestions, fa_questions: faQuestions };
  }

  const daQuestionsText = daQuestions.map((q) => `- ${q.id}: ${q.text}`).join("\n");
  const faQuestionsText = faQuestions.map((q) => `- ${q.id}: ${q.text}`).join("\n");

  const userPrompt = USER_PROMPT_TEMPLATE
    .replace("{{DA_QUESTIONS}}", daQuestionsText)
    .replace("{{FA_QUESTIONS}}", faQuestionsText)
    .replace("{{REPORT}}", reportText);

  let response;
  try {
    const maxTokens = totalQuestions > 20 ? 16384 : 8192;
    response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }, { signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    logger.error({ err }, "OpenAI request failed");
    return buildFallback(daQuestions, faQuestions);
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    logger.error("Empty AI response for question audit");
    return buildFallback(daQuestions, faQuestions);
  }

  let parsed = repairJson(content);
  if (!parsed) {
    logger.error({ contentPreview: content.substring(0, 300) }, "Question audit: invalid JSON, retrying once");
    try {
      const retryResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        max_completion_tokens: totalQuestions > 20 ? 16384 : 8192,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }, { signal: AbortSignal.timeout(120_000) });
      const retryContent = retryResponse.choices[0]?.message?.content;
      if (retryContent) parsed = repairJson(retryContent);
    } catch (retryErr) {
      logger.error({ retryErr }, "Retry also failed");
    }

    if (!parsed) {
      logger.error("Question audit: JSON repair and retry both failed");
      return buildFallback(daQuestions, faQuestions);
    }
  }

  const denialApplicable = typeof parsed.denial_letter_applicable === "boolean"
    ? parsed.denial_letter_applicable
    : false;

  const daRaw = Array.isArray(parsed.da_results) ? parsed.da_results : [];
  const faRaw = Array.isArray(parsed.fa_results) ? parsed.fa_results : [];

  const daResults = normalizeResult(daQuestions, daRaw);
  const faResults = normalizeResult(faQuestions, faRaw);

  const executiveSummary = typeof parsed.executive_summary === "string"
    ? parsed.executive_summary
    : "";

  const allResults = [...daResults, ...faResults];
  logger.info({
    carrier: carrier ?? "default",
    denialApplicable,
    pass: allResults.filter((r) => r.answer === "PASS").length,
    partial: allResults.filter((r) => r.answer === "PARTIAL").length,
    fail: allResults.filter((r) => r.answer === "FAIL").length,
    na: allResults.filter((r) => r.answer === "NOT_APPLICABLE").length,
  }, "DA/FA question audit complete");

  return { denial_letter_applicable: denialApplicable, da_results: daResults, fa_results: faResults, executive_summary: executiveSummary, da_questions: daQuestions, fa_questions: faQuestions };
}
