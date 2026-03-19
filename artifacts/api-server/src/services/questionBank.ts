export type Answer = "PASS" | "PARTIAL" | "FAIL" | "NOT_APPLICABLE";
export type Scorecard = "DA" | "FA";

export interface Question {
  id: string;
  text: string;
  weight: number;
  weightIfNoDenial?: number;
  section: string;
  scorecard: Scorecard;
  categoryKey: string;
  categoryName: string;
}

export interface QuestionResult {
  id: string;
  answer: Answer;
  points_awarded: number;
  points_possible: number;
  issue: string;
  impact: string;
  fix: string;
  evidence_locations: string[];
  confidence: number;
}

export const DA_QUESTIONS: Question[] = [
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

export const FA_QUESTIONS: Question[] = [
  {
    id: "is_estimate_in_operational_order",
    text: "Does the estimate follow a logical operational order (roof before interior, debris at end, grouped by area/trade)?",
    weight: 20,
    section: "fa",
    scorecard: "FA",
    categoryKey: "estimate_order",
    categoryName: "Estimate Operational Order",
  },
  {
    id: "are_photographs_clear_and_in_order",
    text: "Are photographs clear, properly labeled, and sequenced to follow the estimate flow?",
    weight: 20,
    section: "fa",
    scorecard: "FA",
    categoryKey: "photo_quality",
    categoryName: "Photographs Clear and In Order",
  },
  {
    id: "does_fa_report_support_estimate_and_scope",
    text: "Does the FA report adequately describe observed damage, support the estimate, and address coverage/subrogation concerns?",
    weight: 30,
    section: "fa",
    scorecard: "FA",
    categoryKey: "fa_report_quality",
    categoryName: "FA Report Quality",
  },
  {
    id: "does_fa_address_unique_policy_provisions",
    text: "Does the FA field report reflect awareness of relevant policy provisions, sublimits, and special triggers?",
    weight: 30,
    section: "fa",
    scorecard: "FA",
    categoryKey: "fa_policy_provisions",
    categoryName: "Unique Policy Provisions (FA)",
  },
];

export const ALL_QUESTIONS: Question[] = [...DA_QUESTIONS, ...FA_QUESTIONS];

export const DA_CATEGORY_KEYS = [...new Set(DA_QUESTIONS.map((q) => q.categoryKey))];
export const FA_CATEGORY_KEYS = [...new Set(FA_QUESTIONS.map((q) => q.categoryKey))];

export function getCategoryName(categoryKey: string): string {
  const q = ALL_QUESTIONS.find((q) => q.categoryKey === categoryKey);
  return q?.categoryName ?? categoryKey;
}
