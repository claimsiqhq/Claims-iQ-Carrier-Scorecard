import assert from "node:assert/strict";
import test from "node:test";
import { renderAuditPdfReport } from "./auditPdfReport";

test("audit report renderer returns a readable multipage PDF", async () => {
  const report = renderAuditPdfReport({
    claim: {
      claimNumber: "CLM-00062346",
      insuredName: "Synthetic Test Insured",
      carrier: "Bay State Insurance Company",
      dateOfLoss: "2026-01-31",
      lossType: "Water",
      policyNumber: "TEST-POLICY",
      propertyAddress: "123 Test Street",
      adjuster: "QA Reviewer",
    },
    audit: {
      overallScore: 89,
      deskAdjusterScore: 92,
      fieldAdjusterScore: 86,
      readiness: "REVIEW",
      technicalRisk: "MEDIUM",
      executiveSummary:
        "The file is substantially complete and requires targeted human review.",
    },
    findings: Array.from({ length: 18 }, (_, index) => ({
      severity: index % 2 ? "warning" : "high",
      title: `Synthetic finding ${index + 1}`,
      description:
        "Supporting documentation should be reconciled with the payment recommendation.",
      impact: "Unresolved differences can delay carrier approval.",
      fix: "Confirm the supported amount and update the final recommendation.",
    })),
  });

  assert.equal(report.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(report.length > 5_000);

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(report),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  assert.ok(pdf.numPages >= 2);
  const firstPage = await pdf.getPage(1);
  const textContent = await firstPage.getTextContent();
  const text = (textContent.items as Array<{ str?: string }>)
    .map((item) => item.str ?? "")
    .join(" ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ");
  assert.match(text, /Carrier Audit Report/);
  assert.match(text, /CLM-00062346/);
  await loadingTask.destroy();
});

