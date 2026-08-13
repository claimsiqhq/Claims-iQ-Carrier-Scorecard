import logger from "../lib/logger";
import { env } from "../env";
import { z } from "zod";

export interface ParsedClaimData {
  claimNumber: string;
  insuredName: string;
  carrier: string;
  dateOfLoss: string;
  policyNumber: string;
  lossType: string;
  propertyAddress: string;
  adjusterName: string;
  adjusterCompany: string;
  totalClaimAmount: string;
  deductible: string;
  summary: string;
}

export class ClaimParsingError extends Error {
  readonly code = "claim_parse_failed";

  constructor(message: string) {
    super(message);
    this.name = "ClaimParsingError";
  }
}

const PARSE_SYSTEM_PROMPT = `You are a structured data extraction engine for insurance claim documents.
You receive the full text of a combined claim PDF package (which may include a DA report, Statement of Loss, payment letter, FA report, estimate, photos descriptions, and other documents).

Your job is to extract key metadata from the text and return it as a JSON object. Parse carefully — these are real insurance documents.

STRICT JSON ONLY — no markdown, no commentary, no code fences. Return exactly this shape:

{
  "claimNumber": "the claim or file number",
  "insuredName": "the insured party's full name",
  "carrier": "the insurance carrier / company name",
  "dateOfLoss": "YYYY-MM-DD format if found, empty string if not",
  "policyNumber": "the policy number if found, empty string if not",
  "lossType": "type of loss (e.g. Wind/Hail, Fire, Water, etc.), empty string if not found",
  "propertyAddress": "the property/risk address if found, empty string if not",
  "adjusterName": "the adjuster or examiner name if found, empty string if not",
  "adjusterCompany": "the adjusting firm name if found, empty string if not",
  "totalClaimAmount": "the total claim/replacement amount as a string (e.g. '$45,230.00'), empty string if not found",
  "deductible": "the deductible amount as a string, empty string if not found",
  "summary": "A 1-2 sentence summary of what this claim is about"
}

If a field cannot be determined from the text, use an empty string — never use null or omit fields.`;

const claimField = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
      : value === undefined || value === null
        ? ""
        : String(value),
  z.string(),
);

const parsedClaimSchema = z
  .object({
    claimNumber: claimField,
    insuredName: claimField,
    carrier: claimField,
    dateOfLoss: claimField,
    policyNumber: claimField,
    lossType: claimField,
    propertyAddress: claimField,
    adjusterName: claimField,
    adjusterCompany: claimField,
    totalClaimAmount: claimField,
    deductible: claimField,
    summary: claimField,
  })
  .strip();

export function parseClaimMetadataResponse(
  rawContent: string,
): ParsedClaimData | null {
  const cleaned = rawContent
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  const candidates = [
    cleaned,
    firstBrace >= 0 && lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(
        candidate.replace(/,\s*([}\]])/g, "$1"),
      );
      const validated = parsedClaimSchema.safeParse(parsed);
      if (validated.success) return validated.data;
    } catch {
      // Try the bounded object candidate before declaring the response invalid.
    }
  }
  return null;
}

export async function parseClaimFromText(
  extractedText: string,
): Promise<ParsedClaimData> {
  const truncated = extractedText.substring(0, 30000);
  const { gemini } =
    await import("@workspace/integrations-openai-ai-server/client");

  let receivedContent = false;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await gemini.chat.completions.create(
      {
        model: env.GEMINI_MODEL,
        temperature: 0,
        max_completion_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PARSE_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              "Extract structured claim metadata from this document text.",
              attempt > 1
                ? "Your previous response was not valid JSON. Return exactly one JSON object with every required key."
                : "",
              "",
              truncated,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      },
      { signal: AbortSignal.timeout(60_000) },
    );
    const content = response.choices[0]?.message?.content;
    if (!content) continue;
    receivedContent = true;
    const parsed = parseClaimMetadataResponse(content);
    if (parsed) return parsed;
    logger.warn(
      { attempt, responseCharacters: content.length },
      "Claim metadata provider returned invalid JSON",
    );
  }

  throw new ClaimParsingError(
    receivedContent
      ? "Claim metadata provider returned invalid JSON"
      : "Claim metadata provider returned an empty response",
  );
}
