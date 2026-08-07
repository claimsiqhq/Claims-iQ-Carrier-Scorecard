import { db, carrierRulesets } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import logger from "../lib/logger";
import { DA_QUESTIONS, FA_QUESTIONS } from "./questionBank";
import { CARRIER_SCORECARD_CATEGORIES } from "./carrierScorecardAudit";
import type { CarrierRulesetConfig } from "./carrierRulesetTypes";
import { carrierRulesetConfigSchema } from "./carrierRulesetTypes";

export class CarrierRulesetUnavailableError extends Error {
  readonly code = "carrier_ruleset_unavailable";
  readonly carrierKey: string;

  constructor(carrierKey: string, message?: string) {
    super(message ?? `No valid published ruleset is available for ${carrierKey}.`);
    this.name = "CarrierRulesetUnavailableError";
    this.carrierKey = carrierKey;
  }
}

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

export async function getCarrierRuleset(
  carrierName: string,
  options: { allowDefault?: boolean } = {},
): Promise<CarrierRulesetConfig> {
  const allowDefault = options.allowDefault ?? true;
  if (!carrierName) {
    if (allowDefault) return getDefaultRuleset();
    throw new CarrierRulesetUnavailableError(
      "unidentified-carrier",
      "A carrier must be identified before an audit can be scored.",
    );
  }

  const key = normalizeCarrierKey(carrierName);

  try {
    const [row] = await db
      .select({ ruleset: carrierRulesets.ruleset })
      .from(carrierRulesets)
      .where(
        and(
          eq(carrierRulesets.carrierKey, key),
          eq(carrierRulesets.active, true),
        ),
      )
      .limit(1);

    if (row?.ruleset) {
      const parsed = carrierRulesetConfigSchema.safeParse(row.ruleset);
      if (parsed.success) {
        return parsed.data;
      }
      logger.warn(
        { carrierKey: key, issueCount: parsed.error.issues.length },
        "Carrier ruleset validation failed",
      );
      if (!allowDefault) {
        throw new CarrierRulesetUnavailableError(
          key,
          `The published ruleset for ${key} is invalid.`,
        );
      }
    }
  } catch (err) {
    if (err instanceof CarrierRulesetUnavailableError) throw err;
    logger.warn({ err, carrierKey: key }, "Carrier ruleset lookup failed");
    if (!allowDefault) {
      throw new CarrierRulesetUnavailableError(
        key,
        `The ruleset for ${key} could not be loaded.`,
      );
    }
  }

  if (!allowDefault) {
    throw new CarrierRulesetUnavailableError(key);
  }
  return getDefaultRuleset();
}

export async function listActiveCarriers(): Promise<{ key: string; displayName: string; logoUrl: string | null }[]> {
  return db
    .select({
      key: carrierRulesets.carrierKey,
      displayName: carrierRulesets.displayName,
      logoUrl: carrierRulesets.logoUrl,
    })
    .from(carrierRulesets)
    .where(eq(carrierRulesets.active, true));
}
