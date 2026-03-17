import sgMail from "@sendgrid/mail";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const key = process.env.SENDGRID_API_KEY;
  if (!key) {
    throw new Error("SENDGRID_API_KEY is not set in environment secrets");
  }
  sgMail.setApiKey(key);
  initialized = true;
}

export async function sendEmail(options: {
  to: string;
  from?: string;
  subject: string;
  html: string;
}): Promise<void> {
  ensureInit();

  const fromAddr = options.from || process.env.SENDGRID_FROM_EMAIL || "john@claimsiq.ai";

  await sgMail.send({
    to: options.to,
    from: fromAddr,
    subject: options.subject,
    html: options.html,
  });
}
