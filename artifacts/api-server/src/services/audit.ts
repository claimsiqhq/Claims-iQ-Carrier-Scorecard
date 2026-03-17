import { openai } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import { promptSettings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SYSTEM_PROMPT as DEFAULT_SYSTEM, USER_PROMPT_TEMPLATE as DEFAULT_USER } from "./prompts";

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
  console.log("Running audit...");

  const { systemPrompt, userTemplate } = await getPrompts();
  const userPrompt = userTemplate.replace("{{REPORT}}", reportText);

  const response = await openai.chat.completions.create({
    model: "gpt-5",
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
    console.log("Audit complete");
    return parsed;
  } catch (err) {
    console.error("Invalid JSON from OpenAI:", content);
    throw new Error("Failed to parse AI response");
  }
}
