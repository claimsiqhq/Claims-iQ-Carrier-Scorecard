function readOptionalEnv(key: string): string | undefined {
  const value = process.env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalPositiveInt(key: string): number | undefined {
  const raw = readOptionalEnv(key);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function readCommaSeparatedEnv(key: string): string[] {
  return (readOptionalEnv(key) ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function readPublicUrl(allowedOrigins: string[]): string {
  const raw =
    readOptionalEnv("APP_PUBLIC_URL")
    ?? allowedOrigins[0]
    ?? "http://localhost:5173";
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("APP_PUBLIC_URL must be an HTTP(S) URL without credentials");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

const allowedOrigins = readCommaSeparatedEnv("ALLOWED_ORIGINS");

export const env = {
  GEMINI_MODEL: readOptionalEnv("GEMINI_MODEL") ?? "gemini-3.6-flash",
  SENDGRID_INBOUND_PARSE_TOKEN: readOptionalEnv("SENDGRID_INBOUND_PARSE_TOKEN"),
  GEMINI_VISION_MAX_PDF_PAGES:
    readOptionalPositiveInt("GEMINI_VISION_MAX_PDF_PAGES") ?? 250,
  ALLOWED_ORIGINS: allowedOrigins,
  APP_PUBLIC_URL: readPublicUrl(allowedOrigins),
  PASSWORD_RESET_TTL_MINUTES:
    readOptionalPositiveInt("PASSWORD_RESET_TTL_MINUTES") ?? 60,
  INVITATION_TTL_HOURS:
    readOptionalPositiveInt("INVITATION_TTL_HOURS") ?? 48,
};

export type ApiEnv = typeof env;
