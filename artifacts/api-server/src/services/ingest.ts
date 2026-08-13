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
      if (
        validated.success
        && Object.values(validated.data).some((value) => value.trim())
      ) {
        return validated.data;
      }
    } catch {
      // Try the bounded object candidate before declaring the response invalid.
    }
  }
  return null;
}

function firstLineMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = match?.[1]?.replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return "";
}

export function parseClaimMetadataFallback(
  extractedText: string,
): ParsedClaimData {
  const text = extractedText.substring(0, 60000);
  const claimNumber = firstLineMatch(text, [
    /\bclaim\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9._/-]{2,64})/i,
    /\bfile\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9._/-]{2,64})/i,
  ]);
  const insuredName = firstLineMatch(text, [
    /\binsured(?:\s+name)?\s*[:#-]\s*([^\n\r]+)/i,
    /\bpolicyholder\s*[:#-]\s*([^\n\r]+)/i,
  ]);
  const policyNumber = firstLineMatch(text, [
    /\bpolicy\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9._/-]{2,64})/i,
  ]);
  const dateOfLoss = firstLineMatch(text, [
    /\bdate\s+of\s+loss\s*[:#-]\s*(\d{1,4}[/-]\d{1,2}[/-]\d{1,4})/i,
    /\bloss\s+date\s*[:#-]\s*(\d{1,4}[/-]\d{1,2}[/-]\d{1,4})/i,
  ]);
  const lossType = firstLineMatch(text, [
    /\b(?:loss\s+type|cause\s+of\s+loss|peril)\s*[:#-]\s*([^\n\r]+)/i,
  ]);
  const propertyAddress = firstLineMatch(text, [
    /\b(?:loss\s+location|property\s+address|risk\s+address)\s*[:#-]\s*([^\n\r]+)/i,
  ]);
  const adjusterName = firstLineMatch(text, [
    /\b(?:adjuster|examiner)\s*(?:name)?\s*[:#-]\s*([^\n\r]+)/i,
  ]);
  const totalClaimAmount = firstLineMatch(text, [
    /\b(?:total\s+claim\s+amount|replacement\s+cost|total\s+rcv|payment\s+amount)\s*[:#-]?\s*(\$?[\d,]+(?:\.\d{2})?)/i,
  ]);
  const deductible = firstLineMatch(text, [
    /\bdeductible\s*[:#-]?\s*(\$?[\d,]+(?:\.\d{2})?)/i,
  ]);
  return {
    claimNumber,
    insuredName,
    carrier: "",
    dateOfLoss,
    policyNumber,
    lossType,
    propertyAddress,
    adjusterName,
    adjusterCompany: "",
    totalClaimAmount,
    deductible,
    summary:
      [lossType, propertyAddress].filter(Boolean).join(" loss at ")
      || "Claim metadata was recovered from deterministic document fields.",
  };
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

  const fallback = parseClaimMetadataFallback(extractedText);
  logger.warn(
    {
      providerReturnedContent: receivedContent,
      recoveredFieldCount: Object.values(fallback).filter(Boolean).length,
    },
    "Using deterministic fallback for claim metadata",
  );
  return fallback;
}
