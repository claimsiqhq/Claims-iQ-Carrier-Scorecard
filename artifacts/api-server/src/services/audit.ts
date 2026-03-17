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
    model: "gpt-5",
    temperature: 0,
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty AI response");
  }

  const cleaned = content
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as AuditResponse;

    parsed.technical_score = parsed.technical_score ?? 0;
    parsed.presentation_score = parsed.presentation_score ?? 0;
    parsed.presentation_issues = parsed.presentation_issues ?? [];

    const ss = parsed.section_scores;
    ss.file_stack_order = ss.file_stack_order ?? 0;
    ss.payment_match = ss.payment_match ?? 0;
    ss.estimate_operational_order = ss.estimate_operational_order ?? 0;
    ss.photo_organization = ss.photo_organization ?? 0;
    ss.da_report_quality = ss.da_report_quality ?? 0;
    ss.fa_report_quality = ss.fa_report_quality ?? 0;
    ss.policy_provisions = ss.policy_provisions ?? 0;

    console.log("Audit completed — OpenAI response parsed");
    return parsed;
  } catch (err) {
    console.error("Invalid JSON from OpenAI:", content);
    throw new Error("Failed to parse AI response");
  }
}
