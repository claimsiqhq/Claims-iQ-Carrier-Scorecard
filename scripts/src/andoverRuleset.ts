import type {
  CarrierProfileFacts,
  CarrierQuestion,
  CarrierRulesetConfig,
} from "./carrierRulesetConfig";
import {
  estimatingGuidelinesCheck,
  noDuplicateLineItemsCheck,
  overheadAndProfitCheck,
  reportClarityCheck,
} from "./genericScorecardChecks";

/**
 * Andover carrier ruleset, version 2.0.
 *
 * Derived from the production-published Andover 1.3 ruleset (tenant
 * a11a0000-0000-4000-8000-000000000002, version row
 * 058eeb00-036e-4378-8843-9fd922617d46). All 13 field-adjuster (FA) checks,
 * all 21 desk-adjuster (DA) checks, the DA weights, the DA category scores,
 * and the system prompt are preserved verbatim from 1.3.
 *
 * What changed in 2.0: the FA categories are realigned to the generic
 * scorecard weights (30 / 15 / 25 / 30 instead of 20 / 20 / 30 / 30) and the
 * four generic checks Andover lacked are added from
 * `./genericScorecardChecks`: no duplicate line items, O&P applied correctly,
 * FA report clarity/grammar, and carrier estimating-guideline compliance.
 *
 * Published by
 * `lib/db/migrations/20260904161000_assurant_tenant_and_andover_realignment.sql`;
 * the migration drift test guarantees the embedded JSON equals this object.
 */

export const ANDOVER_CARRIER_PROFILE: CarrierProfileFacts = {
  carrierKey: "andover",
  displayName: "Andover",
  logoUrl: "https://www.andovercompanies.com/",
};

const ESTIMATE_ORDER = {
  categoryKey: "fa_estimate_order",
  categoryName: "Estimate Operational Order",
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
  categoryName: "Unique Policy Provisions (FA)",
} as const;
const FILE_STACK = {
  categoryKey: "da_file_stack",
  categoryName: "File Stack Order",
} as const;
const PAYMENT_MATCH = {
  categoryKey: "da_payment_match",
  categoryName: "Payment Recommendations Match",
} as const;
const DA_REPORT = {
  categoryKey: "da_report",
  categoryName: "DA Report",
} as const;
const DA_POLICY_PROVISIONS = {
  categoryKey: "da_policy_provisions",
  categoryName: "Unique Policy Provisions (DA)",
} as const;
const PRIOR_LOSSES = {
  categoryKey: "da_prior_losses",
  categoryName: "Prior Losses Addressed",
} as const;
const DENIAL_LETTERS = {
  categoryKey: "da_denial_letters",
  categoryName: "Denial Letters",
} as const;

