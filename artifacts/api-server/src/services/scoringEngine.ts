import type { Answer, Question, QuestionResult } from "./questionBank";

function scoreAnswer(answer: Answer, weight: number): number {
  switch (answer) {
    case "PASS": return weight;
    case "PARTIAL": return weight * 0.5;
    case "FAIL": return 0;
    case "NOT_APPLICABLE": return weight;
    default: return 0;
  }
}

export interface SectionScore {
  score: number;
  max: number;
  percent: number;
}

export interface ScoringResult {
  total: number;
  max: number;
  percent: number;
  sections: Record<string, SectionScore>;
}

export function computeScore(results: QuestionResult[], questionBank: Question[]): ScoringResult {
  let total = 0;
  let max = 0;
  const sectionTotals: Record<string, { score: number; max: number }> = {};

  for (const r of results) {
    const q = questionBank.find((q) => q.id === r.id);
    if (!q) continue;

    const score = scoreAnswer(r.answer, q.weight);
    total += score;
    max += q.weight;

    if (!sectionTotals[q.section]) {
      sectionTotals[q.section] = { score: 0, max: 0 };
    }
    sectionTotals[q.section].score += score;
    sectionTotals[q.section].max += q.weight;
  }

  const sections: Record<string, SectionScore> = {};
  for (const [key, val] of Object.entries(sectionTotals)) {
    sections[key] = {
      score: val.score,
      max: val.max,
      percent: val.max > 0 ? Math.round((val.score / val.max) * 100) : 0,
    };
  }

  return {
    total,
    max,
    percent: max > 0 ? Math.round((total / max) * 100) : 0,
    sections,
  };
}
