import type { AuditResponse } from "./audit";
import type { CategoryScore } from "./scoringEngine";
import { sendEmail } from "./sendgrid";
import logger from "../lib/logger";

export interface CarrierScorecardAuditResult {
  version: string;
  overall: { total_score: number; max_score: number; percent: number; grade: string; summary: string };
  categories: { key: string; label: string; score: number; max_score: number; finding: string }[];
  issues: { severity: string; title: string; description: string }[];
}

export function renderCarrierScorecardEmail(data: { audit: CarrierScorecardAuditResult }): string {
  return `<html><body><p>Carrier scorecard audit result: ${data.audit.overall.percent}%</p></body></html>`;
}

export async function sendCarrierScorecardEmail(input: {
  to: string;
  subject: string;
  audit: CarrierScorecardAuditResult;
}): Promise<void> {
  const html = renderCarrierScorecardEmail({ audit: input.audit });
  await sendEmail({ to: input.to, subject: input.subject, html });
  logger.info({ sendgrid: "success" }, "Carrier scorecard email sent");
}

interface EmailData {
  claimNumber: string;
  insuredName: string;
  carrier: string;
  auditResult: AuditResponse;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreColor(pct: number): string {
  if (pct >= 80) return "#16a34a";
  if (pct >= 60) return "#ca8a04";
  return "#dc2626";
}

function answerIcon(answer: string): string {
  if (answer === "PASS") return "&#10004;";
  if (answer === "PARTIAL") return "&#9673;";
  if (answer === "NOT_APPLICABLE") return "&#8212;";
  return "&#10008;";
}

function answerColor(answer: string): string {
  if (answer === "PASS") return "#16a34a";
  if (answer === "PARTIAL") return "#ca8a04";
  if (answer === "NOT_APPLICABLE") return "#6b7280";
  return "#dc2626";
}

function readinessColor(r: string): string {
  if (r === "READY") return "#16a34a";
  if (r === "REVIEW") return "#ca8a04";
  return "#dc2626";
}

function readinessBg(r: string): string {
  if (r === "READY") return "#f0fdf4";
  if (r === "REVIEW") return "#fef9ec";
  return "#fef2f2";
}

function buildRootIssueSection(r: AuditResponse): string {
  if (!r.root_issue_groups || r.root_issue_groups.length === 0) return "";

  const cards = r.root_issue_groups.map((g) => {
    const affectsStr = g.affects.map((a) => escapeHtml(a.replace(/_/g, " "))).join(", ");
    const showAffects = g.affects.length > 1 || (g.affects.length === 1 && g.affects[0] !== g.root_issue);
    return `<div style="margin-bottom:12px;padding:12px 16px;border-left:3px solid #dc2626;background-color:#fef2f2;border-radius:4px;">
      <p style="margin:0 0 4px 0;font-size:14px;font-weight:700;color:#342A4F;">${escapeHtml(g.root_issue.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()))}</p>
      ${"issue" in g && (g as any).issue ? `<p style="margin:0 0 4px 0;font-size:13px;color:#374151;">${escapeHtml((g as any).issue)}</p>` : ""}
      ${g.impact ? `<p style="margin:0 0 4px 0;font-size:13px;color:#dc2626;"><strong>Impact:</strong> ${escapeHtml(g.impact)}</p>` : ""}
      ${g.fix ? `<p style="margin:0 0 4px 0;font-size:13px;color:#16a34a;"><strong>Fix:</strong> ${escapeHtml(g.fix)}</p>` : ""}
      ${showAffects ? `<p style="margin:0 0 4px 0;font-size:12px;color:#6b7280;">Affects ${g.affects.length} checks: ${affectsStr}</p>` : ""}
      ${g.evidence_locations.length > 0 ? `<p style="margin:0;font-size:11px;color:#6b7280;">Evidence: ${escapeHtml(g.evidence_locations.join(", "))}</p>` : ""}
    </div>`;
  }).join("");

  return `<div style="margin-bottom:24px;">
    <h3 style="font-size:15px;font-weight:700;color:#342A4F;margin:0 0 12px 0;">&#9888; Root Issues (${r.root_issue_groups.length})</h3>
    ${cards}
  </div>`;
}

function buildActionTable(r: AuditResponse): string {
  if (r.issues.length === 0) return "";

  const rows = r.issues.map((iss) => `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#6b7280;font-weight:600;">${escapeHtml(iss.source_scorecard)}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#374151;">${escapeHtml(iss.issue)}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#16a34a;font-weight:600;">${escapeHtml(iss.fix)}</td>
  </tr>`).join("");

  return `<div style="margin-bottom:24px;">
    <h3 style="font-size:15px;font-weight:700;color:#342A4F;margin:0 0 12px 0;">Detailed Findings (${r.issues.length})</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #fca5a5;border-radius:6px;">
      <thead><tr style="background-color:#fef2f2;">
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#dc2626;border-bottom:2px solid #fca5a5;text-transform:uppercase;width:50px;">Source</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#dc2626;border-bottom:2px solid #fca5a5;text-transform:uppercase;">Issue</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#dc2626;border-bottom:2px solid #fca5a5;text-transform:uppercase;">Fix</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function buildScorecardTable(title: string, categories: CategoryScore[], scorePct: number, awarded: number, possible: number): string {
  let rows = "";
  for (const cat of categories) {
    const catPct = cat.points_possible > 0 ? Math.round((cat.points_awarded / cat.points_possible) * 100) : 0;
    const color = scoreColor(catPct);

    rows += `<tr style="background-color:#f3f0f7;">
      <td colspan="3" style="padding:10px 12px;font-size:13px;font-weight:700;color:#342A4F;border-bottom:1px solid #e5e7eb;">
        ${escapeHtml(cat.category_name)}
        <span style="float:right;color:${color};font-weight:700;">${cat.points_awarded}/${cat.points_possible}</span>
      </td>
    </tr>`;

    for (const q of cat.questions) {
      const icon = answerIcon(q.answer);
      const aColor = answerColor(q.answer);
      const detail = q.answer === "PASS" || q.answer === "NOT_APPLICABLE" ? "" : (q.fix || q.issue || "");

      rows += `<tr>
        <td style="padding:6px 12px 6px 24px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#374151;">${escapeHtml(q.id.replace(/_/g, " "))}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:16px;color:${aColor};font-weight:700;width:40px;">${icon}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#6b7280;font-style:italic;">${escapeHtml(detail)}</td>
      </tr>`;
    }
  }

  const headColor = scoreColor(scorePct);

  return `<div style="margin-bottom:24px;">
    <h3 style="font-size:15px;font-weight:700;color:#342A4F;margin:0 0 8px 0;">
      ${escapeHtml(title)}
      <span style="float:right;font-size:14px;color:${headColor};">${scorePct}% (${awarded}/${possible})</span>
    </h3>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background-color:#fafafa;">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #7763B7;">Question</th>
        <th style="padding:8px 12px;text-align:center;font-size:12px;color:#6b7280;border-bottom:2px solid #7763B7;width:50px;">Result</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #7763B7;">Action</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function buildIssueDetails(r: AuditResponse): string {
  if (r.issues.length === 0) return "";

  const cards = r.issues.map((iss) => {
    const aColor = iss.severity === "fail" ? "#dc2626" : "#ca8a04";
    return `<div style="margin-bottom:16px;padding:12px;border-left:3px solid ${aColor};background-color:#fafafa;">
      <p style="margin:0 0 4px 0;font-size:13px;font-weight:700;color:#342A4F;">[${escapeHtml(iss.source_scorecard)}] ${escapeHtml(iss.question_key.replace(/_/g, " "))}</p>
      ${iss.issue ? `<p style="margin:0 0 4px 0;font-size:13px;color:#374151;"><strong>Issue:</strong> ${escapeHtml(iss.issue)}</p>` : ""}
      ${iss.impact ? `<p style="margin:0 0 4px 0;font-size:13px;color:#374151;"><strong>Impact:</strong> ${escapeHtml(iss.impact)}</p>` : ""}
      ${iss.fix ? `<p style="margin:0 0 4px 0;font-size:13px;color:#16a34a;"><strong>Fix:</strong> ${escapeHtml(iss.fix)}</p>` : ""}
      ${iss.evidence_locations.length > 0 ? `<p style="margin:0;font-size:12px;color:#6b7280;"><strong>Evidence:</strong> ${escapeHtml(iss.evidence_locations.join(", "))}</p>` : ""}
    </div>`;
  }).join("");

  return `<div style="margin-bottom:24px;">
    <h3 style="font-size:15px;font-weight:700;color:#342A4F;margin:0 0 12px 0;">Issue Details</h3>
    ${cards}
  </div>`;
}

function buildValidationSection(r: AuditResponse): string {
  if (r.validation_checks.length === 0) return "";

  const items = r.validation_checks.map((v) => {
    const color = v.severity === "critical" ? "#dc2626" : v.severity === "warning" ? "#ca8a04" : "#6b7280";
    return `<li style="margin-bottom:6px;font-size:13px;color:${color};">${escapeHtml(v.message)}</li>`;
  }).join("");

  return `<div style="margin-bottom:20px;">
    <h3 style="font-size:15px;font-weight:700;color:#342A4F;margin:0 0 8px 0;">Validation Checks</h3>
    <ul style="margin:0;padding-left:20px;">${items}</ul>
  </div>`;
}

export function renderAuditEmail(data: EmailData): string {
  const { claimNumber, insuredName, carrier, auditResult: r } = data;

  const oa = r.overall_audit;
  const da = r.desk_adjuster_scorecard;
  const fa = r.field_adjuster_scorecard;

  const rColor = readinessColor(oa.readiness);
  const rBg = readinessBg(oa.readiness);
  const riskColors: Record<string, string> = { LOW: "#16a34a", MEDIUM: "#ca8a04", HIGH: "#dc2626" };
  const riskColor = riskColors[oa.technical_risk] ?? "#6b7280";
  const daColor = scoreColor(da.score_percent);
  const faColor = scoreColor(fa.score_percent);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f0edf4;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background-color:#ffffff;">
    <div style="background-color:#342A4F;padding:24px 32px;">
      <h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:700;">Claims iQ Carrier Audit Result</h1>
      <p style="margin:6px 0 0 0;font-size:13px;color:#CDBFF7;">Claim ${escapeHtml(claimNumber)} &mdash; ${escapeHtml(insuredName)} &mdash; ${escapeHtml(carrier)}</p>
    </div>

    <div style="padding:24px 32px;">
      <div style="background-color:#f3f0f7;border-radius:8px;padding:20px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="text-align:center;padding:8px 12px;border-right:1px solid #e3dfe8;">
              <div style="font-size:14px;font-weight:700;color:${rColor};padding:6px 12px;border-radius:6px;background-color:${rBg};display:inline-block;">${escapeHtml(oa.readiness)}</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;margin-top:4px;">Readiness</div>
            </td>
            <td style="text-align:center;padding:8px 12px;border-right:1px solid #e3dfe8;">
              <div style="font-size:32px;font-weight:700;color:#342A4F;">${oa.overall_score_percent}%</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;">Overall</div>
            </td>
            <td style="text-align:center;padding:8px 12px;border-right:1px solid #e3dfe8;">
              <div style="font-size:24px;font-weight:700;color:${daColor};">${da.score_percent}%</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;">DA Score</div>
            </td>
            <td style="text-align:center;padding:8px 12px;border-right:1px solid #e3dfe8;">
              <div style="font-size:24px;font-weight:700;color:${faColor};">${fa.score_percent}%</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;">FA Score</div>
            </td>
            <td style="text-align:center;padding:8px 12px;">
              <div style="font-size:16px;font-weight:700;color:${riskColor};">${escapeHtml(oa.technical_risk)}</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;">Risk</div>
            </td>
          </tr>
        </table>
      </div>

      ${buildRootIssueSection(r)}

      ${buildActionTable(r)}

      <div style="margin-bottom:24px;">
        <h3 style="font-size:15px;font-weight:700;color:#342A4F;margin:0 0 8px 0;">Executive Summary</h3>
        <p style="font-size:14px;line-height:1.6;color:#374151;margin:0;">${escapeHtml(oa.executive_summary)}</p>
      </div>

      ${buildScorecardTable("Desk Adjuster Scorecard", da.categories, da.score_percent, da.points_awarded, da.points_possible)}

      ${buildScorecardTable("Field Adjuster Scorecard", fa.categories, fa.score_percent, fa.points_awarded, fa.points_possible)}

      ${buildIssueDetails(r)}

      ${buildValidationSection(r)}
    </div>

    <div style="background-color:#342A4F;padding:16px 32px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#9D8BBF;">Generated by Claims iQ Audit</p>
    </div>
  </div>
</body>
</html>`;
}
