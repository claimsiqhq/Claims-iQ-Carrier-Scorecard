import test from "node:test";
import assert from "node:assert/strict";
import {
  CARRIER_SCORECARD_VERSION,
  carrierScorecardRawSchema,
  parseCarrierScorecardJson,
} from "./services/carrierScorecardAudit";

const validRawPayload = {
  overall: {
    summary: "Report is mostly complete with a few documentation gaps.",
    confidence: 0.83,
  },
  categories: [
    {
      id: "file_stack_order",
      status: "minor_issues",
      score: 3,
      finding: "Stack order is mostly correct with one misplaced section.",
      evidence: ["Estimate appears before payment letter"],
      recommendations: ["Move payment letter ahead of estimate"],
    },
    {
      id: "payment_recommendations_match",
      status: "pass",
      score: 5,
      finding: "Payment figures align across the package.",
      evidence: ["DA, SOL, and letter totals match"],
      recommendations: [],
    },
    {
      id: "estimate_operational_order",
      status: "pass",
      score: 5,
      finding: "Estimate follows operational repair order.",
      evidence: ["Mitigation -> dry-out -> rebuild flow present"],
      recommendations: [],
    },
    {
      id: "photographs_clear_in_order",
      status: "minor_issues",
      score: 4,
      finding: "Photos are clear but one sequence break exists.",
      evidence: ["Kitchen images appear after roofing sequence"],
      recommendations: ["Align photo sequence with estimate line items"],
    },
    {
      id: "da_report_not_cumbersome",
      status: "pass",
      score: 5,
      finding: "DA report is concise and readable.",
      evidence: ["Summary references FA details without duplication"],
      recommendations: [],
    },
    {
      id: "fa_report_detailed_enough",
      status: "pass",
      score: 5,
      finding: "FA report includes enough detail for carrier review.",
      evidence: ["Cause, scope, and support docs clearly listed"],
      recommendations: [],
    },
    {
      id: "unique_policy_provisions_addressed",
      status: "major_issues",
      score: 2,
      finding: "Policy endorsements were not fully addressed.",
      evidence: ["HO6 endorsement mentioned but not evaluated"],
      recommendations: ["Add endorsement-specific coverage analysis"],
    },
  ],
  issues: [
    {
      severity: "high",
      category_id: "unique_policy_provisions_addressed",
      title: "Policy endorsement gap",
      description: "Special endorsement handling is incomplete.",
    },
  ],
  missing_info: [],
  assumptions: [],
};

test("schema validation succeeds with valid carrier payload", () => {
  const parsed = carrierScorecardRawSchema.safeParse(validRawPayload);
  assert.equal(parsed.success, true);
});

test("schema validation fails for invalid enum status value", () => {
  const invalid = {
    ...validRawPayload,
    categories: [
      {
        ...validRawPayload.categories[0],
        status: "pass|minor_issues",
      },
    ],
  };

  const parsed = carrierScorecardRawSchema.safeParse(invalid);
  assert.equal(parsed.success, false);
});

test("fallback result is returned when JSON parsing fails", () => {
  const result = parseCarrierScorecardJson("not-valid-json", {
    requestId: "req_test_1",
    model: "gpt-4o",
  });

  assert.equal(result.version, CARRIER_SCORECARD_VERSION);
  assert.equal(result.overall.total_score, 0);
  assert.equal(result.overall.grade, "F");
  assert.equal(result.meta.validation_ok, false);
  assert.equal(result.categories.length, 7);
});

test("dynamic category schema accepts non-default carrier category ids", () => {
  const customCategories = [
    { id: "financial_performance", label: "Financial Performance", max_score: 5 },
    { id: "customer_service", label: "Customer Service", max_score: 5 },
    { id: "estimate_quality", label: "Estimate & Quality", max_score: 5 },
    { id: "timeliness", label: "Timeliness", max_score: 5 },
  ];

  const payload = {
    overall: {
      summary: "Wawanesa file is mostly complete with minor timeliness gaps.",
      confidence: 0.79,
    },
    categories: [
      {
        id: "financial_performance",
        status: "pass",
        score: 5,
        finding: "Pricing is within benchmark range.",
        evidence: ["Pricing table shows +/-5% variance"],
        recommendations: [],
      },
      {
        id: "customer_service",
        status: "minor_issues",
        score: 3,
        finding: "Escalations are slightly above preferred threshold.",
        evidence: ["Two escalation references found"],
        recommendations: ["Reduce escalation handling delays."],
      },
      {
        id: "estimate_quality",
        status: "pass",
        score: 4,
        finding: "Estimate quality meets expectations.",
        evidence: [],
        recommendations: [],
      },
      {
        id: "timeliness",
        status: "major_issues",
        score: 1,
        finding: "SLA targets were repeatedly missed.",
        evidence: ["Contact and inspection timestamps exceed SLA"],
        recommendations: ["Improve response-time process controls."],
      },
    ],
    issues: [
      {
        severity: "high",
        category_id: "timeliness",
        title: "SLA breach cluster",
        description: "EM and GEN timelines were not met.",
      },
    ],
    missing_info: [],
    assumptions: [],
  };

  const result = parseCarrierScorecardJson(JSON.stringify(payload), {
    requestId: "req_test_wawanesa",
    model: "gpt-4o",
    categories: customCategories,
  });

  assert.equal(result.meta.validation_ok, true);
  assert.equal(result.categories.length, 4);
  assert.deepEqual(result.categories.map((c) => c.id), customCategories.map((c) => c.id));
  assert.equal(result.issues[0]?.category_id, "timeliness");
});
