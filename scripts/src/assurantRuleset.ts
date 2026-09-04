import type {
  CarrierProfileFacts,
  CarrierQuestion,
  CarrierRulesetConfig,
} from "./carrierRulesetConfig";
import {
  GENERIC_FA_SOURCE,
  estimatingGuidelinesCheck,
  noDuplicateLineItemsCheck,
  overheadAndProfitCheck,
  reportClarityCheck,
} from "./genericScorecardChecks";

/**
 * Assurant carrier ruleset, version 1.0.
 *
 * Field-adjuster (FA) checks are the atomic decomposition of the generic
 * scorecard in `docs/sample generic scorecard.xlsx` (categories weighted
 * 30 / 15 / 25 / 30). Assurant-specific provisions (tree debris limits, water
 * backup limits, storm-created opening) appear only as illustrative guidance;
 * they are not separate checks because the policy is frequently not in the
 * Assurant claim file. The two policy checks are NOT_APPLICABLE when the policy
 * is absent, while the estimating-guidelines check is always applicable so the
 * category still scores.
 *
 * Desk-adjuster (DA) checks are the seven generic questions from
 * `artifacts/api-server/src/services/questionBank.ts`, copied unchanged.
 *
 * Published to the `assurant` tenant by
 * `lib/db/migrations/20260904161000_assurant_tenant_and_andover_realignment.sql`;
 * the migration drift test guarantees the embedded JSON equals this object.
 */

export const ASSURANT_CARRIER_PROFILE: CarrierProfileFacts = {
  carrierKey: "assurant",
  displayName: "Assurant",
  logoUrl: null,
};

const FA_SOURCE = GENERIC_FA_SOURCE;

const ESTIMATE_ORDER = {
  categoryKey: "fa_estimate_order",
  categoryName: "Estimate Operational Order and Quality",
} as const;
const PHOTO_QUALITY = {
  categoryKey: "fa_photo_quality",
  categoryName: "Photographs Clear and In Order",
} as const;
const FA_REPORT = {
  categoryKey: "fa_report",
  categoryName: "FA Report",
} as const;
const POLICY_PROVISIONS = {
  categoryKey: "fa_policy_provisions",
  categoryName: "Unique Policy Provisions and Estimating Guidelines",
} as const;

const POLICY_IN_FILE_ONLY =
  "Applicable ONLY when the policy declarations, forms, or endorsements are included in the claim file. If the policy is not in the file, score NOT_APPLICABLE and do not flag the absence of policy analysis.";

