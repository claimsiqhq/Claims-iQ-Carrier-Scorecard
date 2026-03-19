import type { AuditResponse } from "./audit";
import type { CarrierScorecardAuditResult } from "./carrierScorecardAudit";
import { QUESTION_BANK, SECTION_LABELS } from "./questionBank";
import { sendEmail } from "./sendgrid";
import logger from "../lib/logger";

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

function scoreColor(score: number, max: number): string {
  if (max === 0) return "#6b7280";
  const pct = (score / max) * 100;
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

function buildActionRequired(r: AuditResponse): string {
  const actionItems = r.questions.filter((q) => q.answer !== "PASS" && q.answer !== "NOT_APPLICABLE");
  if (actionItems.length === 0) return "";

  const items = actionItems
    .map((q) => {
      const qDef = QUESTION_BANK.find((qb) => qb.id === q.id);
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#374151;font-weight:600;">${escapeHtml(qDef?.text || q.id)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#dc2626;">${escapeHtml(q.fix || q.issue || "")}</td>
      </tr>`;
    })
    .join("");

  return `
    <div style="margin-bottom:24px;">
      <h3 style="font-size:15px;font-weight:700;color:#342A4F;margin:0 0 12px 0;">&#9888; Action Required</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #fca5a5;border-radius:6px;">
        <thead>
          <tr style="background-color:#fef2f2;">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#dc2626;border-bottom:2px solid #fca5a5;text-transform:uppercase;">Question</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#dc2626;border-bottom:2px solid #fca5a5;text-transform:uppercase;">Fix Required</th>
          </tr>
        </thead>
        <tbody>${items}</tbody>
      </table>
    </div>`;
}

function buildQuestionDetails(r: AuditResponse): string {
  const failPartial = r.questions.filter((q) => q.answer === "FAIL" || q.answer === "PARTIAL");
  if (failPartial.length === 0) return "";

  const rows = failPartial
    .map((q) => {
      const qDef = QUESTION_BANK.find((qb) => qb.id === q.id);
      const aColor = answerColor(q.answer);
      return `<div style="margin-bottom:16px;padding:12px;border-left:3px solid ${aColor};background-color:#fafafa;">
        <p style="margin:0 0 4px 0;font-size:14px;font-weight:700;color:#342A4F;">${escapeHtml(qDef?.text || q.id)}</p>
        ${q.issue ? `<p style="margin:0 0 4px 0;font-size:13px;color:#374151;"><strong>Issue:</strong> ${escapeHtml(q.issue)}</p>` : ""}
        ${q.impact ? `<p style="margin:0 0 4px 0;font-size:13px;color:#374151;"><strong>Impact:</strong> ${escapeHtml(q.impact)}</p>` : ""}
        ${q.fix ? `<p style="margin:0 0 4px 0;font-size:13px;color:#16a34a;"><strong>Fix:</strong> ${escapeHtml(q.fix)}</p>` : ""}
        ${q.location ? `<p style="margin:0;font-size:12px;color:#6b7280;"><strong>Location:</strong> ${escapeHtml(q.location)}</p>` : ""}
      </div>`;
    })
    .join("");

  return `
    <div style="margin-bottom:24px;">
      <h3 style="font-size:15px;font-weight:700;color:#342A4F;margin:0 0 12px 0;">Issue Details</h3>
      ${rows}
    </div>`;
}

function buildQuestionTable(r: AuditResponse): string {
  const sectionKeys = ["coverage", "scope", "financial", "documentation", "presentation"];

  let rows = "";
  for (const sectionKey of sectionKeys) {
    const label = SECTION_LABELS[sectionKey] || sectionKey;
    const sectionScore = r.section_scores[sectionKey] ?? 0;
    const sectionMax = r.section_max[sectionKey] ?? 0;
    const color = scoreColor(sectionScore, sectionMax);

    rows += `<tr style="background-color:#f3f0f7;">
      <td colspan="3" style="padding:10px 12px;font-size:13px;font-weight:700;color:#342A4F;border-bottom:1px solid #e5e7eb;">
        ${escapeHtml(label)}
        <span style="float:right;color:${color};font-weight:700;">${sectionScore}/${sectionMax}</span>
      </td>
    </tr>`;

    const sectionQuestions = r.questions.filter((q) => {
      const qDef = QUESTION_BANK.find((qb) => qb.id === q.id);
      return qDef?.section === sectionKey;
    });

    for (const q of sectionQuestions) {
      const qDef = QUESTION_BANK.find((qb) => qb.id === q.id);
      const icon = answerIcon(q.answer);
      const aColor = answerColor(q.answer);
      const detail = q.answer === "PASS" ? "" : (q.fix || q.issue || "");

      rows += `<tr>
        <td style="padding:6px 12px 6px 24px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#374151;">${escapeHtml(qDef?.text || q.id)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:16px;color:${aColor};font-weight:700;">${icon}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#6b7280;font-style:italic;">${escapeHtml(detail)}</td>
      </tr>`;
    }
  }

  return `
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <thead>
        <tr style="background-color:#fafafa;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #7763B7;">Question</th>
          <th style="padding:8px 12px;text-align:center;font-size:12px;color:#6b7280;border-bottom:2px solid #7763B7;width:50px;">Result</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #7763B7;">Action</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildValidationSection(r: AuditResponse): string {
  if (!r.validation) return "";
  const v = r.validation;
  const allIssues = [...v.critical, ...v.warnings, ...v.info];
  if (allIssues.length === 0) return "";

  const items = allIssues.map((i) => {
    const color = v.critical.includes(i) ? "#dc2626" : v.warnings.includes(i) ? "#ca8a04" : "#6b7280";
    return `<li style="margin-bottom:6px;font-size:13px;color:${color};">${escapeHtml(i.message)}</li>`;
  }).join("");

  return `
    <div style="margin-bottom:20px;">
      <h3 style="font-size:15px;font-weight:700;color:#342A4F;margin:0 0 8px 0;">Validation Checks</h3>
      <ul style="margin:0;padding-left:20px;">${items}</ul>
    </div>`;
}

export function renderAuditEmail(data: EmailData): string {
  const { claimNumber, insuredName, carrier, auditResult: r } = data;

  const riskColors: Record<string, string> = { LOW: "#16a34a", MEDIUM: "#ca8a04", HIGH: "#dc2626" };
  const riskColor = riskColors[r.risk_level] ?? "#6b7280";

  const techColor = scoreColor(r.technical_score, r.technical_max);
  const presColor = scoreColor(r.presentation_score, r.presentation_max);

  const readyText = r.ready ? "YES" : "NO";
  const readyColor = r.ready ? "#16a34a" : "#dc2626";
  const readyBg = r.ready ? "#f0fdf4" : "#fef2f2";

  logger.info("Email rendered");

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
      <div style="background-color:#f3f0f7;border-radius:8px;padding:20px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="text-align:center;padding:8px 12px;border-right:1px solid #e3dfe8;">
              <div style="font-size:14px;font-weight:700;color:${readyColor};padding:6px 12px;border-radius:6px;background-color:${readyBg};display:inline-block;">${readyText}</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;margin-top:4px;">Ready</div>
            </td>
            <td style="text-align:center;padding:8px 12px;border-right:1px solid #e3dfe8;">
              <div style="font-size:32px;font-weight:700;color:#342A4F;">${r.percent}%</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;">Score</div>
            </td>
            <td style="text-align:center;padding:8px 12px;border-right:1px solid #e3dfe8;">
              <div style="font-size:24px;font-weight:700;color:${techColor};">${r.technical_score}/${r.technical_max}</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;">Technical</div>
            </td>
            <td style="text-align:center;padding:8px 12px;border-right:1px solid #e3dfe8;">
              <div style="font-size:24px;font-weight:700;color:${presColor};">${r.presentation_score}/${r.presentation_max}</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;">Presentation</div>
            </td>
            <td style="text-align:center;padding:8px 12px;">
              <div style="font-size:16px;font-weight:700;color:${riskColor};">${escapeHtml(r.risk_level)}</div>
              <div style="font-size:11px;color:#9D8BBF;text-transform:uppercase;letter-spacing:0.05em;">Risk</div>
            </td>
          </tr>
        </table>
      </div>

      ${buildActionRequired(r)}

      <div style="margin-bottom:24px;">
        <h3 style="font-size:15px;font-weight:700;color:#342A4F;margin:0 0 8px 0;">Executive Summary</h3>
        <p style="font-size:14px;line-height:1.6;color:#374151;margin:0;">${escapeHtml(r.executive_summary)}</p>
      </div>

      ${buildQuestionDetails(r)}

      ${buildQuestionTable(r)}

      ${buildValidationSection(r)}
    </div>

    <div style="background-color:#342A4F;padding:16px 32px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#9D8BBF;">Generated by Claims iQ Audit</p>
    </div>
  </div>
</body>
</html>`;
}

interface CarrierScorecardEmailData {
  audit: CarrierScorecardAuditResult;
}

function renderCarrierCategoryRows(audit: CarrierScorecardAuditResult): string {
  return audit.categories.map((category) => {
    return `<tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;">${escapeHtml(category.label)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:13px;color:#111827;font-weight:600;">${category.score}/${category.max_score}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${escapeHtml(category.finding)}</td>
    </tr>`;
  }).join("");
}

function renderCarrierIssues(audit: CarrierScorecardAuditResult): string {
  if (audit.issues.length === 0) {
    return `<p style="font-size:13px;color:#6b7280;margin:0;">No issues reported.</p>`;
  }
  return `<ul style="margin:0;padding-left:18px;">
    ${audit.issues.map((issue) => `<li style="font-size:13px;color:#374151;margin-bottom:6px;">
      <strong>${escapeHtml(issue.severity.toUpperCase())}</strong>: ${escapeHtml(issue.title)} - ${escapeHtml(issue.description)}
    </li>`).join("")}
  </ul>`;
}

export function renderCarrierScorecardEmail(data: CarrierScorecardEmailData): string {
  const { audit } = data;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:680px;margin:0 auto;background-color:#ffffff;">
    <div style="padding:20px 24px;background-color:#342A4F;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;line-height:1.3;">Carrier Scorecard Audit</h1>
      <p style="margin:8px 0 0 0;color:#d1c8ee;font-size:13px;">Version ${escapeHtml(audit.version)}</p>
    </div>
    <div style="padding:20px 24px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
        <tr>
          <td style="padding:10px;border:1px solid #e5e7eb;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:#111827;">${audit.overall.total_score}/${audit.overall.max_score}</div>
            <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Total Score</div>
          </td>
          <td style="padding:10px;border:1px solid #e5e7eb;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:#111827;">${audit.overall.percent}%</div>
            <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Percent</div>
          </td>
          <td style="padding:10px;border:1px solid #e5e7eb;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:#111827;">${escapeHtml(audit.overall.grade)}</div>
            <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Grade</div>
          </td>
        </tr>
      </table>

      <div style="margin-bottom:20px;">
        <h3 style="margin:0 0 8px 0;font-size:15px;color:#111827;">Summary</h3>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${escapeHtml(audit.overall.summary)}</p>
      </div>

      <div style="margin-bottom:20px;overflow-x:auto;">
        <h3 style="margin:0 0 8px 0;font-size:15px;color:#111827;">Category Scores</h3>
        <table style="width:100%;border-collapse:collapse;min-width:520px;">
          <thead>
            <tr style="background-color:#f9fafb;">
              <th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:12px;text-transform:uppercase;color:#6b7280;">Category</th>
              <th style="padding:10px;text-align:center;border-bottom:1px solid #e5e7eb;font-size:12px;text-transform:uppercase;color:#6b7280;">Score</th>
              <th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:12px;text-transform:uppercase;color:#6b7280;">Finding</th>
            </tr>
          </thead>
          <tbody>${renderCarrierCategoryRows(audit)}</tbody>
        </table>
      </div>

      <div style="margin-bottom:12px;">
        <h3 style="margin:0 0 8px 0;font-size:15px;color:#111827;">Issues</h3>
        ${renderCarrierIssues(audit)}
      </div>
    </div>
  </div>
</body>
</html>`;
}

export async function sendCarrierScorecardEmail(input: {
  to: string;
  subject: string;
  audit: CarrierScorecardAuditResult;
}): Promise<void> {
  const html = renderCarrierScorecardEmail({ audit: input.audit });
  await sendEmail({
    to: input.to,
    subject: input.subject,
    html,
  });
  logger.info({ sendgrid: "success" }, "Carrier scorecard email sent");
}
