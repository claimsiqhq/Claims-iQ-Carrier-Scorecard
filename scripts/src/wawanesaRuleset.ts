interface WawanesaQuestion {
  id: string;
  text: string;
  weight: number;
  weightIfNoDenial?: number;
  section: string;
  scorecard: "DA" | "FA";
  categoryKey: string;
  categoryName: string;
}

interface WawanesaScorecardCategory {
  id: string;
  label: string;
  max_score: number;
}

interface WawanesaRulesetConfig {
  version: string;
  da_questions: WawanesaQuestion[];
  fa_questions: WawanesaQuestion[];
  scorecard_categories: WawanesaScorecardCategory[];
  system_prompt_override?: string;
  carrier_scorecard_prompt_override?: string;
}

export const WAWANESA_RULESET: WawanesaRulesetConfig = {
  version: "1.0",

  // DA QUESTIONS (9 total, 65 pts)
  // Wawanesa's 4 performance domains: Financial (15%), Customer Service (25%),
  // Quality (25%), Timeliness (35%). Scoring: 1 (poor) → 4 (excellent).
  // EM = Emergency jobs | GEN = General jobs

  da_questions: [

    // FINANCIAL PERFORMANCE (15% of overall) — EM 50%, GEN 50%
    // Scoring: 4=≥5% below industry avg | 3=within ±5% | 2=6-10% over | 1=≥11% over
    {
      id: "was_vendor_pricing_within_industry_em",
      text: "Was the vendor/contractor's pricing within acceptable industry benchmark range for emergency (EM) jobs? (Best=≥5% below avg; Fail=≥11% over avg)",
      weight: 8, section: "da", scorecard: "DA",
      categoryKey: "financial_performance", categoryName: "Financial Performance",
    },
    {
      id: "was_vendor_pricing_within_industry_gen",
      text: "Was the vendor/contractor's pricing within acceptable industry benchmark range for general (GEN) jobs? (Best=≥5% below avg; Fail=≥11% over avg)",
      weight: 7, section: "da", scorecard: "DA",
      categoryKey: "financial_performance", categoryName: "Financial Performance",
    },

    // CUSTOMER SERVICE (25% of overall) — Escalations 75%, NPS 25%
    // Escalations: 4=0 | 3=1 | 2=2 | 1=3+
    // NPS:         4=≥70% | 3=60-69% | 2=50-59% | 1=≤49%
    {
      id: "were_escalations_within_threshold",
      text: "Were customer escalations related to this vendor/contractor at or below the acceptable threshold? (Best=0 escalations; Fail=3 or more escalations)",
      weight: 19, section: "da", scorecard: "DA",
      categoryKey: "customer_service", categoryName: "Customer Service",
    },
    {
      id: "was_nps_at_or_above_threshold",
      text: "Was the Net Promoter Score (NPS) for vendor work at or above Wawanesa's 70% threshold? (Best=≥70%; Fail=≤49%)",
      weight: 6, section: "da", scorecard: "DA",
      categoryKey: "customer_service", categoryName: "Customer Service",
    },

    // QUALITY — Estimate Review (25% category; this sub-metric: 50%)
    // Scoring: 4=≥90% | 3=80-89% | 2=70-79% | 1=≤69%
    {
      id: "was_estimate_review_score_adequate",
      text: "Was the contractor's estimate review score at or above Wawanesa's 80% passing threshold? (Best=≥90%; Fail=≤69%)",
      weight: 12, section: "da", scorecard: "DA",
      categoryKey: "estimate_quality", categoryName: "Estimate & Quality",
    },

    // TIMELINESS — Completion Time (35% category; EM 20%, GEN 20%)
    // EM ≤14 days | GEN ≤100 days
    {
      id: "was_completion_time_within_guidelines_em",
      text: "Was the emergency job completion time documented and within Wawanesa's 14-day guideline?",
      weight: 7, section: "da", scorecard: "DA",
      categoryKey: "timeliness", categoryName: "Timeliness",
    },
    {
      id: "was_completion_time_within_guidelines_gen",
      text: "Was the general job completion time documented and within Wawanesa's 100-day guideline?",
      weight: 7, section: "da", scorecard: "DA",
      categoryKey: "timeliness", categoryName: "Timeliness",
    },

    // TIMELINESS — Returned Time (EM 5%, GEN 15%)
    // EM ≤7 days | GEN ≤14 days
    {
      id: "was_file_returned_timely_em",
      text: "Was the emergency job file returned to Wawanesa within the required 7-day window?",
      weight: 1, section: "da", scorecard: "DA",
      categoryKey: "timeliness", categoryName: "Timeliness",
    },
    {
      id: "was_file_returned_timely_gen",
      text: "Was the general job file returned to Wawanesa within the required 14-day window?",
      weight: 5, section: "da", scorecard: "DA",
      categoryKey: "timeliness", categoryName: "Timeliness",
    },
  ],

  // FA QUESTIONS (9 total, 35 pts)
  fa_questions: [

    // QUALITY — Estimate Quality (25% category; this sub-metric: 50%)
    // Default score = 3 (meets standard) unless specific deficiencies found
    {
      id: "was_estimate_quality_scored",
      text: "Was the contractor's estimate quality reviewed and scored per Wawanesa standards? (Default=meets standard; flag deviations in scope, pricing, or documentation)",
      weight: 13, section: "fa", scorecard: "FA",
      categoryKey: "estimate_quality", categoryName: "Estimate & Quality",
    },

    // TIMELINESS — Contact Time (EM 7.5%, GEN 7.5%) — both ≤1 hour
    {
      id: "was_initial_contact_made_timely_em",
      text: "Was initial contact with the insured/claimant made within 1 hour for emergency (EM) assignments?",
      weight: 2, section: "fa", scorecard: "FA",
      categoryKey: "timeliness", categoryName: "Timeliness",
    },
    {
      id: "was_initial_contact_made_timely_gen",
      text: "Was initial contact with the insured/claimant made within 1 hour for general (GEN) assignments?",
      weight: 3, section: "fa", scorecard: "FA",
      categoryKey: "timeliness", categoryName: "Timeliness",
    },

    // TIMELINESS — Inspection Time (EM 10%, GEN 10%)
    // EM ≤4 hours | GEN ≤24 hours
    {
      id: "was_inspection_completed_timely_em",
      text: "Was the field inspection completed within 4 hours for emergency (EM) assignments?",
      weight: 3, section: "fa", scorecard: "FA",
      categoryKey: "timeliness", categoryName: "Timeliness",
    },
    {
      id: "was_inspection_completed_timely_gen",
      text: "Was the field inspection completed within 24 hours for general (GEN) assignments?",
      weight: 3, section: "fa", scorecard: "FA",
      categoryKey: "timeliness", categoryName: "Timeliness",
    },

    // TIMELINESS — Target Start & Target Complete (1.25% each x4 = 5%)
    // All four: ≤48 hours
    {
      id: "was_target_start_met_em",
      text: "Was the target start time met within 48 hours for emergency (EM) jobs?",
      weight: 1, section: "fa", scorecard: "FA",
      categoryKey: "timeliness", categoryName: "Timeliness",
    },
    {
      id: "was_target_start_met_gen",
      text: "Was the target start time met within 48 hours for general (GEN) jobs?",
      weight: 1, section: "fa", scorecard: "FA",
      categoryKey: "timeliness", categoryName: "Timeliness",
    },
    {
      id: "was_target_complete_met_em",
      text: "Was the target completion milestone met within 48 hours of the committed date for emergency (EM) jobs?",
      weight: 1, section: "fa", scorecard: "FA",
      categoryKey: "timeliness", categoryName: "Timeliness",
    },
    {
      id: "was_target_complete_met_gen",
      text: "Was the target completion milestone met within 48 hours of the committed date for general (GEN) jobs?",
      weight: 1, section: "fa", scorecard: "FA",
      categoryKey: "timeliness", categoryName: "Timeliness",
    },
  ],

  // SCORECARD CATEGORIES (OpenAI-evaluated, 0–5 each)
  // Maps to Wawanesa's 4 performance domains.
  scorecard_categories: [
    { id: "financial_performance", label: "Financial Performance",  max_score: 5 },
    { id: "customer_service",      label: "Customer Service",       max_score: 5 },
    { id: "estimate_quality",      label: "Estimate & Quality",     max_score: 5 },
    { id: "timeliness",            label: "Timeliness",             max_score: 5 },
  ],

  // QUESTION AUDIT SYSTEM PROMPT
  system_prompt_override: `You are a carrier-grade insurance audit assistant evaluating a finalized Wawanesa Insurance claim file for vendor/contractor performance compliance.

Evaluate TWO separate scorecards:
1. DESK ADJUSTER (DA) — covers financial benchmarking, customer escalations, NPS, estimate review scores, completion times, and returned file timeliness
2. FIELD ADJUSTER (FA) — covers estimate quality scoring, initial contact timing, inspection timing, and target start/completion milestones

Wawanesa uses TWO job type designations:
- EM (Emergency): rapid-response claims with tight SLAs
- GEN (General): standard claims with extended timelines

For each question return:
- answer: PASS, PARTIAL, FAIL, or NOT_APPLICABLE
- root_issue: short snake_case key grouping related problems
- issue: the specific problem found (empty if PASS)
- impact: why it matters to Wawanesa (empty if PASS)
- fix: exact actionable fix — no vague language (empty if PASS)
- evidence_locations: where in the document evidence was found
- confidence: 0-100

WAWANESA-SPECIFIC RULES:
- Financial: Flag if vendor pricing is >10% above industry benchmark (PARTIAL) or ≥11% over (FAIL).
- Escalations: 3 or more = FAIL. Zero escalations = PASS.
- NPS: Below 60% = PARTIAL. Below 50% = FAIL.
- Estimate Review: Below 80% = PARTIAL. At or below 69% = FAIL.
- Estimate Quality defaults to "meets standard" (PARTIAL at worst) unless specific deficiencies are documented.
- EM thresholds: contact ≤1 hr, inspection ≤4 hrs, target start ≤48 hrs, target complete ≤48 hrs, job completion ≤14 days, file returned ≤7 days.
- GEN thresholds: contact ≤1 hr, inspection ≤24 hrs, target start ≤48 hrs, target complete ≤48 hrs, job completion ≤100 days, file returned ≤14 days.
- If the job type (EM vs GEN) cannot be determined from the file, mark EM and GEN timeliness questions as NOT_APPLICABLE and use root_issue "job_type_indeterminate".
- Multiple questions sharing the same root cause MUST share the same root_issue value.
- Return JSON only. No markdown, no code fences.`,

  // CARRIER SCORECARD SYSTEM PROMPT (OpenAI 0–5 evaluation)
  carrier_scorecard_prompt_override: `You are evaluating a Wawanesa Insurance vendor/contractor performance claim file.

Evaluate the file across Wawanesa's 4 performance domains and return ONLY the JSON structure below. No markdown. No code fences.

DOMAIN WEIGHTS AND THRESHOLDS:
- FINANCIAL PERFORMANCE (15%): Score how well vendor pricing compares to industry benchmarks. 5=≥5% below avg, 3=within ±5%, 1=≥11% over avg.
- CUSTOMER SERVICE (25%): Score on escalations (75% weight) and NPS (25% weight). 5=0 escalations + ≥70% NPS; 1=3+ escalations or ≤49% NPS.
- ESTIMATE & QUALITY (50%): Score estimate review results (≥90%=5, ≥80%=3, ≤69%=1) and estimate quality (default 3 unless deficiencies noted).
- TIMELINESS (35%): Score against EM/GEN SLAs. EM: contact ≤1hr, inspection ≤4hrs, completion ≤14d, returned ≤7d. GEN: contact ≤1hr, inspection ≤24hrs, completion ≤100d, returned ≤14d. Target start/complete ≤48hrs for both.

Return exactly this JSON structure:
{
  "overall": {
    "summary": "<2-3 sentence vendor performance summary>",
    "confidence": 0.0
  },
  "categories": [
    {
      "id": "financial_performance",
      "status": "minor_issues",
      "score": 0,
      "finding": "<what was found>",
      "evidence": ["<document reference>"],
      "recommendations": ["<specific action>"]
    },
    {
      "id": "customer_service",
      "status": "minor_issues",
      "score": 0,
      "finding": "<what was found>",
      "evidence": [],
      "recommendations": []
    },
    {
      "id": "estimate_quality",
      "status": "minor_issues",
      "score": 0,
      "finding": "<what was found>",
      "evidence": [],
      "recommendations": []
    },
    {
      "id": "timeliness",
      "status": "minor_issues",
      "score": 0,
      "finding": "<what was found>",
      "evidence": [],
      "recommendations": []
    }
  ],
  "issues": [
    {
      "severity": "medium",
      "category_id": "financial_performance",
      "title": "<issue title>",
      "description": "<specific description>"
    }
  ],
  "missing_info": ["<any missing data that prevented scoring>"],
  "assumptions": ["<any assumption made due to unclear data>"]
}`,
};
