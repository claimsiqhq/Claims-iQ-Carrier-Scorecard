import { openai } from "@workspace/integrations-openai-ai-server";
import logger from "../lib/logger";

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

export async function parseClaimFromText(extractedText: string): Promise<ParsedClaimData> {
  const truncated = extractedText.substring(0, 30000);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 2048,
    messages: [
      { role: "system", content: PARSE_SYSTEM_PROMPT },
      { role: "user", content: `Extract structured claim metadata from this document text:\n\n${truncated}` },
    ],
  }, { signal: AbortSignal.timeout(60_000) });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    logger.error("Empty OpenAI response for claim parsing");
    return getFallbackParsedData();
  }

  const cleaned = content
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      claimNumber: parsed.claimNumber || "",
      insuredName: parsed.insuredName || "",
      carrier: parsed.carrier || "",
      dateOfLoss: parsed.dateOfLoss || "",
      policyNumber: parsed.policyNumber || "",
      lossType: parsed.lossType || "",
      propertyAddress: parsed.propertyAddress || "",
      adjusterName: parsed.adjusterName || "",
      adjusterCompany: parsed.adjusterCompany || "",
      totalClaimAmount: parsed.totalClaimAmount || "",
      deductible: parsed.deductible || "",
      summary: parsed.summary || "",
    };
  } catch (e) {
    logger.error({ contentPreview: content?.substring(0, 200) }, "Failed to parse OpenAI claim extraction response");
    return getFallbackParsedData();
  }
}

function getFallbackParsedData(): ParsedClaimData {
  return {
    claimNumber: "",
    insuredName: "",
    carrier: "",
    dateOfLoss: "",
    policyNumber: "",
    lossType: "",
    propertyAddress: "",
    adjusterName: "",
    adjusterCompany: "",
    totalClaimAmount: "",
    deductible: "",
    summary: "",
  };
}
