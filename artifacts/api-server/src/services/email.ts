import type { AuditResponse } from "./audit";

interface EmailData {
  claimNumber: string;
  insuredName: string;
  carrier: string;
  auditResult: AuditResponse;
}

const TECHNICAL_SECTIONS: { key: keyof AuditResponse["section_scores"]; label: string; max: number }[] = [
  { key: "coverage_clarity", label: "Coverage & Liability Clarity", max: 15 },
  { key: "scope_completeness", label: "Scope Completeness", max: 15 },
  { key: "estimate_accuracy", label: "Estimate Technical Accuracy", max: 15 },
  { key: "documentation_support", label: "Documentation & Evidence Support", max: 10 },
  { key: "financial_accuracy", label: "Financial Accuracy & Reconciliation", max: 10 },
  { key: "carrier_risk", label: "Carrier Risk & Completeness", max: 15 },
];

const PRESENTATION_SECTIONS: { key: keyof AuditResponse["section_scores"]; label: string; max: number }[] = [
  { key: "file_stack_order", label: "File Stack Order", max: 3 },
  { key: "payment_match", label: "Payment Recommendations Match", max: 5 },
  { key: "estimate_operational_order", label: "Estimate Operational Order", max: 3 },
  { key: "photo_organization", label: "Photographs Clear and In Order", max: 3 },
  { key: "da_report_quality", label: "DA Report Not Cumbersome", max: 2 },
  { key: "fa_report_quality", label: "FA Report Detailed Enough", max: 2 },
  { key: "policy_provisions", label: "Unique Policy Provisions Addressed", max: 2 },
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreColor(score: number, max: number): string {
  const pct = (score / max) * 100;
  if (pct >= 80) return "#16a34a";
  if (pct >= 60) return "#ca8a04";
  return "#dc2626";
}

function buildScorecardTable(title: string, sections: typeof TECHNICAL_SECTIONS, scores: AuditResponse["section_scores"]): string {
  let rows = "";
  for (const s of sections) {
    const val = scores[s.key] ?? 0;
    const color = scoreColor(val, s.max);
    rows += `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">${escapeHtml(s.label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;color:${color};font-size:14px;">${val}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:14px;color:#6b7280;">/ ${s.max}</td>
    </tr>`;
  }

  return `
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <thead>
        <tr style="background-color:#f3f0f7;">
          <th style="padding:10px 12px;text-align:left;font-size:13px;color:#342A4F;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #7763B7;" colspan="3">${escapeHtml(title)}</th>
        </tr>
        <tr style="background-color:#fafafa;">
          <th style="padding:6px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Section</th>
          <th style="padding:6px 12px;text-align:center;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Score</th>
          <th style="padding:6px 12px;text-align:center;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Max</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildBulletSection(title: string, items: string[]): string {
  if (!items || items.length === 0) return "";
  const bullets = items.map((i) => `<li style="margin-bottom:6px;font-size:14px;color:#374151;">${escapeHtml(typeof i === "string" ? i : String(i))}</li>`).join("");
  return `
    <div style="margin-bottom:20px;">
      <h3 style="font-size:15px;font-weight:700;color:#342A4F;margin:0 0 8px 0;">${escapeHtml(title)}</h3>
      <ul style="margin:0;padding-left:20px;">${bullets}</ul>
    </div>`;
}

export function renderAuditEmail(data: EmailData): string {
  const { claimNumber, insuredName, carrier, auditResult: r } = data;

  const riskColors: Record<string, string> = { LOW: "#16a34a", MEDIUM: "#ca8a04", HIGH: "#dc2626" };
  const riskColor = riskColors[r.risk_level] ?? "#6b7280";

  console.log("Email rendered");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f0edf4;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background-color:#ffffff;">
    <div style="background-color:#342A4F;padding:24px 32px;">
      <h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:700;">Claims iQ Carrier Audit Result</h1>
      <p style="margin:6px 0 0 0;font-size:13px;color:#CDBFF7;">Claim ${escapeHtml(claimNumber)} — ${escapeHtml(insuredName)} — ${escapeHtml(carrier)}</p>
    </div>

    <div style="padding:24px 32px;">
      <div style="display:flex;background-color:#f3f0f7;border-radius:8px;padding:20px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="text-align:center;padding:8px 16px;border-right:1px solid #e3dfe8;">
              <div style="font-size:32px;font-weight:700;color:#342A4F;">${escapeHtml(String(r.overall_score))}</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;">Overall Score</div>
            </td>
            <td style="text-align:center;padding:8px 16px;border-right:1px solid #e3dfe8;">
              <div style="font-size:24px;font-weight:700;color:#7763B7;">${escapeHtml(String(r.technical_score))}</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;">Technical / 80</div>
            </td>
            <td style="text-align:center;padding:8px 16px;border-right:1px solid #e3dfe8;">
              <div style="font-size:24px;font-weight:700;color:#7763B7;">${escapeHtml(String(r.presentation_score))}</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;">Presentation / 20</div>
            </td>
            <td style="text-align:center;padding:8px 16px;border-right:1px solid #e3dfe8;">
              <div style="font-size:16px;font-weight:700;color:${riskColor};">${escapeHtml(r.risk_level)}</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;">Risk Level</div>
            </td>
            <td style="text-align:center;padding:8px 16px;">
              <div style="font-size:13px;font-weight:700;color:#C6A54E;">${escapeHtml(r.approval_status)}</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;">Status</div>
            </td>
          </tr>
        </table>
      </div>

      <div style="margin-bottom:24px;">
        <h3 style="font-size:15px;font-weight:700;color:#342A4F;margin:0 0 8px 0;">Executive Summary</h3>
        <p style="font-size:14px;line-height:1.6;color:#374151;margin:0;">${escapeHtml(r.executive_summary)}</p>
      </div>

      ${buildScorecardTable("Technical Scorecard", TECHNICAL_SECTIONS, r.section_scores)}
      ${buildScorecardTable("Presentation / Carrier Readiness", PRESENTATION_SECTIONS, r.section_scores)}

      ${buildBulletSection("Critical Failures", r.critical_failures)}
      ${buildBulletSection("Key Defects", r.key_defects)}
      ${buildBulletSection("Presentation Issues", r.presentation_issues)}
      ${buildBulletSection("Carrier Questions", r.carrier_questions)}
      ${buildBulletSection("Deferred Items", r.deferred_items)}
    </div>

    <div style="background-color:#342A4F;padding:16px 32px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#9D8BBF;">Generated by Claims iQ Audit</p>
    </div>
  </div>
</body>
</html>`;
}
