import { z } from "zod";
import type { Question } from "./questionBank";

export interface CarrierScorecardCategory {
  id: string;
  label: string;
  max_score: number;
}

export interface CarrierRulesetConfig {
  version: string;
  da_questions: Question[];
  fa_questions: Question[];
  scorecard_categories: CarrierScorecardCategory[];
  system_prompt_override?: string;
  carrier_scorecard_prompt_override?: string;
}

const questionSchema = z.object({
  id: z.string(),
  text: z.string(),
  weight: z.number().int().min(0).max(100),
  weightIfNoDenial: z.number().int().min(0).max(100).optional(),
  section: z.string(),
  scorecard: z.enum(["DA", "FA"]),
  categoryKey: z.string(),
  categoryName: z.string(),
});

const scorecardCategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  max_score: z.number().int().positive(),
});

export const carrierRulesetConfigSchema = z.object({
  version: z.string(),
  da_questions: z.array(questionSchema).min(1),
  fa_questions: z.array(questionSchema).min(1),
  scorecard_categories: z.array(scorecardCategorySchema).min(1),
  system_prompt_override: z.string().optional(),
  carrier_scorecard_prompt_override: z.string().optional(),
});
