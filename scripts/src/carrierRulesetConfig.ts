/**
 * Structural mirror of the server-side carrier ruleset contract.
 *
 * The authoritative runtime validator is
 * `artifacts/api-server/src/services/carrierRulesetTypes.ts`
 * (`carrierRulesetConfigSchema`). The scripts package cannot import from the
 * api-server package, so the shape is repeated here; the migration drift test
 * in `artifacts/api-server/src/migrations/assurantTenantRulesets.test.ts`
 * validates every ruleset exported from this directory against the real schema.
 */

export type CarrierScorecard = "DA" | "FA";

export type CarrierQuestionSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

export interface CarrierQuestion {
  /** Stable snake_case identifier, prefixed `fa_` or `da_`. */
  id: string;
  text: string;
  /** Points possible (integer, 0-100). */
  weight: number;
  /** Desk-adjuster alternate weight applied when the claim has no denial. */
  weightIfNoDenial?: number;
  section: string;
  scorecard: CarrierScorecard;
  categoryKey: string;
  categoryName: string;
  /** Guidance describing when the check applies or must be NOT_APPLICABLE. */
  applicability?: string;
  severity?: CarrierQuestionSeverity;
  sourceReference?: string;
}

export interface CarrierScorecardCategory {
  id: string;
  label: string;
  max_score: number;
}

export interface CarrierRulesetConfig {
  version: string;
  da_questions: CarrierQuestion[];
  fa_questions: CarrierQuestion[];
  scorecard_categories: CarrierScorecardCategory[];
  system_prompt_override?: string;
  carrier_scorecard_prompt_override?: string;
}

/** Tenant-level profile facts that live beside the ruleset JSON in the database. */
export interface CarrierProfileFacts {
  carrierKey: string;
  displayName: string;
  logoUrl: string | null;
}