const FA_QUESTIONS: CarrierQuestion[] = [
  // 1. Estimate Operational Order (30 pts: 7 + 4 + 5 + 4 + 5 + 5)
  {
    id: "fa_estimate_floors_walls_ceilings_order",
    text: "Does the estimate follow proper operational order for floors, walls, and ceilings? NOTE: If the narrative states that an area was not inspected (e.g., due to ice/snow, inaccessibility, safety concerns) AND no covered damage was observed or scoped for that area, do NOT flag operational order issues related to that uninspected area. Only evaluate operational order for areas that were actually inspected and scoped in the estimate.",
    weight: 7,
    section: "fa",
    scorecard: "FA",
    ...ESTIMATE_ORDER,
  },
  {
    id: "fa_estimate_accessories_placement",
    text: "Are accessories (trim, fixtures, hardware) properly placed after their associated surfaces in the estimate?",
    weight: 4,
    section: "fa",
    scorecard: "FA",
    ...ESTIMATE_ORDER,
  },
  {
    id: "fa_estimate_roof_before_interior",
    text: "Is the roof section placed before interior items in the estimate? NOTE: If the roof was not inspected (e.g., ice/snow, inaccessibility) and no roof damage was scoped, this question is NOT_APPLICABLE. Do not flag missing roof section when the narrative explains the roof was not inspected and no covered roof damage was identified.",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...ESTIMATE_ORDER,
  },
  {
    id: "fa_estimate_debris_removal_at_end",
    text: "Is debris removal listed at the end of the estimate?",
    weight: 4,
    section: "fa",
    scorecard: "FA",
    ...ESTIMATE_ORDER,
  },
  noDuplicateLineItemsCheck(5, ESTIMATE_ORDER),
  overheadAndProfitCheck(5, ESTIMATE_ORDER),

  // 2. Photographs Clear and In Order (15 pts: 5 + 5 + 5)
  {
    id: "fa_photos_labels_follow_estimate",
    text: "Evaluate BOTH the photo header label AND the adjuster written caption/description for each photo. A generic header label (e.g., Right Elevation, Bedroom 1) is acceptable if the adjuster caption provides specificity (e.g., water damaged ceiling from ice dams along eave line). Do NOT penalize generic labels when descriptive captions are present — the caption is the primary diagnostic field. If photo labels/captions describe the damage type and location, accept the photo as sufficient documentation even if the visual damage is ambiguous in the image itself — humans also struggle to confirm damage from photos alone. REPETITIVE CAPTIONS — apply a proportionality test: Small or simple claim (20–40 photos, uniform damage type, one or two rooms): similar or identical captions are ACCEPTABLE. Score PASS. Complex claim (many photos across multiple rooms or damage types): if the majority of captions are identical generic descriptions that fail to differentiate distinct damage areas (e.g., 300 photos all labeled water damaged material with no room/area differentiation) → score PARTIAL. The test is: do the captions collectively allow the carrier to understand what each photo documents? If yes, score PASS. PHOTO REPORT FORMAT: Evaluate separately from caption quality. If the photo report is formatted with an unusual layout (not the standard 2 images per page), this may be flagged as a formatting concern independent of caption quality.",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...PHOTO_QUALITY,
  },
  {
    id: "fa_photos_consistent_quality",
    text: "Are photographs of consistent quality (clear, well-lit, in focus)?",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...PHOTO_QUALITY,
  },
  {
    id: "fa_photos_adequate_coverage",
    text: "Do photographs adequately support the claimed damages? Score PASS if photos are sufficient for the carrier to understand the scope of damage. Score PARTIAL only if specific estimate line items have zero photographic support OR photos are genuinely unusable. IMPLIED NECESSITY ITEMS — do NOT require standalone photos for the following when the parent damage is documented: Anti-microbial treatment / cleaning agents: implied when water damage to wall cavities, framing, or ceiling assemblies is documented in photos. Insulation replacement: implied when water damage to wall or ceiling cavities is documented. Debris removal: implied when exterior damage (tree, wind, hail) is documented. Demolition of damaged drywall or finish materials: implied when water or structural damage is documented. MITIGATION VENDOR CHECK: If a mitigation vendor, remediation company, or water mitigation contractor is referenced anywhere in the file, do NOT flag missing mitigation line items (anti-microbial, drying equipment) in the FA estimate — the vendor handles these separately. MITIGATION NOT ENGAGED: If the narrative explicitly states that the insured has not engaged, not hired, or declined mitigation services, do NOT flag missing mitigation-in-progress photos. Only flag missing mitigation photos when mitigation WAS performed per the narrative or invoices. If no mitigation vendor is referenced and narrative states mitigation was not engaged, the FA may include limited mitigation items in the estimate — this is acceptable and photos of mitigation in progress are NOT required.",
    weight: 5,
    section: "fa",
    scorecard: "FA",
    ...PHOTO_QUALITY,
  },

  // 3. FA Report (25 pts: 7 + 7 + 6 + 5)
  {
    id: "fa_report_describes_photos_estimate",
    text: "Does the FA report provide sufficient description of the damages observed? Brief narratives are acceptable — do not penalize for conciseness. Score PASS if damages are generally accounted for in either the narrative or the photos. Score PARTIAL only if specific damage areas appear in the estimate but have no corresponding support in either the narrative or the photos. MITIGATION JUSTIFICATION: If the narrative explicitly states that the insured has not engaged, not hired, or declined a mitigation team, this IS acceptable justification for the mitigation approach. Accept the following as valid mitigation justification: (a) insured has not engaged/hired mitigation, (b) insured declined mitigation, (c) limited mitigation included in repair estimate because no vendor engaged. Only flag missing mitigation justification if water/mold damage exists AND mitigation was actually performed but not explained, OR if the narrative is completely silent on mitigation when water damage is present.",
    weight: 7,
    section: "fa",
    scorecard: "FA",
    ...FA_REPORT,
  },
  {
    id: "fa_report_addresses_coverage",
    text: "Does the FA report address coverage considerations and any coverage concerns? NOTE: Coverage flags must include specific, articulable justification. If you cannot articulate the actual coverage issue beyond a generic page reference, do not flag it. Only flag coverage issues when there is a clear, specific concern (e.g., excluded peril, policy condition not met, endorsement not applied).",
    weight: 7,
    section: "fa",
    scorecard: "FA",
    ...FA_REPORT,
  },
  {
    id: "fa_report_addresses_subro",
    text: "Does the FA report address subrogation potential where applicable? NOTE: For weather-related perils (wind, hail, storm, falling objects/trees, ice dams, act of god), subrogation is generally NOT applicable. A canned carrier statement such as subrogation will be assessed by Andover is CORRECT and sufficient — score as PASS. Only score PARTIAL or FAIL if there is a clear third-party negligence indicator (contractor error, defective product, direct neighbor negligence) that is completely unacknowledged. Do NOT flag inverse liability scenarios (policyholder property causing third-party damage) as this is outside FA scope for Andover.",
    weight: 6,
    section: "fa",
    scorecard: "FA",
    ...FA_REPORT,
  },
  reportClarityCheck(5, FA_REPORT),

  // 4. Unique Policy Provisions (FA) (30 pts: 8 + 8 + 8 + 6)
  {
    id: "fa_sublimits_addressed",
    text: "Are applicable sublimits identified and addressed in the FA documentation?",
    weight: 8,
    section: "fa",
    scorecard: "FA",
    ...POLICY_PROVISIONS,
  },
  {
    id: "fa_water_backup_addressed",
    text: "Is water backup coverage properly addressed when applicable?",
    weight: 8,
    section: "fa",
    scorecard: "FA",
    ...POLICY_PROVISIONS,
  },
  {
    id: "fa_no_storm_created_opening",
    text: "Is the no storm created opening provision addressed when applicable (wind/hail claims)?",
    weight: 8,
    section: "fa",
    scorecard: "FA",
    ...POLICY_PROVISIONS,
  },
  estimatingGuidelinesCheck(6, POLICY_PROVISIONS),
];

