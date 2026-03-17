import { openai } from "@workspace/integrations-openai-ai-server";
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from "./prompts";

export interface AuditResponse {
  overall_score: number;
  section_scores: {
    coverage_clarity: number;
    scope_completeness: number;
    estimate_accuracy: number;
    documentation_support: number;
    financial_accuracy: number;
    carrier_risk: number;
  };
  risk_level: string;
  approval_status: string;
  critical_failures: string[];
  key_defects: string[];
  carrier_questions: string[];
  deferred_items: string[];
  invoice_adjustments: string[];
  scope_deviations: string[];
  unknowns: string[];
  executive_summary: string;
}

export async function runFinalAudit(reportText: string): Promise<AuditResponse> {
  console.log("Running audit...");

  const userPrompt = USER_PROMPT_TEMPLATE.replace("{{REPORT}}", reportText);

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
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
    console.log("Audit complete");
    return parsed;
  } catch (err) {
    console.error("Invalid JSON from OpenAI:", content);
    throw new Error("Failed to parse AI response");
  }
}