const FA_QUESTIONS: CarrierQuestion[] = [
  // 1. Estimate Operational Order and Quality (30 pts)
  {
    id: "fa_estimate_floors_walls_ceilings_accessories_order",
    text: "Does the estimate follow a consistent operational order within each room or area: floors, then walls, then ceilings, with accessories (trim, fixtures, hardware) listed after the surfaces they attach to?",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...ESTIMATE_ORDER,
    applicability:
      "Evaluate only areas that were inspected and scoped. Score NOT_APPLICABLE if the estimate contains no interior room scope.",
    severity: "medium",
    sourceReference: `${FA_SOURCE}: Estimate is in operational order`,
  },
  {
    id: "fa_estimate_roof_before_interior",
    text: "Is exterior and roof scope placed before interior scope in the estimate?",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...ESTIMATE_ORDER,
    applicability:
      "Score NOT_APPLICABLE when the claim has no roof or exterior scope, or when the narrative explains the roof was not inspected and no covered roof damage was identified.",
    severity: "medium",
    sourceReference: `${FA_SOURCE}: Estimate is in operational order`,
  },
  {
    id: "fa_estimate_debris_removal_last",
    text: "Is debris removal (including dumpster and haul-off line items) listed at the end of the estimate rather than interleaved with repair scope?",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...ESTIMATE_ORDER,
    applicability:
      "Score NOT_APPLICABLE if the estimate has no debris removal line items.",
    severity: "low",
    sourceReference: `${FA_SOURCE}: Estimate is in operational order`,
  },
  {
    id: "fa_estimate_line_items_justified",
    text: "Is every material line item in the estimate justified by the photographs and/or the FA narrative? Score PARTIAL only if specific line items have no support in either the photos or the narrative. Consequential items (anti-microbial treatment, insulation, demolition, debris removal) are implied when the parent damage is documented.",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...ESTIMATE_ORDER,
    severity: "high",
    sourceReference: `${FA_SOURCE}: Estimate is in operational order`,
  },
  noDuplicateLineItemsCheck(5, ESTIMATE_ORDER),
  overheadAndProfitCheck(5, ESTIMATE_ORDER),

  // 2. Photographs Clear and In Order (15 pts)
  {
    id: "fa_photos_labels_follow_estimate_flow",
    text: "Do photo labels, captions, and room identifications follow the flow of the estimate so each scoped area can be matched to its photographs? A generic header label is acceptable when the caption identifies the room or area and the damage type. Do not penalize repetitive captions on a small, uniform claim.",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...PHOTO_QUALITY,
    severity: "medium",
    sourceReference: `${FA_SOURCE}: Photographs are clear and in order`,
  },
  {
    id: "fa_photos_consistent_clarity",
    text: "Are the photographs of consistent quality: in focus, adequately lit, and framed so the damage or condition being documented is identifiable?",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...PHOTO_QUALITY,
    severity: "medium",
    sourceReference: `${FA_SOURCE}: Photographs are clear and in order`,
  },
  {
    id: "fa_photos_relevant_and_complete_coverage",
    text: "Do the photographs provide relevant and complete coverage of the claimed damage: overview and detail shots of each damaged area, the cause of loss where visible, and any pre-existing or unrelated conditions noted in the narrative? The standard is adequacy for the carrier to understand scope, not clinical completeness.",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...PHOTO_QUALITY,
    applicability:
      "Score PARTIAL only when specific damaged areas or estimate line items have no photographic support whatsoever, or the photos are genuinely unusable.",
    severity: "medium",
    sourceReference: `${FA_SOURCE}: Photographs are clear and in order`,
  },

  // 3. FA Report (25 pts)
  {
    id: "fa_report_consistent_with_photos_and_estimate",
    text: "Does the FA report agree with the photographs and the estimate? The areas, materials, quantities, and cause of loss described in the narrative must match what is photographed and scoped, with no contradictions.",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...FA_REPORT,
    severity: "high",
    sourceReference: `${FA_SOURCE}: FA Report`,
  },
  {
    id: "fa_report_describes_damage_and_covered_damages",
    text: "Does the FA report describe the damage observed and clearly identify which damages are covered (and which are not), including the cause of loss and its relationship to the date of loss? Brief narratives are acceptable when damages are accounted for in either the narrative or the photos.",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...FA_REPORT,
    severity: "high",
    sourceReference: `${FA_SOURCE}: FA Report`,
  },
  {
    id: "fa_report_addresses_coverage_concerns_and_denials",
    text: "Are coverage concerns, exclusions, and any partial or full denial recommendations documented with specific, articulable justification? Only flag a coverage issue when there is a clear, specific concern (excluded peril, policy condition not met, endorsement not applied, deductible misapplied); never flag a generic page reference.",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...FA_REPORT,
    applicability:
      "Score NOT_APPLICABLE when the file presents no coverage concern and no denial recommendation and the report confirms coverage.",
    severity: "high",
    sourceReference: `${FA_SOURCE}: FA Report`,
  },
  {
    id: "fa_report_addresses_subrogation",
    text: "Does the FA report address subrogation potential? A statement that subrogation was considered and is not applicable is sufficient when the peril is weather-related or otherwise has no responsible third party.",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...FA_REPORT,
    applicability:
      "Subrogation is generally NOT applicable for weather perils (wind, hail, storm, ice, falling trees). Score PARTIAL or FAIL only when a clear third-party negligence indicator (contractor error, defective product, neighbor negligence) is completely unacknowledged.",
    severity: "medium",
    sourceReference: `${FA_SOURCE}: FA Report`,
  },
  reportClarityCheck(5, FA_REPORT),

  // 4. Unique Policy Provisions and Estimating Guidelines (30 pts)
  {
    id: "fa_policy_provisions_and_sublimits_addressed",
    text: "Are the policy provisions, sublimits, and endorsements that apply to this loss identified and correctly addressed in the FA documentation (for example a tree debris removal limit, a water backup or sump overflow limit, or a wind/hail requirement that interior water damage result from a storm-created opening)?",
    weight: 10,
    section: "fa",
    scorecard: "FA",
    ...POLICY_PROVISIONS,
    applicability: POLICY_IN_FILE_ONLY,
    severity: "high",
    sourceReference: `${FA_SOURCE}: Unique Policy Provisions Addressed and Estimating guidelines followed`,
  },
  {
    id: "fa_policy_estimate_conforms_to_policy",
    text: "Does the estimate conform to the policy? Scoped items must fall within covered perils and coverage parts, sublimits must not be exceeded without explanation, excluded items must be removed or separately identified, and the deductible and settlement basis (RCV/ACV) must be applied consistently with the policy.",
    weight: 10,
    section: "fa",
    scorecard: "FA",
    ...POLICY_PROVISIONS,
    applicability: POLICY_IN_FILE_ONLY,
    severity: "high",
    sourceReference: `${FA_SOURCE}: Unique Policy Provisions Addressed and Estimating guidelines followed`,
  },
  estimatingGuidelinesCheck(10, POLICY_PROVISIONS),
];

