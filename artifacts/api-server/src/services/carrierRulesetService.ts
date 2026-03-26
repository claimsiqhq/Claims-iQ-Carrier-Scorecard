import { db, carrierRulesets } from "@workspace/db";
import { eq } from "drizzle-orm";
import logger from "../lib/logger";
import { DA_QUESTIONS, FA_QUESTIONS } from "./questionBank";
import { CARRIER_SCORECARD_CATEGORIES } from "./carrierScorecardAudit";
import type { CarrierRulesetConfig } from "./carrierRulesetTypes";
import { carrierRulesetConfigSchema } from "./carrierRulesetTypes";

function getDefaultRuleset(): CarrierRulesetConfig {
  return {
    version: "1.0",
    da_questions: DA_QUESTIONS,
    fa_questions: FA_QUESTIONS,
    scorecard_categories: CARRIER_SCORECARD_CATEGORIES.map((c) => ({ ...c })),
  };
}

export function normalizeCarrierKey(carrier: string): string {
  return carrier.trim().toLowerCase().replace(/\s+/g, "_");
}

export async function getCarrierRuleset(carrierName: string): Promise<CarrierRulesetConfig> {
  if (!carrierName) return getDefaultRuleset();

  const key = normalizeCarrierKey(carrierName);

  try {
    const [row] = await db
      .select({ ruleset: carrierRulesets.ruleset })
      .from(carrierRulesets)
      .where(eq(carrierRulesets.carrierKey, key))
      .limit(1);

    if (row?.ruleset) {
      const parsed = carrierRulesetConfigSchema.safeParse(row.ruleset);
      if (parsed.success) {
        return parsed.data;
      }
      logger.warn({ carrierKey: key, issues: parsed.error.issues }, "Carrier ruleset validation failed, using defaults");
    }
  } catch (err) {
    logger.warn({ err, carrierKey: key }, "Carrier ruleset lookup failed, using defaults");
  }

  return getDefaultRuleset();
}

export async function listActiveCarriers(): Promise<{ key: string; displayName: string; logoUrl: string | null }[]> {
  try {
    const rows = await db
      .select({
        key: carrierRulesets.carrierKey,
        displayName: carrierRulesets.displayName,
        logoUrl: carrierRulesets.logoUrl,
      })
      .from(carrierRulesets)
      .where(eq(carrierRulesets.active, true));
    return rows;
  } catch (err) {
    logger.warn({ err }, "Failed to list carriers");
    return [];
  }
}
