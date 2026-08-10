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

export function renderAccountActionEmail(input: {
  eyebrow: string;
  title: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  expiryLabel: string;
}): { html: string; text: string } {
  const eyebrow = escapeHtml(input.eyebrow);
  const title = escapeHtml(input.title);
  const intro = escapeHtml(input.intro);
  const actionLabel = escapeHtml(input.actionLabel);
  const actionUrl = escapeHtml(input.actionUrl);
  const expiryLabel = escapeHtml(input.expiryLabel);
  const logoUrl = escapeHtml(
    `${env.APP_PUBLIC_URL}/images/complete-iq-signature.png`,
  );
  const preheader = escapeHtml(
    `${input.title} — secure account action from Complete iQ Carrier Audit`,
  );
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f3f8;color:#2f2840;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f5f3f8">
      <tr>
        <td align="center" style="padding:36px 16px">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #ded9e7;border-top:6px solid #382b55;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(42,31,65,.08)">
            <tr>
              <td align="center" style="padding:28px 32px 24px;border-bottom:1px solid #ece8f1;background:#ffffff">
                <a href="${escapeHtml(env.APP_PUBLIC_URL)}" style="text-decoration:none">
                  <img src="${logoUrl}" width="132" alt="Complete iQ" style="display:block;width:132px;max-width:100%;height:auto;border:0">
                </a>
                <p style="margin:14px 0 0;color:#6e647d;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase">Carrier Audit</p>
              </td>
            </tr>
            <tr>
              <td style="padding:38px 42px 20px">
                <p style="margin:0 0 12px;color:#17877f;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase">${eyebrow}</p>
                <h1 style="margin:0 0 18px;color:#382b55;font-size:30px;font-weight:700;line-height:1.25;letter-spacing:-.02em">${title}</h1>
                <p style="margin:0;color:#62596f;font-size:16px;line-height:1.7">${intro}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 42px 30px">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td align="center" bgcolor="#382b55" style="border-radius:7px">
                      <a href="${actionUrl}" style="display:inline-block;padding:14px 24px;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;border-radius:7px">${actionLabel}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 42px 32px">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f5f3f8;border-left:4px solid #17877f;border-radius:6px">
                  <tr>
                    <td style="padding:16px 18px">
                      <p style="margin:0 0 5px;color:#382b55;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Secure, single-use link</p>
                      <p style="margin:0;color:#685f75;font-size:13px;line-height:1.55">${expiryLabel}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 42px 36px">
                <p style="margin:0 0 8px;color:#766d80;font-size:12px;line-height:1.6">If the button does not work, copy and paste this address into your browser:</p>
                <p style="margin:0;word-break:break-all;color:#17877f;font-size:12px;line-height:1.6"><a href="${actionUrl}" style="color:#17877f;text-decoration:underline">${actionUrl}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 42px;background:#382b55">
                <p style="margin:0 0 6px;color:#ffffff;font-size:13px;font-weight:700">Complete iQ Carrier Audit</p>
                <p style="margin:0;color:#d9d2e5;font-size:11px;line-height:1.6">If you did not request this action, you can safely ignore this email. Complete iQ will never ask you to send a password by email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  const text = [
    "COMPLETE iQ CARRIER AUDIT",
    "Secure, evidence-led carrier review",
    "",
    input.title,
    "",
    input.intro,
    "",
    `${input.actionLabel}: ${input.actionUrl}`,
    "",
    input.expiryLabel,
    "If you did not request this action, you can safely ignore this email.",
    "Complete iQ will never ask you to send a password by email.",
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
  const content = renderAccountActionEmail({
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
  const content = renderAccountActionEmail({
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
