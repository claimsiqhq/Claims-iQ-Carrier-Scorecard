import { openai } from "@workspace/integrations-openai-ai-server";
import { type Question, type QuestionResult, type Answer } from "./questionBank";
import {
  getCarrierRuleset,
  normalizeCarrierKey,
} from "./carrierRulesetService";
import type { CarrierRulesetConfig } from "./carrierRulesetTypes";
import {
  getAuditPromptSnapshot,
  type AuditPromptSnapshot,
} from "./auditPromptService";
import logger from "../lib/logger";
import { env } from "../env";

const VALID_ANSWERS: Answer[] = ["PASS", "PARTIAL", "FAIL", "NOT_APPLICABLE"];

const BATCH_THRESHOLD = 15;

export interface QuestionAuditOutput {
  denial_letter_applicable: boolean;
  da_results: QuestionResult[];
  fa_results: QuestionResult[];
  executive_summary: string;
  da_questions: Question[];
  fa_questions: Question[];
  provider_request_ids: string[];
}

export interface QuestionAuditConfiguration {
  carrierKey: string;
  ruleset: CarrierRulesetConfig;
  prompts: AuditPromptSnapshot;
}

export class QuestionAuditResponseError extends Error {
  readonly code = "question_audit_response_invalid";

  constructor(message: string) {
    super(message);
    this.name = "QuestionAuditResponseError";
  }
}

export async function resolveQuestionAuditConfiguration(
  carrier: string,
  organizationId?: string,
): Promise<QuestionAuditConfiguration> {
  const ruleset = await getCarrierRuleset(carrier, { allowDefault: false });
  const carrierKey = normalizeCarrierKey(carrier);
  const prompts = await getAuditPromptSnapshot(
    carrierKey,
    ruleset.system_prompt_override,
    organizationId,
  );
  return { carrierKey, ruleset, prompts };
}

