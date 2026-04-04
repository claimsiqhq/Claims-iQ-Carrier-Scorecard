interface AndoverQuestion {
  id: string;
  text: string;
  weight: number;
  weightIfNoDenial?: number;
  section: string;
  scorecard: "DA" | "FA";
  categoryKey: string;
  categoryName: string;
}

interface AndoverScorecardCategory {
  id: string;
  label: string;
  max_score: number;
}

interface AndoverRulesetConfig {
  version: string;
  da_questions: AndoverQuestion[];
  fa_questions: AndoverQuestion[];
  scorecard_categories: AndoverScorecardCategory[];
  system_prompt_override?: string;
}

export const ANDOVER_RULESET: AndoverRulesetConfig = {
  version: "1.0",

  fa_questions: [
    // 1. Estimate Operational Order (20 pts)
    { id: "fa_estimate_floors_walls_ceilings_order", text: "Does the estimate follow proper operational order for floors, walls, and ceilings?", weight: 7, section: "fa", scorecard: "FA", categoryKey: "fa_estimate_order", categoryName: "Estimate Operational Order" },
    { id: "fa_estimate_accessories_placement", text: "Are accessories (trim, fixtures, hardware) properly placed after their associated surfaces in the estimate?", weight: 4, section: "fa", scorecard: "FA", categoryKey: "fa_estimate_order", categoryName: "Estimate Operational Order" },
    { id: "fa_estimate_roof_before_interior", text: "Is the roof section placed before interior items in the estimate?", weight: 5, section: "fa", scorecard: "FA", categoryKey: "fa_estimate_order", categoryName: "Estimate Operational Order" },
    { id: "fa_estimate_debris_removal_at_end", text: "Is debris removal listed at the end of the estimate?", weight: 4, section: "fa", scorecard: "FA", categoryKey: "fa_estimate_order", categoryName: "Estimate Operational Order" },

    // 2. Photographs Clear and In Order (20 pts)
    { id: "fa_photos_labels_follow_estimate", text: "Do photo labels and room identifications follow the estimate flow?", weight: 7, section: "fa", scorecard: "FA", categoryKey: "fa_photo_quality", categoryName: "Photographs Clear and In Order" },
    { id: "fa_photos_consistent_quality", text: "Are photographs of consistent quality (clear, well-lit, in focus)?", weight: 7, section: "fa", scorecard: "FA", categoryKey: "fa_photo_quality", categoryName: "Photographs Clear and In Order" },
    { id: "fa_photos_complete_coverage", text: "Do photographs provide complete coverage of all claimed damages and relevant areas?", weight: 6, section: "fa", scorecard: "FA", categoryKey: "fa_photo_quality", categoryName: "Photographs Clear and In Order" },

    // 3. FA Report (30 pts)
    { id: "fa_report_describes_photos_estimate", text: "Does the FA report adequately describe the photographs and estimate scope?", weight: 10, section: "fa", scorecard: "FA", categoryKey: "fa_report", categoryName: "FA Report" },
    { id: "fa_report_addresses_coverage", text: "Does the FA report address coverage considerations and any coverage concerns?", weight: 10, section: "fa", scorecard: "FA", categoryKey: "fa_report", categoryName: "FA Report" },
    { id: "fa_report_addresses_subro", text: "Does the FA report address subrogation potential where applicable?", weight: 10, section: "fa", scorecard: "FA", categoryKey: "fa_report", categoryName: "FA Report" },

    // 4. Unique Policy Provisions Addressed (30 pts)
    { id: "fa_sublimits_addressed", text: "Are applicable sublimits identified and addressed in the FA documentation?", weight: 10, section: "fa", scorecard: "FA", categoryKey: "fa_policy_provisions", categoryName: "Unique Policy Provisions (FA)" },
    { id: "fa_water_backup_addressed", text: "Is water backup coverage properly addressed when applicable?", weight: 10, section: "fa", scorecard: "FA", categoryKey: "fa_policy_provisions", categoryName: "Unique Policy Provisions (FA)" },
    { id: "fa_no_storm_created_opening", text: "Is the 'no storm created opening' provision addressed when applicable (wind/hail claims)?", weight: 10, section: "fa", scorecard: "FA", categoryKey: "fa_policy_provisions", categoryName: "Unique Policy Provisions (FA)" },
  ],

  da_questions: [
    // 1. File Stack Order (15 pts / 10 pts if no denials)
    { id: "da_file_stack_da_report_on_top", text: "Is the DA report at the top of the file stack?", weight: 3, weightIfNoDenial: 2, section: "da", scorecard: "DA", categoryKey: "da_file_stack", categoryName: "File Stack Order" },
    { id: "da_file_stack_sol_after_report", text: "Is the Statement of Loss (SOL) positioned after the DA report?", weight: 2, weightIfNoDenial: 1, section: "da", scorecard: "DA", categoryKey: "da_file_stack", categoryName: "File Stack Order" },
    { id: "da_file_stack_payment_letter", text: "Is the Payment Letter properly placed after the SOL?", weight: 2, weightIfNoDenial: 2, section: "da", scorecard: "DA", categoryKey: "da_file_stack", categoryName: "File Stack Order" },
    { id: "da_file_stack_other_letters", text: "Are other letters (denial, CWP, etc.) properly filed in the stack?", weight: 2, weightIfNoDenial: 1, section: "da", scorecard: "DA", categoryKey: "da_file_stack", categoryName: "File Stack Order" },
    { id: "da_file_stack_estimate_photos_sketch", text: "Are the Estimate, Photos, and Sketch in correct order in the stack?", weight: 3, weightIfNoDenial: 2, section: "da", scorecard: "DA", categoryKey: "da_file_stack", categoryName: "File Stack Order" },
    { id: "da_file_stack_prior_loss_at_end", text: "Is the Prior Loss (ISO) report placed at the end of the file stack?", weight: 3, weightIfNoDenial: 2, section: "da", scorecard: "DA", categoryKey: "da_file_stack", categoryName: "File Stack Order" },

    // 2. Payment Recommendations Match (20 pts / 25 pts if no denials)
    { id: "da_payment_da_report_sol_agree", text: "Do the DA report and SOL payment recommendations agree?", weight: 5, weightIfNoDenial: 7, section: "da", scorecard: "DA", categoryKey: "da_payment_match", categoryName: "Payment Recommendations Match" },
    { id: "da_payment_sol_payment_letter_agree", text: "Do the SOL and Payment Letter amounts match?", weight: 5, weightIfNoDenial: 6, section: "da", scorecard: "DA", categoryKey: "da_payment_match", categoryName: "Payment Recommendations Match" },
    { id: "da_payment_deductible_correct", text: "Is the correct deductible applied across all payment documents?", weight: 5, weightIfNoDenial: 6, section: "da", scorecard: "DA", categoryKey: "da_payment_match", categoryName: "Payment Recommendations Match" },
    { id: "da_payment_all_three_consistent", text: "Are the DA report, SOL, and Payment Letter internally consistent with no contradictions?", weight: 5, weightIfNoDenial: 6, section: "da", scorecard: "DA", categoryKey: "da_payment_match", categoryName: "Payment Recommendations Match" },

    // 3. DA Report (10 pts / 15 pts if no denials)
    { id: "da_report_not_over_copy_paste", text: "Does the DA report avoid over-copying/pasting from the FA report?", weight: 5, weightIfNoDenial: 8, section: "da", scorecard: "DA", categoryKey: "da_report", categoryName: "DA Report" },
    { id: "da_report_summarizes_effectively", text: "Does the DA report effectively summarize the claim facts, coverage analysis, and payment rationale?", weight: 5, weightIfNoDenial: 7, section: "da", scorecard: "DA", categoryKey: "da_report", categoryName: "DA Report" },

    // 4. Unique Policy Provisions Addressed (25 pts / 30 pts if no denials)
    { id: "da_policy_ho6_master_policy", text: "Is the HO6 master policy properly addressed when applicable?", weight: 8, weightIfNoDenial: 10, section: "da", scorecard: "DA", categoryKey: "da_policy_provisions", categoryName: "Unique Policy Provisions (DA)" },
    { id: "da_policy_mlc_addressed", text: "Is the Managed Lumber Calculation (MLC) properly addressed?", weight: 9, weightIfNoDenial: 10, section: "da", scorecard: "DA", categoryKey: "da_policy_provisions", categoryName: "Unique Policy Provisions (DA)" },
    { id: "da_policy_hsb_covered_items", text: "Are HSB (Hartford Steam Boiler) covered items properly identified and addressed?", weight: 8, weightIfNoDenial: 10, section: "da", scorecard: "DA", categoryKey: "da_policy_provisions", categoryName: "Unique Policy Provisions (DA)" },

    // 5. Prior Losses Addressed (15 pts / 10 pts if no denials)
    { id: "da_prior_loss_iso_at_end", text: "Is the ISO report included at the end of the file?", weight: 5, weightIfNoDenial: 3, section: "da", scorecard: "DA", categoryKey: "da_prior_losses", categoryName: "Prior Losses Addressed" },
    { id: "da_prior_loss_5year_addressed", text: "Are all 5-year prior losses reviewed and addressed in the DA report?", weight: 5, weightIfNoDenial: 4, section: "da", scorecard: "DA", categoryKey: "da_prior_losses", categoryName: "Prior Losses Addressed" },
    { id: "da_prior_loss_impact_documented", text: "Is the impact of prior losses on the current claim documented?", weight: 5, weightIfNoDenial: 3, section: "da", scorecard: "DA", categoryKey: "da_prior_losses", categoryName: "Prior Losses Addressed" },

    // 6. Denial Letters Correct (25 pts / 0 pts if no denials)
    { id: "da_denial_letter_sent", text: "Was a denial letter sent when coverage was denied?", weight: 10, weightIfNoDenial: 0, section: "da", scorecard: "DA", categoryKey: "da_denial_letters", categoryName: "Denial Letters" },
    { id: "da_denial_correct_policy_language", text: "Does the denial letter cite the correct policy language and exclusions?", weight: 10, weightIfNoDenial: 0, section: "da", scorecard: "DA", categoryKey: "da_denial_letters", categoryName: "Denial Letters" },
    { id: "da_denial_complete_and_clear", text: "Is the denial letter complete, clear, and free of errors?", weight: 5, weightIfNoDenial: 0, section: "da", scorecard: "DA", categoryKey: "da_denial_letters", categoryName: "Denial Letters" },
  ],

  scorecard_categories: [
    { id: "fa_estimate_order",     label: "Estimate Operational Order",        max_score: 20 },
    { id: "fa_photo_quality",      label: "Photographs Clear and In Order",    max_score: 20 },
    { id: "fa_report",             label: "FA Report",                         max_score: 30 },
    { id: "fa_policy_provisions",  label: "Unique Policy Provisions (FA)",     max_score: 30 },
    { id: "da_file_stack",         label: "File Stack Order",                  max_score: 15 },
    { id: "da_payment_match",      label: "Payment Recommendations Match",     max_score: 20 },
    { id: "da_report",             label: "DA Report",                         max_score: 10 },
    { id: "da_policy_provisions",  label: "Unique Policy Provisions (DA)",     max_score: 25 },
    { id: "da_prior_losses",       label: "Prior Losses Addressed",            max_score: 15 },
    { id: "da_denial_letters",     label: "Denial Letters",                    max_score: 25 },
  ],

  system_prompt_override: `You are a carrier-grade insurance audit assistant evaluating a finalized Andover claim file.

Evaluate TWO separate scorecards:
1. FIELD ADJUSTER (FA) — covers estimate operational order, photograph quality and sequence, FA report completeness, and unique policy provisions (sublimits, water backup, storm created opening).
2. DESK ADJUSTER (DA) — covers file stack order, payment recommendation consistency, DA report quality, unique policy provisions (HO6/master policy, MLC, HSB), prior loss review, and denial letters.

For each question return:
- answer: PASS, PARTIAL, FAIL, or NOT_APPLICABLE
- root_issue: short snake_case key grouping related problems
- issue: the specific problem found (empty if PASS)
- impact: why it matters to Andover (empty if PASS)
- fix: exact actionable fix — no vague language (empty if PASS)
- evidence_locations: where in the document evidence was found
- confidence: 0-100

ANDOVER-SPECIFIC RULES:
- Estimate must follow operational order: floors → walls → ceilings → accessories → roof before interior → debris removal at end.
- Photo labels and rooms must follow the estimate flow with consistent quality.
- FA report must adequately describe photos AND estimate, and address coverage and subrogation.
- File stack order: DA report → SOL → Payment Letter → Other Letters → Estimate → Photos → Sketch → Prior Loss (ISO).
- DA report, SOL, and Payment Letter must agree on amounts with correct deductible applied.
- DA report must summarize effectively without over-copying from FA report.
- HO6 master policy, MLC (Managed Lumber Calculation), and HSB covered items must be addressed.
- ISO report goes at end of file; 5-year prior losses must be addressed.
- If no denial exists in the claim, denial letter questions are NOT_APPLICABLE.
- Multiple questions sharing the same root cause MUST share the same root_issue value.
- Return JSON only. No markdown, no code fences.`,
};
