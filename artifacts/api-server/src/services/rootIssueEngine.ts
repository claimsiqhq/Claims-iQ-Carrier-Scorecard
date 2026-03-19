import type { QuestionResult } from "./questionBank";

export interface RootIssueGroup {
  root_issue: string;
  affects: string[];
  primary: QuestionResult;
  related: QuestionResult[];
  all: QuestionResult[];
  fix: string;
  impact: string;
  evidence_locations: string[];
}

export function groupByRootIssue(results: QuestionResult[]): Map<string, QuestionResult[]> {
  const groups = new Map<string, QuestionResult[]>();

  for (const r of results) {
    const key = r.root_issue || r.id;
    const group = groups.get(key);
    if (group) {
      group.push(r);
    } else {
      groups.set(key, [r]);
    }
  }

  return groups;
}

export function buildRootIssueGroups(
  daResults: QuestionResult[],
  faResults: QuestionResult[],
): RootIssueGroup[] {
  const allFailing = [...daResults, ...faResults].filter(
    (r) => r.answer === "FAIL" || r.answer === "PARTIAL",
  );

  const grouped = groupByRootIssue(allFailing);
  const output: RootIssueGroup[] = [];

  for (const [rootKey, items] of grouped) {
    const primary = items.find((q) => q.answer === "FAIL") ?? items[0];
    const related = items.filter((q) => q !== primary);

    const allEvidence = items.flatMap((q) => q.evidence_locations);
    const uniqueEvidence = [...new Set(allEvidence)];

    output.push({
      root_issue: rootKey,
      affects: items.map((q) => q.id),
      primary,
      related,
      all: items,
      fix: primary.fix,
      impact: primary.impact,
      evidence_locations: uniqueEvidence,
    });
  }

  return output;
}

const MATERIAL_ROOT_ISSUES = new Set([
  "payment_mismatch",
  "missing_scope",
  "coverage_error",
  "deductible_mismatch",
  "denial_language_error",
  "missing_prior_loss_review",
]);

export function isMaterial(rootIssue: string): boolean {
  return MATERIAL_ROOT_ISSUES.has(rootIssue);
}
