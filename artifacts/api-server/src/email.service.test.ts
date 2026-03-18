import test from "node:test";
import assert from "node:assert/strict";
import { renderCarrierScorecardEmail } from "./services/email";
import type { CarrierScorecardAuditResult } from "./services/carrierScorecardAudit";

const auditFixture: CarrierScorecardAuditResult = {
  version: "carrier_scorecard_v1",
  overall: {
    total_score: 25,
    max_score: 35,
    percent: 71.4,
    grade: "C",
    summary: "The final report is usable but has notable gaps.",
    confidence: 0.78,
  },
  categories: [
    {
      id: "file_stack_order",
      label: "File Stack Order",
      max_score: 5,
      status: "minor_issues",
      score: 3,
      finding: "Order is mostly clear.",
      evidence: [],
      recommendations: [],
    },
    {
      id: "payment_recommendations_match",
      label: "Payment Recommendations Match",
      max_score: 5,
      status: "pass",
      score: 5,
      finding: "Payments align across report sections.",
      evidence: [],
      recommendations: [],
    },
    {
      id: "estimate_operational_order",
      label: "Estimate is in operational order",
      max_score: 5,
      status: "pass",
      score: 4,
      finding: "Estimate sequence is mostly operational.",
      evidence: [],
      recommendations: [],
    },
    {
      id: "photographs_clear_in_order",
      label: "Photographs are clear and in order",
      max_score: 5,
      status: "minor_issues",
      score: 3,
      finding: "Photo sequence needs cleanup.",
      evidence: [],
      recommendations: [],
    },
    {
      id: "da_report_not_cumbersome",
      label: "DA report is not cumbersome",
      max_score: 5,
      status: "pass",
      score: 4,
      finding: "DA report is concise.",
      evidence: [],
      recommendations: [],
    },
    {
      id: "fa_report_detailed_enough",
      label: "FA report is detailed enough",
      max_score: 5,
      status: "pass",
      score: 4,
      finding: "FA detail is acceptable.",
      evidence: [],
      recommendations: [],
    },
    {
      id: "unique_policy_provisions_addressed",
      label: "Unique Policy Provisions Addressed",
      max_score: 5,
      status: "major_issues",
      score: 2,
      finding: "Policy provisions need more detail.",
      evidence: [],
      recommendations: [],
    },
  ],
  issues: [
    {
      severity: "high",
      title: "Policy gap",
      description: "Unique provisions were not fully addressed.",
    },
  ],
  meta: {
    model: "gpt-4o",
    generated_at: new Date().toISOString(),
    request_id: "req-fixture",
    validation_ok: true,
  },
};

test("carrier scorecard email renderer includes score summary and labels", () => {
  const html = renderCarrierScorecardEmail({ audit: auditFixture });

  assert.match(html, /25\/35/);
  assert.match(html, /71\.4%/);
  assert.match(html, />C</);
  assert.match(html, /File Stack Order/);
  assert.match(html, /Unique Policy Provisions Addressed/);
});