const DA_QUESTIONS: CarrierQuestion[] = [
  // 1. File Stack Order (10 pts / 15 pts if no denial)
  {
    id: "da_file_stack_da_report_on_top",
    text: "Is the DA report at the top of the file stack?",
    weight: 2,
    weightIfNoDenial: 3,
    section: "da",
    scorecard: "DA",
    ...FILE_STACK,
  },
  {
    id: "da_file_stack_sol_after_report",
    text: "Is the Statement of Loss (SOL) positioned after the DA report?",
    weight: 1,
    weightIfNoDenial: 2,
    section: "da",
    scorecard: "DA",
    ...FILE_STACK,
  },
  {
    id: "da_file_stack_payment_letter",
    text: "Is the Payment Letter properly placed after the SOL? NOTE: If the DA report explicitly states that no payment is being recommended or requested at this time, and there are no payment financials in the DA report, a Payment Letter is NOT required. Score NOT_APPLICABLE in this scenario — do not flag the absence of a payment letter.",
    weight: 2,
    weightIfNoDenial: 2,
    section: "da",
    scorecard: "DA",
    ...FILE_STACK,
  },
  {
    id: "da_file_stack_other_letters",
    text: "Are other letters (denial, CWP, etc.) properly filed in the stack?",
    weight: 1,
    weightIfNoDenial: 2,
    section: "da",
    scorecard: "DA",
    ...FILE_STACK,
  },
  {
    id: "da_file_stack_estimate_photos_sketch",
    text: "Are the Estimate, Photos, and Sketch in correct order in the stack?",
    weight: 2,
    weightIfNoDenial: 3,
    section: "da",
    scorecard: "DA",
    ...FILE_STACK,
  },
  {
    id: "da_file_stack_prior_loss_at_end",
    text: "Is the Prior Loss (ISO) report placed at the end of the file stack?",
    weight: 2,
    weightIfNoDenial: 3,
    section: "da",
    scorecard: "DA",
    ...FILE_STACK,
  },

  // 2. Payment Recommendations Match (20 pts / 25 pts if no denial)
  {
    id: "da_payment_da_report_sol_agree",
    text: "Do the DA report and SOL payment recommendations agree? NOTE: If the DA report explicitly states no payment is being recommended or requested at this time, and no payment financials appear in the DA report, score NOT_APPLICABLE for all payment matching questions. The absence of a SOL or payment letter is expected in this scenario.",
    weight: 5,
    weightIfNoDenial: 7,
    section: "da",
    scorecard: "DA",
    ...PAYMENT_MATCH,
  },
  {
    id: "da_payment_sol_payment_letter_agree",
    text: "Do the SOL and Payment Letter amounts match? NOTE: If no payment is recommended per the DA report, score NOT_APPLICABLE.",
    weight: 5,
    weightIfNoDenial: 6,
    section: "da",
    scorecard: "DA",
    ...PAYMENT_MATCH,
  },
  {
    id: "da_payment_deductible_correct",
    text: "Is the correct deductible applied across all payment documents?",
    weight: 5,
    weightIfNoDenial: 6,
    section: "da",
    scorecard: "DA",
    ...PAYMENT_MATCH,
  },
  {
    id: "da_payment_all_three_consistent",
    text: "Are the DA report, SOL, and Payment Letter internally consistent with no contradictions? NOTE: If no payment is recommended, score NOT_APPLICABLE.",
    weight: 5,
    weightIfNoDenial: 6,
    section: "da",
    scorecard: "DA",
    ...PAYMENT_MATCH,
  },

  // 3. DA Report (10 pts / 15 pts if no denial)
  {
    id: "da_report_not_over_copy_paste",
    text: "Does the DA report avoid excessive verbatim copy/pasting from the FA report? A concise DA report that summarizes key facts without large verbatim blocks = PASS. Only score PARTIAL if the DA report consists primarily of copy/pasted FA text with minimal desk-level synthesis. Do NOT penalize for brevity or for echoing similar facts in the DA own words.",
    weight: 5,
    weightIfNoDenial: 8,
    section: "da",
    scorecard: "DA",
    ...DA_REPORT,
  },
  {
    id: "da_report_summarizes_effectively",
    text: "Does the DA report effectively summarize the claim facts, coverage analysis, and payment rationale? Brief summaries are acceptable for straightforward claims. Only score PARTIAL if material coverage nuances, payment reasoning, or unresolved open items of real significance are left completely unaddressed. CRITICAL: If the claim has open liability exposure — meaning the carrier may owe future payments NOT simply related to an unpredictable contractor supplement (e.g., pending retaining wall ownership determination, pending additional inspection of inaccessible areas, pending contents inventory) — the DA report MUST acknowledge this. If open liability exists and the report is marked as Final or First and Final without acknowledging the pending exposure, score FAIL. The report should be a First Report with a follow-up diary set, not a Final.",
    weight: 5,
    weightIfNoDenial: 7,
    section: "da",
    scorecard: "DA",
    ...DA_REPORT,
  },

  // 4. Unique Policy Provisions (DA) (25 pts / 30 pts if no denial)
  {
    id: "da_policy_ho6_master_policy",
    text: "Is the HO6 master policy properly addressed when applicable?",
    weight: 8,
    weightIfNoDenial: 10,
    section: "da",
    scorecard: "DA",
    ...DA_POLICY_PROVISIONS,
  },
  {
    id: "da_policy_mlc_addressed",
    text: "Is the Managed Lumber Calculation (MLC) properly addressed?",
    weight: 9,
    weightIfNoDenial: 10,
    section: "da",
    scorecard: "DA",
    ...DA_POLICY_PROVISIONS,
  },
  {
    id: "da_policy_hsb_covered_items",
    text: "Are HSB (Hartford Steam Boiler) covered items properly identified and addressed?",
    weight: 8,
    weightIfNoDenial: 10,
    section: "da",
    scorecard: "DA",
    ...DA_POLICY_PROVISIONS,
  },

  // 5. Prior Losses Addressed (10 pts / 15 pts if no denial)
  {
    id: "da_prior_loss_iso_at_end",
    text: "Is the ISO report included at the end of the file?",
    weight: 3,
    weightIfNoDenial: 5,
    section: "da",
    scorecard: "DA",
    ...PRIOR_LOSSES,
  },
  {
    id: "da_prior_loss_5year_addressed",
    text: "Are prior losses within 5 years of the CLAIM DATE reviewed and addressed in the DA report? The 5-year window is anchored to the claim date — not today date. Priors older than 5 years from the claim date are low concern. CRITICAL — CURRENT CLAIM ON ISO REPORT: The current claim will appear on its own ISO/ClaimSearch report. Do NOT flag the current claim as an unaddressed prior loss. Match by date of loss and property address, not by claim number format (formats vary between systems). When priors exist: score PASS if DA explicitly states they were reviewed and are not relevant (e.g., dissimilar perils, outside 5-year window). Score PARTIAL if DA is completely silent on priors that exist in the ISO report AND those priors are within 5 years with similar peril. For dissimilar perils (e.g., mold or falling objects vs. current wind claim), low concern even if within 5 years. THREE-TIER LOGIC: (a) No relevant priors within 5 years + DA silent on priors = PASS (no flag needed). (b) Relevant priors within 5 years (same/similar peril, overlapping area) + DA silent = FAIL. (c) ISO report missing from the file stack entirely = FAIL, UNLESS DA report explicitly notes that no priors exist and no report is available.",
    weight: 4,
    weightIfNoDenial: 5,
    section: "da",
    scorecard: "DA",
    ...PRIOR_LOSSES,
  },
  {
    id: "da_prior_loss_impact_documented",
    text: "Is the relevance of prior losses documented? For priors with dissimilar perils or outside the 5-year window from the claim date, a brief statement that they were reviewed and are not relevant is sufficient — score as PASS. If no relevant priors exist within 5 years (only the current claim on ISO, or only old/dissimilar priors), score PASS — detailed impact analysis is not required. Only require detailed impact analysis if priors share the same or similar peril AND involve overlapping damage areas AND are within 5 years of the claim date.",
    weight: 3,
    weightIfNoDenial: 5,
    section: "da",
    scorecard: "DA",
    ...PRIOR_LOSSES,
  },

  // 6. Denial Letters (25 pts / 0 pts if no denial)
  {
    id: "da_denial_letter_sent",
    text: "Was a denial letter sent when coverage was denied?",
    weight: 10,
    weightIfNoDenial: 0,
    section: "da",
    scorecard: "DA",
    ...DENIAL_LETTERS,
  },
  {
    id: "da_denial_correct_policy_language",
    text: "Does the denial letter cite the correct policy language and exclusions?",
    weight: 10,
    weightIfNoDenial: 0,
    section: "da",
    scorecard: "DA",
    ...DENIAL_LETTERS,
  },
  {
    id: "da_denial_complete_and_clear",
    text: "Is the denial letter complete, clear, and free of errors?",
    weight: 5,
    weightIfNoDenial: 0,
    section: "da",
    scorecard: "DA",
    ...DENIAL_LETTERS,
  },
];

