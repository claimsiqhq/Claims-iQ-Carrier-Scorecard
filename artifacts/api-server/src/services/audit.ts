import { openai } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import { promptSettings } from "@workspace/db";
import { SYSTEM_PROMPT as DEFAULT_SYSTEM, USER_PROMPT_TEMPLATE as DEFAULT_USER } from "./prompts";

export interface SectionScores {
  coverage_clarity: number;
  scope_completeness: number;
  estimate_accuracy: number;
  documentation_support: number;
  financial_accuracy: number;
  carrier_risk: number;
  file_stack_order: number;
  payment_match: number;
  estimate_operational_order: number;
  photo_organization: number;
  da_report_quality: number;
  fa_report_quality: number;
  policy_provisions: number;
}

export interface AuditResponse {
  overall_score: number;
  technical_score: number;
  presentation_score: number;
  section_scores: SectionScores;
  risk_level: string;
  approval_status: string;
  critical_failures: string[];
  key_defects: string[];
  presentation_issues: string[];
  carrier_questions: string[];
  deferred_items: string[];
  invoice_adjustments: string[];
  scope_deviations: string[];
  unknowns: string[];
  executive_summary: string;
}

export function validateAuditResult(data: any): data is AuditResponse {
  if (!data || typeof data !== "object") return false;

  const requiredFields = [
    "overall_score",
    "technical_score",
    "presentation_score",
    "section_scores",
    "risk_level",
    "approval_status",
    "executive_summary",
  ];

  for (const field of requiredFields) {
    if (!(field in data)) return false;
  }

  if (typeof data.overall_score !== "number") return false;
  if (typeof data.technical_score !== "number") return false;
  if (typeof data.presentation_score !== "number") return false;
  if (typeof data.section_scores !== "object" || data.section_scores === null) return false;
  if (typeof data.executive_summary !== "string") return false;

  const validRisk = ["LOW", "MEDIUM", "HIGH"];
  if (!validRisk.includes(data.risk_level)) return false;

  const validStatus = ["APPROVE", "APPROVE WITH MINOR CHANGES", "REQUIRES REVIEW", "REJECT"];
  if (!validStatus.includes(data.approval_status)) return false;

  const requiredSections = [
    "coverage_clarity", "scope_completeness", "estimate_accuracy",
    "documentation_support", "financial_accuracy", "carrier_risk",
    "file_stack_order", "payment_match", "estimate_operational_order",
    "photo_organization", "da_report_quality", "fa_report_quality",
    "policy_provisions",
  ];
  for (const key of requiredSections) {
    if (!(key in data.section_scores) || typeof data.section_scores[key] !== "number") return false;
  }

  return true;
}

export function getFallbackAudit(): AuditResponse {
  return { ...FALLBACK_RESULT };
}

export const FALLBACK_RESULT: AuditResponse = {
  overall_score: 0,
  technical_score: 0,
  presentation_score: 0,
  section_scores: {
    coverage_clarity: 0,
    scope_completeness: 0,
    estimate_accuracy: 0,
    documentation_support: 0,
    financial_accuracy: 0,
    carrier_risk: 0,
    file_stack_order: 0,
    payment_match: 0,
    estimate_operational_order: 0,
    photo_organization: 0,
    da_report_quality: 0,
    fa_report_quality: 0,
    policy_provisions: 0,
  },
  risk_level: "HIGH",
  approval_status: "REQUIRES REVIEW",
  critical_failures: ["Audit processing failed"],
  key_defects: [],
  presentation_issues: [],
  carrier_questions: [],
  deferred_items: [],
  invoice_adjustments: [],
  scope_deviations: [],
  unknowns: [],
  executive_summary: "The audit could not be completed successfully.",
};

async function getPrompts(): Promise<{ systemPrompt: string; userTemplate: string }> {
  try {
    const rows = await db.select().from(promptSettings);
    const systemRow = rows.find((r) => r.key === "system_prompt");
    const userRow = rows.find((r) => r.key === "user_prompt_template");

    const userTemplate = userRow?.value ?? DEFAULT_USER;

    return {
      systemPrompt: systemRow?.value ?? DEFAULT_SYSTEM,
      userTemplate: userTemplate.includes("{{REPORT}}") ? userTemplate : DEFAULT_USER,
    };
  } catch {
    return {
      systemPrompt: DEFAULT_SYSTEM,
      userTemplate: DEFAULT_USER,
    };
  }
}

export async function runFinalAudit(reportText: string): Promise<AuditResponse> {
  console.log("Audit started");

  const { systemPrompt, userTemplate } = await getPrompts();
  const userPrompt = userTemplate.replace("{{REPORT}}", reportText);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  }, { signal: AbortSignal.timeout(120_000) });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    console.error("Empty AI response — returning fallback");
    return getFallbackAudit();
  }

  const cleaned = content
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error("Raw AI response (not valid JSON):", content);
    return getFallbackAudit();
  }

  if (!validateAuditResult(parsed)) {
    console.error("Invalid audit structure:", JSON.stringify(parsed).substring(0, 500));
    return getFallbackAudit();
  }

  parsed.technical_score = parsed.technical_score ?? 0;
  parsed.presentation_score = parsed.presentation_score ?? 0;
  parsed.overall_score = parsed.technical_score + parsed.presentation_score;

  parsed.critical_failures = Array.isArray(parsed.critical_failures) ? parsed.critical_failures : [];
  parsed.key_defects = Array.isArray(parsed.key_defects) ? parsed.key_defects : [];
  parsed.presentation_issues = Array.isArray(parsed.presentation_issues) ? parsed.presentation_issues : [];
  parsed.carrier_questions = Array.isArray(parsed.carrier_questions) ? parsed.carrier_questions : [];
  parsed.deferred_items = Array.isArray(parsed.deferred_items) ? parsed.deferred_items : [];
  parsed.invoice_adjustments = Array.isArray(parsed.invoice_adjustments) ? parsed.invoice_adjustments : [];
  parsed.scope_deviations = Array.isArray(parsed.scope_deviations) ? parsed.scope_deviations : [];
  parsed.unknowns = Array.isArray(parsed.unknowns) ? parsed.unknowns : [];

  const ss = parsed.section_scores;
  ss.coverage_clarity = ss.coverage_clarity ?? 0;
  ss.scope_completeness = ss.scope_completeness ?? 0;
  ss.estimate_accuracy = ss.estimate_accuracy ?? 0;
  ss.documentation_support = ss.documentation_support ?? 0;
  ss.financial_accuracy = ss.financial_accuracy ?? 0;
  ss.carrier_risk = ss.carrier_risk ?? 0;
  ss.file_stack_order = ss.file_stack_order ?? 0;
  ss.payment_match = ss.payment_match ?? 0;
  ss.estimate_operational_order = ss.estimate_operational_order ?? 0;
  ss.photo_organization = ss.photo_organization ?? 0;
  ss.da_report_quality = ss.da_report_quality ?? 0;
  ss.fa_report_quality = ss.fa_report_quality ?? 0;
  ss.policy_provisions = ss.policy_provisions ?? 0;

  console.log("Audit completed — OpenAI response parsed and validated");
  return parsed as AuditResponse;
}
