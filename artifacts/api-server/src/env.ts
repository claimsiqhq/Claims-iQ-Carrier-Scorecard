function readOptionalEnv(key: string): string | undefined {
  const value = process.env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const env = {
  OPENAI_CARRIER_AUDIT_MODEL: readOptionalEnv("OPENAI_CARRIER_AUDIT_MODEL") ?? "gpt-4o",
  SENDGRID_INBOUND_PARSE_TOKEN: readOptionalEnv("SENDGRID_INBOUND_PARSE_TOKEN"),
};

export type ApiEnv = typeof env;
