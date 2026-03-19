export type Answer = "PASS" | "PARTIAL" | "FAIL" | "NOT_APPLICABLE";

export interface Question {
  id: string;
  text: string;
  weight: number;
  section: string;
}

export interface QuestionResult {
  id: string;
  answer: Answer;
  issue: string;
  impact: string;
  fix: string;
  location: string;
  confidence: number;
}

export const QUESTION_BANK: Question[] = [
  { id: "cause_of_loss", text: "Is cause of loss clearly stated?", weight: 2, section: "coverage" },
  { id: "coverage_applied", text: "Is coverage applied correctly?", weight: 3, section: "coverage" },
  { id: "exclusions_addressed", text: "Are exclusions addressed?", weight: 2, section: "coverage" },
  { id: "policy_provisions", text: "Are policy provisions addressed?", weight: 2, section: "coverage" },

  { id: "damage_accounted", text: "Is all damage accounted for?", weight: 5, section: "scope" },
  { id: "deferred_items", text: "Are deferred items clearly explained?", weight: 5, section: "scope" },

  { id: "payment_consistency", text: "Do payment values match?", weight: 5, section: "financial" },
  { id: "deductible_correct", text: "Is deductible correct?", weight: 3, section: "financial" },

  { id: "photo_alignment", text: "Are photos aligned to estimate?", weight: 3, section: "documentation" },
  { id: "fa_support", text: "Does FA support estimate?", weight: 2, section: "documentation" },

  { id: "file_order", text: "Is file stack logical?", weight: 3, section: "presentation" },
  { id: "da_quality", text: "Is DA report concise?", weight: 2, section: "presentation" },
];

export const SECTIONS = [...new Set(QUESTION_BANK.map((q) => q.section))];

export const SECTION_LABELS: Record<string, string> = {
  coverage: "Coverage & Liability",
  scope: "Scope Completeness",
  financial: "Financial Accuracy",
  documentation: "Documentation Quality",
  presentation: "Presentation & Readiness",
};