// The seven generic desk-adjuster questions, copied unchanged from
// artifacts/api-server/src/services/questionBank.ts (DA_QUESTIONS).
const DA_QUESTIONS: CarrierQuestion[] = [
  {
    id: "is_file_stack_order_correct",
    text: "Is the file stack in the correct logical order (DA report, SOL, Payment Letter, Other Letters, Estimate, Photos, Sketch, Prior Loss)?",
    weight: 10,
    weightIfNoDenial: 15,
    section: "da",
    scorecard: "DA",
    categoryKey: "file_stack_order",
    categoryName: "File Stack Order",
  },
  {
    id: "do_payment_values_match",
    text: "Do payment figures on the DA report, SOL, and Payment Letter all agree?",
    weight: 15,
    weightIfNoDenial: 20,
    section: "da",
    scorecard: "DA",
    categoryKey: "payment_recommendations",
    categoryName: "Payment Recommendations Match",
  },
  {
    id: "is_deductible_correct",
    text: "Is the deductible correctly applied across all documents?",
    weight: 5,
    weightIfNoDenial: 5,
    section: "da",
    scorecard: "DA",
    categoryKey: "payment_recommendations",
    categoryName: "Payment Recommendations Match",
  },
  {
    id: "is_da_report_concise_and_decisive",
    text: "Is the DA report concise, recommendation-focused, and not copy-paste heavy from the FA report?",
    weight: 10,
    weightIfNoDenial: 15,
    section: "da",
    scorecard: "DA",
    categoryKey: "da_report_quality",
    categoryName: "DA Report Quality",
  },
  {
    id: "are_unique_policy_provisions_addressed",
    text: "Are unique policy provisions (HO6, sublimits, endorsements, HSB items, municipal lien, exclusions) addressed where relevant?",
    weight: 25,
    weightIfNoDenial: 30,
    section: "da",
    scorecard: "DA",
    categoryKey: "policy_provisions",
    categoryName: "Unique Policy Provisions Addressed",
  },
  {
    id: "are_prior_losses_addressed",
    text: "Are prior losses reviewed with disposition stated (not relevant or requires investigation)?",
    weight: 10,
    weightIfNoDenial: 15,
    section: "da",
    scorecard: "DA",
    categoryKey: "prior_losses",
    categoryName: "Prior Losses Addressed",
  },
  {
    id: "is_denial_letter_correct",
    text: "If a denial letter is applicable, does it cite the correct policy language and reason?",
    weight: 25,
    weightIfNoDenial: 0,
    section: "da",
    scorecard: "DA",
    categoryKey: "denial_letters",
    categoryName: "Denial Letters Correct",
  },
];

