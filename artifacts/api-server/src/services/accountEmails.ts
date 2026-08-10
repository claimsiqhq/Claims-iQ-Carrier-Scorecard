import { env } from "../env";
import { sendEmail } from "./sendgrid";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function actionEmail(input: {
  eyebrow: string;
  title: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  expiryLabel: string;
}): { html: string; text: string } {
  const html = `
    <div style="margin:0;background:#f4f1eb;padding:32px 16px;color:#251f29;font-family:Arial,sans-serif">
      <div style="margin:0 auto;max-width:600px;border:1px solid #d8d0c7;background:#ffffff;padding:32px">
        <p style="margin:0 0 12px;color:#8a5c16;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase">${escapeHtml(input.eyebrow)}</p>
        <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:30px;line-height:1.2">${escapeHtml(input.title)}</h1>
        <p style="margin:0 0 24px;color:#5e5662;font-size:15px;line-height:1.7">${escapeHtml(input.intro)}</p>
        <p style="margin:0 0 24px">
          <a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;background:#127f78;color:#ffffff;padding:13px 20px;text-decoration:none;font-weight:700">${escapeHtml(input.actionLabel)}</a>
        </p>
        <p style="margin:0 0 10px;color:#6e6571;font-size:13px;line-height:1.6">${escapeHtml(input.expiryLabel)}</p>
        <p style="margin:0;color:#8a828c;font-size:12px;line-height:1.6">If you did not expect this message, do not use the link. Complete iQ will never ask you to send a password by email.</p>
      </div>
    </div>
  `;
  const text = [
    input.title,
    "",
    input.intro,
    "",
    `${input.actionLabel}: ${input.actionUrl}`,
    "",
    input.expiryLabel,
    "If you did not expect this message, do not use the link.",
  ].join("\n");
  return { html, text };
}

export async function sendInvitationEmail(input: {
  to: string;
  organizationName: string;
  role: string;
  token: string;
  expiresAt: Date;
}): Promise<void> {
  const actionUrl = `${env.APP_PUBLIC_URL}/accept-invitation#token=${encodeURIComponent(input.token)}`;
  const content = actionEmail({
    eyebrow: "Complete iQ invitation",
    title: `Join ${input.organizationName}`,
    intro: `You have been invited to Complete iQ Carrier Audit with the ${input.role} role. Accept the invitation to verify your account and establish secure access.`,
    actionLabel: "Accept invitation",
    actionUrl,
    expiryLabel: `This single-use invitation expires ${input.expiresAt.toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })}.`,
  });
  await sendEmail({
    to: input.to,
    subject: `Invitation to ${input.organizationName} in Complete iQ`,
    ...content,
    disableTracking: true,
  });
}

export async function sendPasswordResetEmail(input: {
  to: string;
  token: string;
  expiresAt: Date;
}): Promise<void> {
  const actionUrl = `${env.APP_PUBLIC_URL}/reset-password#token=${encodeURIComponent(input.token)}`;
  const content = actionEmail({
    eyebrow: "Complete iQ account security",
    title: "Reset your password",
    intro: "A password reset was requested for your Complete iQ account. Choose a new password using the secure single-use link below.",
    actionLabel: "Reset password",
    actionUrl,
    expiryLabel: `This link expires ${input.expiresAt.toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })}.`,
  });
  await sendEmail({
    to: input.to,
    subject: "Reset your Complete iQ password",
    ...content,
    disableTracking: true,
  });
}
