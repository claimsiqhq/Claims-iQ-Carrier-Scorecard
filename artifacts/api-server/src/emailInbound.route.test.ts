import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createEmailInboundRouter } from "./routes/emailInbound";
import type { CarrierScorecardAuditResult } from "./services/carrierScorecardAudit";

const auditFixture: CarrierScorecardAuditResult = {
  version: "carrier_scorecard_v1",
  overall: {
    total_score: 18,
    max_score: 35,
    percent: 51.4,
    grade: "F",
    summary: "Fallback-like fixture for async route tests.",
    confidence: 0.2,
  },
  categories: [
    { id: "file_stack_order", label: "File Stack Order", max_score: 5, status: "missing_info", score: 0, finding: "Missing", evidence: [], recommendations: ["Review and complete this section."] },
    { id: "payment_recommendations_match", label: "Payment Recommendations Match", max_score: 5, status: "missing_info", score: 0, finding: "Missing", evidence: [], recommendations: ["Review and complete this section."] },
    { id: "estimate_operational_order", label: "Estimate is in operational order", max_score: 5, status: "missing_info", score: 0, finding: "Missing", evidence: [], recommendations: ["Review and complete this section."] },
    { id: "photographs_clear_in_order", label: "Photographs are clear and in order", max_score: 5, status: "missing_info", score: 0, finding: "Missing", evidence: [], recommendations: ["Review and complete this section."] },
    { id: "da_report_not_cumbersome", label: "DA report is not cumbersome", max_score: 5, status: "missing_info", score: 0, finding: "Missing", evidence: [], recommendations: ["Review and complete this section."] },
    { id: "fa_report_detailed_enough", label: "FA report is detailed enough", max_score: 5, status: "missing_info", score: 0, finding: "Missing", evidence: [], recommendations: ["Review and complete this section."] },
    { id: "unique_policy_provisions_addressed", label: "Unique Policy Provisions Addressed", max_score: 5, status: "missing_info", score: 0, finding: "Missing", evidence: [], recommendations: ["Review and complete this section."] },
  ],
  issues: [
    { severity: "high", title: "Test issue", description: "Route test issue" },
  ],
  meta: {
    model: "gpt-4o",
    generated_at: new Date().toISOString(),
    request_id: "req-inbound-test",
    validation_ok: true,
  },
};

test("inbound email route returns 200 immediately and schedules processing", async () => {
  process.env.SENDGRID_INBOUND_PARSE_TOKEN = "inbound-token";

  let runCalled = false;
  let sendCalled = false;

  const app = express();
  app.use(createEmailInboundRouter({
    runAudit: async () => {
      runCalled = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return auditFixture;
    },
    sendAuditEmail: async () => {
      sendCalled = true;
    },
  }));

  const startedAt = Date.now();
  const res = await request(app)
    .post("/email/inbound?token=inbound-token")
    .field("from", "qa@example.com")
    .field("subject", "Inbound scorecard review")
    .field("text", "Final report body text for standalone processing.");

  const durationMs = Date.now() - startedAt;

  assert.equal(res.status, 200);
  assert.ok(durationMs < 1000);

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(runCalled, true);
  assert.equal(sendCalled, true);
});
