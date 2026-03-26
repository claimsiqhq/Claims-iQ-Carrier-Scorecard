import { z } from "zod";
import logger from "../lib/logger";
import { env } from "../env";
import { getPrompt } from "./promptLoader";
import { getCarrierRuleset } from "./carrierRulesetService";
import type { CarrierScorecardCategory } from "./carrierRulesetTypes";

export const CARRIER_SCORECARD_VERSION = "carrier_scorecard_v1" as const;

export const CARRIER_SCORECARD_CATEGORIES = [
  { id: "file_stack_order", label: "File Stack Order", max_score: 5 },
  { id: "payment_recommendations_match", label: "Payment Recommendations Match", max_score: 5 },
  { id: "estimate_operational_order", label: "Estimate is in operational order", max_score: 5 },
  { id: "photographs_clear_in_order", label: "Photographs are clear and in order", max_score: 5 },
  { id: "da_report_not_cumbersome", label: "DA report is not cumbersome", max_score: 5 },
  { id: "fa_report_detailed_enough", label: "FA report is detailed enough", max_score: 5 },
  { id: "unique_policy_provisions_addressed", label: "Unique Policy Provisions Addressed", max_score: 5 },
] as const;

export type CarrierCategoryId = (typeof CARRIER_SCORECARD_CATEGORIES)[number]["id"];

const CATEGORY_IDS = CARRIER_SCORECARD_CATEGORIES.map((c) => c.id) as [CarrierCategoryId, ...CarrierCategoryId[]];
const CATEGORY_STATUS = ["pass", "minor_issues", "major_issues", "missing_info"] as const;
const ISSUE_SEVERITY = ["low", "medium", "high"] as const;

const carrierCategoryRawSchema = z.object({
  id: z.enum(CATEGORY_IDS),
  status: z.enum(CATEGORY_STATUS),
  score: z.number().int().min(0).max(5),
  finding: z.string().min(1),
  evidence: z.array(z.string()),
  recommendations: z.array(z.string()),
}).strict();

const carrierIssueRawSchema = z.object({
  severity: z.enum(ISSUE_SEVERITY),
  category_id: z.enum(CATEGORY_IDS).optional(),
  title: z.string().min(1),
  description: z.string().min(1),
}).strict();

export const carrierScorecardRawSchema = z.object({
  overall: z.object({
    summary: z.string().min(1),
    confidence: z.number().min(0).max(1),
  }).strict(),
  categories: z.array(carrierCategoryRawSchema),
  issues: z.array(carrierIssueRawSchema),
  missing_info: z.array(z.string()),
  assumptions: z.array(z.string()),
}).strict();

export const carrierScorecardNormalizedSchema = z.object({
  version: z.literal(CARRIER_SCORECARD_VERSION),
  overall: z.object({
    total_score: z.number().int().min(0),
    max_score: z.number().int().min(1),
    percent: z.number().min(0).max(100),
    grade: z.enum(["A", "B", "C", "D", "F"]),
    summary: z.string(),
    confidence: z.number().min(0).max(1),
  }).strict(),
  categories: z.array(z.object({
    id: z.enum(CATEGORY_IDS),
    label: z.string(),
    max_score: z.literal(5),
    status: z.enum(CATEGORY_STATUS),
    score: z.number().int().min(0).max(5),
    finding: z.string(),
    evidence: z.array(z.string()),
    recommendations: z.array(z.string()),
  }).strict()),
  issues: z.array(z.object({
    severity: z.enum(ISSUE_SEVERITY),
    category_id: z.enum(CATEGORY_IDS).optional(),
    title: z.string(),
    description: z.string(),
  }).strict()),
  meta: z.object({
    model: z.string(),
    generated_at: z.string(),
    request_id: z.string(),
    validation_ok: z.boolean(),
  }).strict(),
}).strict();

export type CarrierScorecardAuditResult = z.infer<typeof carrierScorecardNormalizedSchema>;
type CarrierScorecardRaw = z.infer<typeof carrierScorecardRawSchema>;

function getGrade(percent: number): CarrierScorecardAuditResult["overall"]["grade"] {
  if (percent >= 90) return "A";
  if (percent >= 80) return "B";
  if (percent >= 70) return "C";
  if (percent >= 60) return "D";
  return "F";
}

function normalizePercent(totalScore: number, maxScore: number): number {
  return Math.round((totalScore / maxScore) * 1000) / 10;
}

