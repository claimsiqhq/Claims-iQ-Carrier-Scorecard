interface AllstateQuestion {
  id: string;
  text: string;
  weight: number;
  weightIfNoDenial?: number;
  section: string;
  scorecard: "DA" | "FA";
  categoryKey: string;
  categoryName: string;
}

interface AllstateScorecardCategory {
  id: string;
  label: string;
  max_score: number;
}

interface AllstateRulesetConfig {
  version: string;
  da_questions: AllstateQuestion[];
  fa_questions: AllstateQuestion[];
  scorecard_categories: AllstateScorecardCategory[];
  system_prompt_override?: string;
  carrier_scorecard_prompt_override?: string;
}

export const ALLSTATE_RULESET: AllstateRulesetConfig = {
  version: "1.0",
  da_questions: [
    {
      id: "is_file_stack_order_correct",
      text: "Is the file stack in the correct Allstate-required order (DA report, SOL, Payment Letter, Other Letters, Estimate, Photos, Sketch, Prior Loss)?",
      weight: 10,
      weightIfNoDenial: 15,
      section: "da",
      scorecard: "DA",
      categoryKey: "file_stack_order",
      categoryName: "File Stack Order",
    },
    {
      id: "do_payment_values_match",
      text: "Do payment figures on the DA report, SOL, and Payment Letter all agree per Allstate reconciliation standards?",
      weight: 15,
      weightIfNoDenial: 20,
      section: "da",
      scorecard: "DA",
      categoryKey: "payment_recommendations",
      categoryName: "Payment Recommendations Match",
    },
    {
      id: "is_deductible_correct",
      text: "Is the deductible correctly applied across all documents per the Allstate policy declarations page?",
      weight: 5,
      weightIfNoDenial: 5,
      section: "da",
      scorecard: "DA",
      categoryKey: "payment_recommendations",
      categoryName: "Payment Recommendations Match",
    },
    {
      id: "is_da_report_concise_and_decisive",
      text: "Is the DA report concise, recommendation-focused, and not copy-paste heavy from the FA report? Does it follow Allstate's preferred report format?",
      weight: 10,
      weightIfNoDenial: 15,
      section: "da",
      scorecard: "DA",
      categoryKey: "da_report_quality",
      categoryName: "DA Report Quality",
    },
    {
      id: "are_unique_policy_provisions_addressed",
      text: "Are Allstate-specific policy provisions (HO6, sublimits, endorsements, HSB items, municipal lien, exclusions, Allstate-specific riders) addressed where relevant?",
      weight: 25,
      weightIfNoDenial: 30,
      section: "da",
      scorecard: "DA",
      categoryKey: "policy_provisions",
      categoryName: "Unique Policy Provisions Addressed",
    },
    {
      id: "are_prior_losses_addressed",
      text: "Are prior losses reviewed with disposition stated (not relevant or requires investigation)? Is the ISO/CLUE report included per Allstate requirements?",
      weight: 10,
      weightIfNoDenial: 15,
      section: "da",
      scorecard: "DA",
      categoryKey: "prior_losses",
      categoryName: "Prior Losses Addressed",
    },
    {
      id: "is_denial_letter_correct",
      text: "If a denial letter is applicable, does it cite the correct Allstate policy language and reason? Does it follow Allstate's denial letter template requirements?",
      weight: 25,
      weightIfNoDenial: 0,
      section: "da",
      scorecard: "DA",
      categoryKey: "denial_letters",
      categoryName: "Denial Letters Correct",
    },
  ],
  fa_questions: [
    {
      id: "is_estimate_in_operational_order",
      text: "Does the estimate follow Allstate's required operational order (roof before interior, debris at end, grouped by area/trade)?",
      weight: 20,
      section: "fa",
      scorecard: "FA",
      categoryKey: "estimate_order",
      categoryName: "Estimate Operational Order",
    },
    {
      id: "are_photographs_clear_and_in_order",
      text: "Are photographs clear, properly labeled per Allstate photo standards, and sequenced to follow the estimate flow?",
      weight: 20,
      section: "fa",
      scorecard: "FA",
      categoryKey: "photo_quality",
      categoryName: "Photographs Clear and In Order",
    },
    {
      id: "does_fa_report_support_estimate_and_scope",
      text: "Does the FA report adequately describe observed damage, support the estimate, and address Allstate coverage/subrogation concerns?",
      weight: 30,
      section: "fa",
      scorecard: "FA",
      categoryKey: "fa_report_quality",
      categoryName: "FA Report Quality",
    },
    {
      id: "does_fa_address_unique_policy_provisions",
      text: "Does the FA field report reflect awareness of Allstate-specific policy provisions, sublimits, and special triggers?",
      weight: 30,
      section: "fa",
      scorecard: "FA",
      categoryKey: "fa_policy_provisions",
      categoryName: "Unique Policy Provisions (FA)",
    },
  ],
  scorecard_categories: [
    { id: "file_stack_order", label: "File Stack Order", max_score: 5 },
    { id: "payment_recommendations_match", label: "Payment Recommendations Match", max_score: 5 },
    { id: "estimate_operational_order", label: "Estimate is in operational order", max_score: 5 },
    { id: "photographs_clear_in_order", label: "Photographs are clear and in order", max_score: 5 },
    { id: "da_report_not_cumbersome", label: "DA report is not cumbersome", max_score: 5 },
    { id: "fa_report_detailed_enough", label: "FA report is detailed enough", max_score: 5 },
    { id: "unique_policy_provisions_addressed", label: "Allstate Policy Provisions Addressed", max_score: 5 },
  ],
};
