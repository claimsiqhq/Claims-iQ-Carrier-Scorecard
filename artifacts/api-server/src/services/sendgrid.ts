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
  text?: string;
  disableTracking?: boolean;
}): Promise<void> {
  ensureInit();

  const fromAddr = options.from || process.env.SENDGRID_FROM_EMAIL;
  if (!fromAddr) {
    throw new Error("SENDGRID_FROM_EMAIL is not set in environment variables");
  }

  await sgMail.send({
    to: options.to,
    from: fromAddr,
    subject: options.subject,
    html: options.html,
    text: options.text,
    trackingSettings: options.disableTracking
      ? {
          clickTracking: { enable: false, enableText: false },
          openTracking: { enable: false },
          subscriptionTracking: { enable: false },
        }
      : undefined,
  });
}