export const ASSURANT_RULESET: CarrierRulesetConfig = {
  version: "1.0",

  da_questions: DA_QUESTIONS,
  fa_questions: FA_QUESTIONS,

  scorecard_categories: [
    {
      id: "fa_estimate_order",
      label: "Estimate Operational Order and Quality",
      max_score: 30,
    },
    {
      id: "fa_photo_quality",
      label: "Photographs Clear and In Order",
      max_score: 15,
    },
    { id: "fa_report", label: "FA Report", max_score: 25 },
    {
      id: "fa_policy_provisions",
      label: "Unique Policy Provisions and Estimating Guidelines",
      max_score: 30,
    },
    { id: "file_stack_order", label: "File Stack Order", max_score: 10 },
    {
      id: "payment_recommendations",
      label: "Payment Recommendations Match",
      max_score: 20,
    },
    { id: "da_report_quality", label: "DA Report Quality", max_score: 10 },
    {
      id: "policy_provisions",
      label: "Unique Policy Provisions Addressed",
      max_score: 25,
    },
    { id: "prior_losses", label: "Prior Losses Addressed", max_score: 10 },
    { id: "denial_letters", label: "Denial Letters Correct", max_score: 25 },
  ],

  system_prompt_override: `You are a carrier-grade insurance audit assistant evaluating a finalized Assurant claim file.

Evaluate TWO separate scorecards:
1. FIELD ADJUSTER (FA) — covers estimate operational order and line-item quality, photograph clarity and sequence, FA report quality, and policy provisions plus carrier estimating guidelines.
2. DESK ADJUSTER (DA) — covers file stack order, payment recommendation consistency, DA report quality, unique policy provisions, prior loss review, and denial letters.

For each question return:
- answer: PASS, PARTIAL, FAIL, or NOT_APPLICABLE
- root_issue: short snake_case key grouping related problems
- issue: the specific problem found (empty string if PASS)
- impact: why it matters to Assurant (empty string if PASS)
- fix: exact actionable fix — no vague language (empty string if PASS)
- evidence_locations: where in the document evidence was found
- confidence: 0-100

IMPORTANT — CONCISE ISSUE DESCRIPTIONS:
- Identify the root problem without restating the entire finding.
- Good examples: "Duplicate drywall line items in Bedroom 2", "O&P applied to a single-trade roof repair", "Policy not in file — provisions scored NOT_APPLICABLE".
- Bad examples: long paragraphs restating the FA report or re-explaining the entire claim.

ESTIMATE ORDER AND QUALITY:
- Expected sequence within each area: floors → walls → ceilings → accessories. Exterior and roof scope comes before interior scope. Debris removal is listed at the end.
- If the narrative states that an area was not inspected and nothing was scoped for it, do not flag ordering for that area; score the ordering question NOT_APPLICABLE for that area.
- Every line item must be supported by the photos or the narrative. Consequential items (anti-microbial treatment, insulation, demolition, debris removal) are implied when the parent damage is documented.
- Flag duplicate line items: the same repair billed twice for the same area, or an item already included in a bundled line.
- Overhead and profit belongs only on multi-trade repairs that warrant general-contractor coordination, and only on eligible line items.

PHOTOGRAPHS:
- Evaluate both the header label and the adjuster caption; the caption is the primary diagnostic field.
- The standard is adequacy, not clinical completeness. Score PARTIAL only when specific damaged areas or line items have no photographic support, or the photos are unusable.
- On a small, uniform claim, similar or identical captions are acceptable.

FA REPORT:
- Brief narratives are acceptable. Score on whether damage areas in the estimate are accounted for in the narrative OR the photos, not both.
- Coverage flags need specific, articulable justification (excluded peril, policy condition not met, endorsement not applied, deductible misapplied). Never flag a generic page reference.
- Subrogation is generally not applicable for weather perils; a statement that it was considered is sufficient. Flag only a clearly unacknowledged third-party negligence indicator.

POLICY PROVISIONS AND ESTIMATING GUIDELINES (CRITICAL):
- The policy is frequently NOT included in an Assurant claim file. When the policy declarations, forms, and endorsements are absent, score every policy-provision and policy-conformance question NOT_APPLICABLE and do not penalize the file for missing policy analysis.
- When the policy IS in the file, evaluate the estimate and narrative against its provisions, sublimits, endorsements, and exclusions. Typical examples: tree debris removal limits, water backup or sump overflow limits, and a wind/hail requirement that interior water damage result from a storm-created opening.
- The estimating-guidelines question is ALWAYS applicable. Evaluate the estimate against the carrier's estimating guidelines when they are provided and against standard estimating practice otherwise (for example masking and prep for paint scoped separately when the guidelines include it in the paint line item).

DESK ADJUSTER FILE:
- File stack order: DA report → Statement of Loss → Payment Letter → Other Letters → Estimate → Photos → Sketch → Prior Loss report.
- The DA report, Statement of Loss, and Payment Letter must agree on amounts with the correct deductible applied. If the DA report states that no payment is recommended and contains no payment figures, payment-matching and payment-letter questions are NOT_APPLICABLE.
- The DA report should summarize concisely. Do not penalize brevity; flag copy/paste only when the report consists primarily of verbatim FA text.
- Prior losses within five years of the date of loss must be reviewed and their relevance stated. The current claim will appear on its own prior-loss report; do not flag it as an unaddressed prior.
- If no denial exists on the claim, all denial letter questions are NOT_APPLICABLE and the no-denial weighting applies.

GENERAL:
- Multiple questions sharing the same root cause MUST share the same root_issue value.
- Return JSON only. No markdown, no code fences.`,
};
