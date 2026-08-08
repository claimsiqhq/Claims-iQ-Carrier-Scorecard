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

export const env = {
  CARRIER_AUDIT_MODEL: readOptionalEnv("GEMINI_AUDIT_MODEL") ?? "gemini-3.1-pro-preview",
  SENDGRID_INBOUND_PARSE_TOKEN: readOptionalEnv("SENDGRID_INBOUND_PARSE_TOKEN"),
  OPENAI_VISION_MAX_PDF_PAGES: readOptionalPositiveInt("OPENAI_VISION_MAX_PDF_PAGES") ?? 250,
  ALLOWED_ORIGINS: readCommaSeparatedEnv("ALLOWED_ORIGINS"),
};

export type ApiEnv = typeof env;