function missingCategory(categoryId: CarrierCategoryId) {
  return {
    id: categoryId,
    status: "missing_info" as const,
    score: 0,
    finding: "No information provided in the final report.",
    evidence: [] as string[],
    recommendations: ["Review and complete this section."],
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function buildCarrierScorecardFallback(params: {
  requestId: string;
  model: string;
  reason: string;
  categories?: CarrierScorecardCategory[];
}): CarrierScorecardAuditResult {
  const cats = params.categories ?? CARRIER_SCORECARD_CATEGORIES;
  const categories = cats.map((c) => ({
    ...missingCategory(c.id as CarrierCategoryId),
    label: c.label,
    max_score: c.max_score as 5,
  }));

  return {
    version: CARRIER_SCORECARD_VERSION,
    overall: {
      total_score: 0,
      max_score: cats.length * 5,
      percent: 0,
      grade: "F",
      summary: "Audit could not be completed; fallback result returned.",
      confidence: 0,
    },
    categories,
    issues: [
      {
        severity: "high",
        title: "Carrier scorecard audit fallback",
        description: params.reason,
      },
    ],
    meta: {
      model: params.model,
      generated_at: nowIso(),
      request_id: params.requestId,
      validation_ok: false,
    },
  };
}

export function normalizeCarrierScorecard(
  parsed: CarrierScorecardRaw,
  context: { requestId: string; model: string; validationOk: boolean; categories?: CarrierScorecardCategory[] },
): CarrierScorecardAuditResult {
  const cats = context.categories ?? CARRIER_SCORECARD_CATEGORIES;
  const categoryMap = new Map(parsed.categories.map((c) => [c.id, c]));

  const categories = cats.map((base) => {
    const value = categoryMap.get(base.id as CarrierCategoryId) ?? missingCategory(base.id as CarrierCategoryId);
    return {
      id: base.id as CarrierCategoryId,
      label: base.label,
      max_score: base.max_score as 5,
      status: value.status,
      score: value.score,
      finding: value.finding,
      evidence: value.evidence,
      recommendations: value.recommendations,
    };
  });

  const maxScore = categories.reduce((sum, c) => sum + c.max_score, 0);
  const totalScore = categories.reduce((sum, c) => sum + c.score, 0);
  const percent = normalizePercent(totalScore, maxScore);
  const grade = getGrade(percent);

  const issues = [...parsed.issues];
  if (parsed.missing_info.length > 0) {
    issues.push({
      severity: "medium",
      title: "Missing information detected",
      description: parsed.missing_info.join(" | "),
    });
  }
  if (parsed.assumptions.length > 0) {
    issues.push({
      severity: "low",
      title: "Model assumptions were used",
      description: parsed.assumptions.join(" | "),
    });
  }

  return {
    version: CARRIER_SCORECARD_VERSION,
    overall: {
      total_score: totalScore,
      max_score: maxScore,
      percent,
      grade,
      summary: parsed.overall.summary,
      confidence: parsed.overall.confidence,
    },
    categories,
    issues,
    meta: {
      model: context.model,
      generated_at: nowIso(),
      request_id: context.requestId,
      validation_ok: context.validationOk,
    },
  };
}

export function parseCarrierScorecardJson(
  content: string,
  context: { requestId: string; model: string; categories?: CarrierScorecardCategory[] },
): CarrierScorecardAuditResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    return buildCarrierScorecardFallback({
      requestId: context.requestId,
      model: context.model,
      reason: "OpenAI response JSON parsing failed.",
      categories: context.categories,
    });
  }

  const validated = carrierScorecardRawSchema.safeParse(parsed);
  if (!validated.success) {
    logger.error({ requestId: context.requestId, issues: validated.error.issues }, "Carrier scorecard validation failed");
    return buildCarrierScorecardFallback({
      requestId: context.requestId,
      model: context.model,
      reason: "OpenAI response failed schema validation.",
      categories: context.categories,
    });
  }

  return normalizeCarrierScorecard(validated.data, {
    requestId: context.requestId,
    model: context.model,
    validationOk: true,
    categories: context.categories,
  });
}

export async function runCarrierScorecardAudit(input: {
  reportText: string;
  requestId: string;
  carrier?: string;
}): Promise<CarrierScorecardAuditResult> {
  const startedAt = Date.now();
  const model = env.OPENAI_CARRIER_AUDIT_MODEL;

  const ruleset = await getCarrierRuleset(input.carrier ?? "");
  const categories = ruleset.scorecard_categories;
  const promptOverride = ruleset.carrier_scorecard_prompt_override;

  try {
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const systemPrompt = promptOverride ?? await getPrompt("carrier_scorecard_v1");
    const response = await openai.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Review the final report package text below and return only the JSON structure.\n\nFinal Report Text:\n${input.reportText}`,
        },
      ],
    }, { signal: AbortSignal.timeout(120_000) });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      const fallback = buildCarrierScorecardFallback({
        requestId: input.requestId,
        model,
        reason: "OpenAI response was empty.",
        categories,
      });
      logger.warn({
        requestId: input.requestId,
        carrier: input.carrier ?? "default",
        model,
        durationMs: Date.now() - startedAt,
        validation_ok: false,
        score_total: fallback.overall.total_score,
        percent: fallback.overall.percent,
        grade: fallback.overall.grade,
        openai_request_id: response.id,
      }, "Carrier scorecard audit returned fallback");
      return fallback;
    }

    const result = parseCarrierScorecardJson(content, {
      requestId: input.requestId,
      model,
      categories,
    });

    logger.info({
      requestId: input.requestId,
      carrier: input.carrier ?? "default",
      model,
      durationMs: Date.now() - startedAt,
      validation_ok: result.meta.validation_ok,
      score_total: result.overall.total_score,
      percent: result.overall.percent,
      grade: result.overall.grade,
      openai_request_id: response.id,
    }, "Carrier scorecard audit completed");

    return result;
  } catch (err) {
    const fallback = buildCarrierScorecardFallback({
      requestId: input.requestId,
      model,
      reason: "OpenAI request failed during carrier scorecard audit.",
      categories,
    });

    logger.error({
      err,
      requestId: input.requestId,
      carrier: input.carrier ?? "default",
      model,
      durationMs: Date.now() - startedAt,
      validation_ok: false,
      score_total: fallback.overall.total_score,
      percent: fallback.overall.percent,
      grade: fallback.overall.grade,
    }, "Carrier scorecard audit request failed");

    return fallback;
  }
}