export const ANDOVER_RULESET: CarrierRulesetConfig = {
  version: "2.0",

  da_questions: DA_QUESTIONS,
  fa_questions: FA_QUESTIONS,

  scorecard_categories: [
    {
      id: "fa_estimate_order",
      label: "Estimate Operational Order",
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
      label: "Unique Policy Provisions (FA)",
      max_score: 30,
    },
    { id: "da_file_stack", label: "File Stack Order", max_score: 15 },
    {
      id: "da_payment_match",
      label: "Payment Recommendations Match",
      max_score: 25,
    },
    { id: "da_report", label: "DA Report", max_score: 15 },
    {
      id: "da_policy_provisions",
      label: "Unique Policy Provisions (DA)",
      max_score: 30,
    },
    { id: "da_prior_losses", label: "Prior Losses Addressed", max_score: 15 },
    { id: "da_denial_letters", label: "Denial Letters", max_score: 25 },
  ],

  system_prompt_override: `You are a carrier-grade insurance audit assistant evaluating a finalized Andover claim file submitted by Pilot Catastrophe Services.

Evaluate TWO separate scorecards:
1. FIELD ADJUSTER (FA) — covers estimate operational order, photograph quality and sequence, FA report completeness, and unique policy provisions (sublimits, water backup, storm created opening).
2. DESK ADJUSTER (DA) — covers file stack order, payment recommendation consistency, DA report quality, unique policy provisions (HO6/master policy, MLC, HSB), prior loss review, and denial letters.

For each question return:
- answer: PASS, PARTIAL, FAIL, or NOT_APPLICABLE
- root_issue: short snake_case key grouping related problems
- issue: the specific problem found (empty string if PASS)
- impact: why it matters to Andover (empty string if PASS)
- fix: exact actionable fix — no vague language (empty string if PASS)
- evidence_locations: where in the document evidence was found
- confidence: 0-100

IMPORTANT — CONCISE ISSUE DESCRIPTIONS:
- When flagging issues, produce concise summaries that identify the root problem without restating the entire finding.
- Good examples: "DA/FA conflict on mitigation and contractor involvement", "DA report summarizes FA report — redundancy", "Prior loss from 2004 outside 5-year window — not relevant".
- Bad examples: long paragraphs restating what was already in the FA report or re-explaining the entire claim.

ANDOVER-SPECIFIC RULES:

FILE STACK ORDER:
- Required sequence: DA report → SOL → Payment Letter → Other Letters → Estimate → Photos → Sketch → Prior Loss (ISO).

NO PAYMENT RECOMMENDED — DOCUMENT SUPPRESSION:
- If the DA report explicitly states that no payment is being recommended or requested at this time, AND no payment financials appear in the DA report:
  (a) A Payment Letter is NOT required. Score payment letter placement as NOT_APPLICABLE.
  (b) Payment matching questions (DA vs SOL vs Payment Letter) should be scored NOT_APPLICABLE.
  (c) Do NOT flag the absence of a payment letter or SOL payment inconsistencies.
- This is distinct from a denial — no-payment-recommended means the claim may still be open with a follow-up pending.

SOL (STATEMENT OF LOSS) RULES:
- Andover provides a SOL on every report, even when no payment is recommended, UNLESS it is strictly a non-covered loss and no estimate was produced.
- Do NOT flag SOL presence as a mismatch when no payment is recommended — the SOL is standard.
- Only flag SOL issues when: (a) payment IS recommended but SOL amounts don't match, or (b) a non-covered loss with no estimate still has a SOL with payment figures.

PAYMENT MATCHING:
- DA report, SOL, and Payment Letter must agree on amounts with correct deductible applied.
- Exception: When no payment is recommended per above rule, score payment matching as NOT_APPLICABLE.

DA REPORT — REDUNDANCY STANDARD:
- The DA report purpose is to summarize concisely, not to add exhaustive analysis.
- Score PASS if the DA report is concise and avoids large verbatim blocks from the FA report.
- Score PARTIAL only if the DA report consists primarily of copy/pasted FA report text with minimal desk-level synthesis.
- Do NOT penalize for brief summaries. A short DA report that covers key points without verbatim duplication = PASS.
- Do NOT require policy interpretation breakdowns, reserve justifications, or gap analyses unless the claim is complex and they are clearly missing.

DA REPORT — CONTENT STANDARD:
- Brief, straightforward summaries are acceptable for routine claims.
- Score PARTIAL only if material coverage nuances, payment reasoning, or unresolved open items of genuine significance are completely unaddressed.
- Minor open items (small incidental damages, trivial ownership questions) do not require follow-up report status or detailed next steps.

DA REPORT — FUTURE PAYMENT EXPOSURE (CRITICAL):
- PRIORITIZE detecting open liability exposure over redundancy issues.
- If the carrier may owe future payments that are NOT simply related to an unpredictable contractor supplement, the DA report MUST acknowledge this and the report should NOT be marked as Final or First and Final.
- Examples of open liability requiring follow-up: pending retaining wall ownership determination, pending inspection of inaccessible areas, pending contents inventory with potential for significant additional payment, pending additional investigation that could change coverage.
- If open liability exists and the report is marked Final or First and Final without acknowledging the pending exposure → score FAIL on da_report_summarizes_effectively.
- The correct report status in these cases is First Report with a follow-up diary (typically 30 days).
- Exception: unpredictable contractor supplements are routine and do NOT require the report to be held open.

PRIOR LOSS EVALUATION (CRITICAL — UPDATED RULES):
- The 5-year window is calculated from the CLAIM DATE, not today date or the processing date.
- Prior losses older than 5 years from the claim date are LOW CONCERN and do not require detailed analysis.

CURRENT CLAIM ON ISO REPORT:
- The current claim WILL appear on its own ISO/ClaimSearch report. This is normal.
- Do NOT flag the current claim as an unaddressed prior loss.
- Match by date of loss and property address to identify the current claim, not by claim number format (formats vary between carrier systems and ISO — e.g., CLM-00064715 vs CLM00064715 or HP2493454).

THREE-TIER PRIOR LOSS LOGIC:
(a) No relevant priors within 5 years of claim date (only old losses, dissimilar perils, or only the current claim on ISO) + DA report silent on priors OR states no related priors = PASS. No flag needed.
(b) Relevant priors exist within 5 years (same/similar peril AND overlapping damage area) + DA report is completely silent on those priors = FAIL.
(c) ISO/prior loss report is missing from the file stack entirely = FAIL, UNLESS the DA report explicitly notes that no priors exist and no report is available.

PRIOR LOSS DETAIL REQUIREMENTS:
- When priors exist within 5 years of the claim date:
  (a) If perils are DISSIMILAR (e.g., prior mold or falling objects vs. current wind/ice dam claim), concern level is LOW even within 5 years.
  (b) If DA explicitly states priors were reviewed and are not relevant → score PASS.
  (c) Only score FAIL if DA is completely silent on priors AND those priors involve the same/similar peril with overlapping damage areas within 5 years.
- A brief statement such as "prior losses reviewed, not relevant — dissimilar perils / outside 5-year window" = adequate = PASS.
- A statement such as "There are no related prior losses that we are aware of" = adequate when ISO confirms no relevant priors = PASS.
- High concern threshold: same or similar peril + overlapping damage area + within 5 years of claim date.

PHOTO LABEL AND CAPTION EVALUATION:
- Evaluate BOTH the photo header label AND the adjuster written caption/description beneath each photo.
- The caption is the primary diagnostic field. A generic header label is acceptable when the caption provides specificity.
- Example of acceptable: label = "Bedroom 1", caption = "water damaged ceiling from ice dams along eave line" → PASS.
- Example of a problem: label = "damage" and caption is also missing or identically generic across all photos → PARTIAL.
- If photo labels/captions describe the damage type and location, accept the photo as sufficient documentation even if the visual damage is ambiguous in the image — humans also struggle to confirm damage from photos alone.
- REPETITIVE CAPTIONS — apply a proportionality test:
  (a) Small or simple claim (20–40 photos, uniform damage type, one or two affected rooms): similar or identical captions are ACCEPTABLE → PASS.
  (b) Complex claim (many photos, multiple rooms, multiple damage types): if the majority of captions are identical and provide no area or material differentiation → PARTIAL.
  The test: do the captions collectively allow the carrier to identify what each photo documents? If yes → PASS.
- PHOTO REPORT FORMAT: Evaluate separately from caption quality. If the photo report uses a non-standard layout (not the typical 2 images per page format), this is a formatting concern that may be flagged independently of caption quality.

PHOTO COVERAGE STANDARD:
- The standard is ADEQUACY, not completeness or clinical perfection.
- Score PASS if photos reasonably document the claimed damages at a level sufficient for the carrier to understand the scope.
- Score PARTIAL only if specific line items in the estimate have no photographic support whatsoever, or existing photos are genuinely unusable.

IMPLIED NECESSITY ITEMS — PHOTO SUPPORT NOT REQUIRED:
The following estimate line items are standard consequential scope items that do NOT require standalone photographs when the underlying parent damage is documented:
- Anti-microbial treatment / cleaning agents: implied when water damage to wall cavities, framing, or ceiling assemblies is documented in photos or narrative.
- Insulation replacement: implied when water damage to wall or ceiling cavities is documented.
- Debris removal: implied when exterior damage (tree, wind, hail, ice) is documented.
- Demolition of damaged drywall or finish materials: implied when water or structural damage is documented.
If the parent damage is documented, score these line items as PASS even without standalone photos of the treatment or material.

MITIGATION RULES (CRITICAL — UPDATED):

MITIGATION VENDOR CROSS-CHECK:
- Before flagging missing mitigation items (anti-microbial spray, drying equipment, moisture readings) in the FA estimate, check whether a mitigation vendor, water remediation company, or mitigation contractor is referenced in any document in the file.
- If a mitigation vendor IS referenced → do NOT flag missing mitigation line items or moisture documentation in the FA estimate. The vendor handles these separately on HO/commercial claims. Score NOT_APPLICABLE.
- If NO mitigation vendor is referenced → the FA may include mitigation items in the estimate. Implied necessity items (anti-microbial, insulation) require no standalone photos as long as the underlying water damage is documented.

MITIGATION NOT ENGAGED — VALID JUSTIFICATION:
- If the narrative explicitly states ANY of the following, this IS valid and acceptable mitigation justification:
  (a) "The insured has not engaged a mitigation team/company/contractor"
  (b) "The insured declined mitigation services"
  (c) "Mitigation services had not been performed at the time of inspection"
  (d) "Limited mitigation included in our repair estimate" (because no vendor was engaged)
- When mitigation is not engaged: do NOT flag "report does not justify mitigation" or "insufficient mitigation documentation".
- When mitigation is not engaged: do NOT flag missing mitigation-in-progress photos. There is no mitigation in progress to photograph.
- Only flag missing mitigation justification when: water/mold damage exists AND mitigation WAS actually performed (vendor invoices, drying logs present) but is not explained in the narrative.

CONTRACTOR VS MITIGATION CONFLICT:
- If the FA report references a contractor who will also handle damaged material removal and drying, AND the DA report does not address this overlap, flag as: "DA/FA have conflicting information on mitigation and contractor involvement." Keep the flag concise.

ESTIMATE OPERATIONAL ORDER — UNINSPECTED AREAS:
- If the narrative states that an area was NOT inspected (e.g., due to ice/snow accumulation, inaccessibility, safety concerns) AND no covered damage was observed or scoped for that area:
  (a) Do NOT flag operational order issues related to that uninspected area.
  (b) If roof was not inspected and no roof scope exists, do not flag "roof before interior" ordering.
  (c) Score the operational order question as NOT_APPLICABLE for uninspected/unscoped areas.

FA NARRATIVE / DESCRIPTION STANDARD:
- FA adjusters vary widely in verbosity. Brief narratives are normal and acceptable.
- Do NOT penalize for concise narratives when photo documentation is adequate.
- Score based on whether damage areas in the estimate are accounted for in either the narrative OR the photos — not both.
- Only score PARTIAL/FAIL if specific damage areas appear in the estimate but have no corresponding support in either the narrative or the photos.
- Do NOT require explicit photo ID references or cross-indexing in the narrative text.

COVERAGE ERROR SPECIFICITY:
- Coverage flags must include specific, articulable justification.
- If the model cannot articulate what the actual coverage issue is beyond a generic page reference, do NOT flag it.
- Only flag coverage issues when there is a clear, specific concern (e.g., excluded peril, policy condition not met, endorsement not applied, deductible misapplied).

SUBROGATION:
- Subrogation is generally NOT applicable for weather-related perils (wind, hail, storm, falling objects/trees, ice dams, act of god).
- A canned carrier statement such as "subrogation will be assessed by Andover Companies" is CORRECT and sufficient — score as PASS.
- Only score PARTIAL or FAIL if there is a clear third-party negligence indicator (contractor error, defective product, direct neighbor negligence) AND it is completely unacknowledged.
- Do NOT flag inverse liability scenarios — liability claims are outside Pilot scope for Andover.

POLICY PROVISIONS:
- HO6 master policy, MLC (Managed Lumber Calculation), and HSB covered items must be addressed when applicable.
- Mark NOT_APPLICABLE when the claim type or policy clearly does not involve these provisions.

DENIAL LETTERS:
- If no denial exists on the claim, all denial letter questions are NOT_APPLICABLE and alternate no-denial weighting applies.

GENERAL:
- Multiple questions sharing the same root cause MUST share the same root_issue value.
- Return JSON only. No markdown, no code fences.`,
};
