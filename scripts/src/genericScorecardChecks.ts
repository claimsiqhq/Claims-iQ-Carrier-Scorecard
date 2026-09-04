import type { CarrierQuestion } from "./carrierRulesetConfig";

/**
 * Field-adjuster checks that come from the generic scorecard
 * (`docs/sample generic scorecard.xlsx`, "Additional Context" column) and are
 * shared by every carrier ruleset. Keeping them in one place stops the
 * Assurant and Andover definitions from drifting apart.
 */

export const GENERIC_FA_SOURCE =
  "Generic FA scorecard (docs/sample generic scorecard.xlsx)";

export interface FaCategoryRef {
  categoryKey: string;
  categoryName: string;
}

function faQuestion(
  category: FaCategoryRef,
  question: Omit<
    CarrierQuestion,
    "section" | "scorecard" | "categoryKey" | "categoryName"
  >,
): CarrierQuestion {
  return {
    ...question,
    section: "fa",
    scorecard: "FA",
    categoryKey: category.categoryKey,
    categoryName: category.categoryName,
  };
}

/** Estimate quality: the same repair, material, or labor must not be billed twice. */
export function noDuplicateLineItemsCheck(
  weight: number,
  category: FaCategoryRef,
): CarrierQuestion {
  return faQuestion(category, {
    id: "fa_estimate_no_duplicate_line_items",
    text: "Is the estimate free of duplicate line items: the same repair, material, or labor billed more than once for the same area, or an item that is already included in a bundled or component line?",
    weight,
    severity: "high",
    sourceReference: `${GENERIC_FA_SOURCE}: Estimate is in operational order`,
  });
}

/** Estimate quality: overhead and profit only where warranted and eligible. */
export function overheadAndProfitCheck(
  weight: number,
  category: FaCategoryRef,
): CarrierQuestion {
  return faQuestion(category, {
    id: "fa_estimate_overhead_profit_correct",
    text: "Is overhead and profit (O&P) applied correctly: only when the claim involves multiple trades that warrant general-contractor coordination, applied to the eligible line items, and not applied to items or trades the carrier's guidelines exclude?",
    weight,
    applicability:
      "Score NOT_APPLICABLE if no O&P is included and the claim does not warrant it. Score FAIL if O&P is included on a single-trade repair or is missing on a clearly multi-trade repair that requires coordination.",
    severity: "high",
    sourceReference: `${GENERIC_FA_SOURCE}: Estimate is in operational order`,
  });
}

/** FA report: clarity, organization, grammar, and completed subsections. */
export function reportClarityCheck(
  weight: number,
  category: FaCategoryRef,
): CarrierQuestion {
  return faQuestion(category, {
    id: "fa_report_clear_and_grammatical",
    text: "Is the FA report clear, well organized, and free of grammatical or spelling errors that could confuse the desk adjuster or the insured, with every required subsection completed with a meaningful entry rather than placeholder text?",
    weight,
    severity: "low",
    sourceReference: `${GENERIC_FA_SOURCE}: FA Report`,
  });
}

/**
 * Carrier estimating guidelines, evaluated independently of the policy so the
 * category still scores when the policy is not in the file.
 */
export function estimatingGuidelinesCheck(
  weight: number,
  category: FaCategoryRef,
): CarrierQuestion {
  return faQuestion(category, {
    id: "fa_estimating_guidelines_followed",
    text: "Does the estimate follow the carrier's estimating guidelines and standard estimating practice independent of the policy: no prohibited line items (for example masking and prep for paint scoped separately when the guidelines include it in the paint line), appropriate waste factors, the correct price list and units of measure, and minimum charges applied only where allowed?",
    weight,
    applicability:
      "Always applicable, including when the policy is not in the file. Evaluate against the carrier's estimating guidelines when they are provided and against standard Xactimate estimating practice otherwise.",
    severity: "high",
    sourceReference: `${GENERIC_FA_SOURCE}: Unique Policy Provisions Addressed and Estimating guidelines followed`,
  });
}
