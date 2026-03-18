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

export const env = {
  OPENAI_CARRIER_AUDIT_MODEL: readOptionalEnv("OPENAI_CARRIER_AUDIT_MODEL") ?? "gpt-4o",
  SENDGRID_INBOUND_PARSE_TOKEN: readOptionalEnv("SENDGRID_INBOUND_PARSE_TOKEN"),
  OPENAI_VISION_MAX_PDF_PAGES: readOptionalPositiveInt("OPENAI_VISION_MAX_PDF_PAGES") ?? 250,
};

export type ApiEnv = typeof env;