export function normalizeQuestionResults(
  questions: Question[],
  rawResults: unknown[],
): QuestionResult[] {
  const requestedIds = new Set(questions.map((question) => question.id));
  const recognized = rawResults.filter(
    (result): result is Record<string, unknown> =>
      Boolean(
        result
        && typeof result === "object"
        && "id" in result
        && typeof result.id === "string"
        && requestedIds.has(result.id),
      ),
  );
  const responseIds = recognized.map((result) => result.id as string);
  const duplicates = responseIds.filter(
    (id, index) => responseIds.indexOf(id) !== index,
  );
  if (duplicates.length > 0) {
    throw new QuestionAuditResponseError(
      `The provider returned duplicate question IDs: ${[...new Set(duplicates)].join(", ")}.`,
    );
  }

  return questions.map((q) => {
    const match = recognized.find((result) => result.id === q.id);
    if (!match) {
      throw new QuestionAuditResponseError(
        `The provider omitted required question ${q.id}.`,
      );
    }

    if (
      typeof match.answer !== "string"
      || !VALID_ANSWERS.includes(match.answer as Answer)
    ) {
      throw new QuestionAuditResponseError(
        `The provider returned an invalid answer for ${q.id}.`,
      );
    }
    for (const field of ["root_issue", "issue", "impact", "fix"] as const) {
      if (typeof match[field] !== "string") {
        throw new QuestionAuditResponseError(
          `The provider returned an invalid ${field} value for ${q.id}.`,
        );
      }
    }
    if (
      !Array.isArray(match.evidence_locations)
      || match.evidence_locations.some((value) => typeof value !== "string")
    ) {
      throw new QuestionAuditResponseError(
        `The provider returned invalid evidence locations for ${q.id}.`,
      );
    }
    if (
      typeof match.confidence !== "number"
      || !Number.isFinite(match.confidence)
      || match.confidence < 0
      || match.confidence > 100
    ) {
      throw new QuestionAuditResponseError(
        `The provider returned invalid confidence for ${q.id}.`,
      );
    }

    return {
      id: q.id,
      answer: match.answer as Answer,
      points_awarded: 0,
      points_possible: q.weight,
      root_issue: match.root_issue as string,
      issue: match.issue as string,
      impact: match.impact as string,
      fix: match.fix as string,
      evidence_locations: match.evidence_locations as string[],
      confidence: match.confidence,
    };
  });
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
  const qText = questions
    .map((q) => [
      `- ${q.id}: ${q.text}`,
      q.applicability ? `  Applicability: ${q.applicability}` : "",
      q.severity ? `  Severity if failed: ${q.severity}` : "",
      q.sourceReference ? `  Approved source reference: ${q.sourceReference}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n");
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
  modelIdentifier: string,
  systemPrompt: string,
  userPrompt: string,
  questionCount: number,
  categoryKey: string,
  attempt: number = 1,
): Promise<{ results: any[]; responseId?: string }> {
  const maxTokens = Math.max(4096, questionCount * 350);
  let response;
  try {
    response = await openai.chat.completions.create({
      model: modelIdentifier,
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
      return callOpenAIForBatch(
        modelIdentifier,
        systemPrompt,
        userPrompt,
        questionCount,
        categoryKey,
        attempt + 1,
      );
    }
    throw new QuestionAuditResponseError(
      `The provider request failed for question batch ${categoryKey}.`,
    );
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    logger.error({ categoryKey, attempt }, "Empty AI response for batch");
    if (attempt < 2) {
      return callOpenAIForBatch(
        modelIdentifier,
        systemPrompt,
        userPrompt,
        questionCount,
        categoryKey,
        attempt + 1,
      );
    }
    throw new QuestionAuditResponseError(
      `The provider returned an empty response for question batch ${categoryKey}.`,
    );
  }

  let parsed = repairJson(content);
  if (!parsed) {
    logger.error(
      { categoryKey, attempt, responseCharacters: content.length },
      "Batch audit: invalid JSON",
    );
    if (attempt < 2) {
      logger.info({ categoryKey }, "Retrying batch after JSON failure");
      return callOpenAIForBatch(
        modelIdentifier,
        systemPrompt,
        userPrompt,
        questionCount,
        categoryKey,
        attempt + 1,
      );
    }
    throw new QuestionAuditResponseError(
      `The provider returned invalid JSON for question batch ${categoryKey}.`,
    );
  }

  const results = Array.isArray(parsed.results) ? parsed.results
    : Array.isArray(parsed.da_results) ? parsed.da_results
    : Array.isArray(parsed.fa_results) ? parsed.fa_results
    : Array.isArray(parsed) ? parsed
    : [];

  logger.info({ categoryKey, answeredCount: results.length, expectedCount: questionCount, attempt }, "Batch audit results received");
  return { results, responseId: response.id };
}

async function runBatchedAudit(
  daQuestions: Question[],
  faQuestions: Question[],
  reportText: string,
  systemPromptOverride?: string,
  modelIdentifier: string = env.OPENAI_CARRIER_AUDIT_MODEL,
): Promise<{
  daRaw: any[];
  faRaw: any[];
  denialApplicable: boolean;
  executiveSummary: string;
  providerRequestIds: string[];
}> {
  const sysPrompt = [BATCH_SYSTEM_PROMPT, systemPromptOverride]
    .filter(Boolean)
    .join("\n\n");

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
  const allResults: {
    scorecard: "da" | "fa";
    results: any[];
    responseId?: string;
  }[] = [];

  for (let i = 0; i < batchJobs.length; i += CONCURRENCY) {
    const batch = batchJobs.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (job) => {
      const userPrompt = buildBatchUserPrompt(job.questions, job.categoryName, reportText);
      const response = await callOpenAIForBatch(
        modelIdentifier,
        sysPrompt,
        userPrompt,
        job.questions.length,
        job.categoryKey,
      );
      return {
        scorecard: job.scorecard,
        results: response.results,
        responseId: response.responseId,
      };
    });
    const batchResults = await Promise.all(promises);
    allResults.push(...batchResults);
  }

  const daRaw: any[] = [];
  const faRaw: any[] = [];
  const providerRequestIds: string[] = [];
  for (const r of allResults) {
    if (r.scorecard === "da") daRaw.push(...r.results);
    else faRaw.push(...r.results);
    if (r.responseId) providerRequestIds.push(r.responseId);
  }

  let denialApplicable: boolean | null = null;
  let executiveSummary = "";

  try {
    const summaryResponse = await openai.chat.completions.create({
      model: modelIdentifier,
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
    if (summaryResponse.id) providerRequestIds.push(summaryResponse.id);
    if (summaryContent) {
      const summaryParsed = repairJson(summaryContent);
      if (summaryParsed) {
        denialApplicable = typeof summaryParsed.denial_letter_applicable === "boolean"
          ? summaryParsed.denial_letter_applicable
          : null;
        executiveSummary = typeof summaryParsed.executive_summary === "string" ? summaryParsed.executive_summary : "";
      }
    }
  } catch (err) {
    logger.warn({ err }, "Executive summary generation failed");
    throw new Error("Audit summary provider failed.", { cause: err });
  }

  if (denialApplicable === null || !executiveSummary.trim()) {
    throw new Error(
      "Audit summary provider returned incomplete applicability evidence.",
    );
  }

  return {
    daRaw,
    faRaw,
    denialApplicable,
    executiveSummary,
    providerRequestIds,
  };
}

export async function runQuestionAudit(
  reportText: string,
  carrier: string,
  configuration?: QuestionAuditConfiguration,
): Promise<QuestionAuditOutput> {
  const resolved = configuration
    ?? await resolveQuestionAuditConfiguration(carrier);
  const { ruleset, prompts, carrierKey } = resolved;
  const daQuestions = ruleset.da_questions;
  const faQuestions = ruleset.fa_questions;
  const systemPrompt = prompts.systemPrompt;

  const totalQuestions = daQuestions.length + faQuestions.length;

  logger.info({
    carrierKey,
    daQuestionCount: daQuestions.length,
    faQuestionCount: faQuestions.length,
  }, "Running DA/FA question-level audit");

  if (totalQuestions > BATCH_THRESHOLD) {
    logger.info({ totalQuestions, threshold: BATCH_THRESHOLD }, "Using batched audit mode");

    const {
      daRaw,
      faRaw,
      denialApplicable,
      executiveSummary,
      providerRequestIds,
    } = await runBatchedAudit(
      daQuestions,
      faQuestions,
      reportText,
      systemPrompt,
      prompts.modelIdentifier,
    );

    const daResults = normalizeQuestionResults(daQuestions, daRaw);
    const faResults = normalizeQuestionResults(faQuestions, faRaw);

    const allResults = [...daResults, ...faResults];
    logger.info({
      carrierKey,
      denialApplicable,
      pass: allResults.filter((r) => r.answer === "PASS").length,
      partial: allResults.filter((r) => r.answer === "PARTIAL").length,
      fail: allResults.filter((r) => r.answer === "FAIL").length,
      na: allResults.filter((r) => r.answer === "NOT_APPLICABLE").length,
    }, "DA/FA batched question audit complete");

    return {
      denial_letter_applicable: denialApplicable,
      da_results: daResults,
      fa_results: faResults,
      executive_summary: executiveSummary,
      da_questions: daQuestions,
      fa_questions: faQuestions,
      provider_request_ids: providerRequestIds,
    };
  }

  const formatQuestion = (question: Question) => [
    `- ${question.id}: ${question.text}`,
    question.applicability ? `  Applicability: ${question.applicability}` : "",
    question.severity ? `  Severity if failed: ${question.severity}` : "",
    question.sourceReference
      ? `  Approved source reference: ${question.sourceReference}`
      : "",
  ].filter(Boolean).join("\n");
  const daQuestionsText = daQuestions.map(formatQuestion).join("\n");
  const faQuestionsText = faQuestions.map(formatQuestion).join("\n");

  const userPrompt = prompts.userPromptTemplate
    .replace("{{DA_QUESTIONS}}", daQuestionsText)
    .replace("{{FA_QUESTIONS}}", faQuestionsText)
    .replace("{{REPORT}}", reportText);

  let response;
  const providerRequestIds: string[] = [];
  try {
    const maxTokens = totalQuestions > 20 ? 16384 : 8192;
    response = await openai.chat.completions.create({
      model: prompts.modelIdentifier,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }, { signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    logger.error({ err }, "OpenAI request failed");
    throw new Error("Audit question provider failed.", { cause: err });
  }
  if (response.id) providerRequestIds.push(response.id);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    logger.error("Empty AI response for question audit");
    throw new Error("Audit question provider returned an empty response.");
  }

  let parsed = repairJson(content);
  if (!parsed) {
    logger.error(
      { responseCharacters: content.length },
      "Question audit: invalid JSON, retrying once",
    );
    try {
      const retryResponse = await openai.chat.completions.create({
        model: prompts.modelIdentifier,
        max_completion_tokens: totalQuestions > 20 ? 16384 : 8192,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }, { signal: AbortSignal.timeout(120_000) });
      if (retryResponse.id) providerRequestIds.push(retryResponse.id);
      const retryContent = retryResponse.choices[0]?.message?.content;
      if (retryContent) parsed = repairJson(retryContent);
    } catch (retryErr) {
      logger.error({ retryErr }, "Retry also failed");
    }

    if (!parsed) {
      logger.error("Question audit: JSON repair and retry both failed");
      throw new Error("Audit question provider returned invalid JSON.");
    }
  }

  if (typeof parsed.denial_letter_applicable !== "boolean") {
    throw new Error(
      "Audit question provider omitted denial-letter applicability.",
    );
  }
  const denialApplicable = parsed.denial_letter_applicable;

  const daRaw = Array.isArray(parsed.da_results) ? parsed.da_results : [];
  const faRaw = Array.isArray(parsed.fa_results) ? parsed.fa_results : [];

  const daResults = normalizeQuestionResults(daQuestions, daRaw);
  const faResults = normalizeQuestionResults(faQuestions, faRaw);

  const executiveSummary = typeof parsed.executive_summary === "string"
    ? parsed.executive_summary
    : "";
  if (!executiveSummary.trim()) {
    throw new Error("Audit question provider omitted the executive summary.");
  }

  const allResults = [...daResults, ...faResults];
  logger.info({
    carrierKey,
    denialApplicable,
    pass: allResults.filter((r) => r.answer === "PASS").length,
    partial: allResults.filter((r) => r.answer === "PARTIAL").length,
    fail: allResults.filter((r) => r.answer === "FAIL").length,
    na: allResults.filter((r) => r.answer === "NOT_APPLICABLE").length,
  }, "DA/FA question audit complete");

  return {
    denial_letter_applicable: denialApplicable,
    da_results: daResults,
    fa_results: faResults,
    executive_summary: executiveSummary,
    da_questions: daQuestions,
    fa_questions: faQuestions,
    provider_request_ids: providerRequestIds,
  };
}
