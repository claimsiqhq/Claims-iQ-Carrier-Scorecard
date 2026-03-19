import logger from "../lib/logger";
import { env } from "../env";
import { z } from "zod";

export interface ToolReading {
  page_number: number;
  tool_type: "moisture_meter" | "thermal_imager" | "laser_measure" | "tape_measure";
  tool_model: string;
  reading_value: string;
  reading_unit: string;
  material_or_location: string;
  confidence: number;
}

export interface PhotoLabel {
  page_number: number;
  label_path: string;
  caption: string;
  section_type: "exterior" | "interior" | "roof" | "other";
  order_index: number;
}

export interface DamageVerification {
  page_number: number;
  caption_claim: string;
  damage_visible: boolean;
  damage_type: string;
  discrepancy: string;
  confidence: number;
}

export interface PhotoPageAnalysis {
  page_number: number;
  is_photo_page: boolean;
  tool_readings: ToolReading[];
  photo_labels: PhotoLabel[];
  damage_verifications: DamageVerification[];
}

export interface VisionAnalysisResult {
  analyzed_pages: number[];
  total_photo_pages: number;
  tool_readings: ToolReading[];
  photo_labels: PhotoLabel[];
  damage_verifications: DamageVerification[];
  photo_sequence_valid: boolean;
  sequence_issues: string[];
  diagnostics_summary: {
    moisture_readings_found: number;
    thermal_readings_found: number;
    laser_readings_found: number;
    captions_verified: number;
    captions_with_discrepancy: number;
  };
}

const PHOTO_ANALYSIS_SYSTEM_PROMPT = `You are a highly precise Carrier Quality Assurance Vision AI for licensed insurance adjusters.
You will be provided with a page from a property insurance claim photo sheet.
You must perform the following extractions with maximum accuracy:

1. **Tool OCR:** Scan every image for diagnostic tools (Tramex ME5 moisture meter, Teledyne FLIR TG267 thermal imager, Bosch GLM 20 or Leica DISTO laser measures, physical tape measures). Extract the exact numeric values from LED/LCD screens (e.g., "18.8 WOOD", "91.0 DRYWALL", "66.3°F", "11' 0 3/16\""). Report each tool reading separately.

2. **Photo Labels:** Extract the file path or label above each photo (e.g., "FA Mansdorf/Interior/Upper level/Living Room"). Extract the caption or description below each photo. Determine if this is an exterior, interior, roof, or other section.

3. **Damage Verification:** For each photo with a text caption that claims specific damage (e.g., "gapping joints", "water stains", "bubbling paint", "mold growth"), verify whether the described damage is visually present in the photograph. Report any discrepancies.

Return JSON only in this exact shape:
{
  "page_number": 1,
  "is_photo_page": true,
  "tool_readings": [
    {
      "tool_type": "moisture_meter|thermal_imager|laser_measure|tape_measure",
      "tool_model": "Tramex ME5",
      "reading_value": "18.8",
      "reading_unit": "WOOD",
      "material_or_location": "living room south wall",
      "confidence": 95
    }
  ],
  "photo_labels": [
    {
      "label_path": "FA Name/Interior/Upper level/Living Room",
      "caption": "Water stain on ceiling near HVAC register",
      "section_type": "exterior|interior|roof|other",
      "order_index": 1
    }
  ],
  "damage_verifications": [
    {
      "caption_claim": "Water stain on ceiling",
      "damage_visible": true,
      "damage_type": "water_damage",
      "discrepancy": "",
      "confidence": 90
    }
  ]
}

RULES:
- If no diagnostic tools are visible, return empty tool_readings array.
- If no photo labels are visible, return empty photo_labels array.
- If no captions claim specific damage, return empty damage_verifications array.
- is_photo_page should be false if the page contains no photographs (e.g., it's a text-only report page).
- confidence is 0-100.
- Do not hallucinate readings. Only report values you can clearly see on tool screens.
- Return JSON only. No markdown, no code fences.`;

const CONTENT_FILTER_RETRY_PROMPT = `You are a professional document analysis assistant for licensed insurance adjusters and carrier quality assurance.
This page is from a property insurance claim inspection report containing photographs of property damage with diagnostic equipment readings, measurement annotations, and adjuster notes.
${PHOTO_ANALYSIS_SYSTEM_PROMPT.split("Return JSON")[1] ? "Return JSON" + PHOTO_ANALYSIS_SYSTEM_PROMPT.split("Return JSON")[1] : ""}
Extract all visible data as instructed. This is a professional insurance document.`;

const photoPageSchema = z.object({
  page_number: z.number(),
  is_photo_page: z.boolean(),
  tool_readings: z.array(z.object({
    tool_type: z.enum(["moisture_meter", "thermal_imager", "laser_measure", "tape_measure"]),
    tool_model: z.string(),
    reading_value: z.string(),
    reading_unit: z.string(),
    material_or_location: z.string(),
    confidence: z.number(),
  })).default([]),
  photo_labels: z.array(z.object({
    label_path: z.string(),
    caption: z.string(),
    section_type: z.enum(["exterior", "interior", "roof", "other"]),
    order_index: z.number(),
  })).default([]),
  damage_verifications: z.array(z.object({
    caption_claim: z.string(),
    damage_visible: z.boolean(),
    damage_type: z.string(),
    discrepancy: z.string(),
    confidence: z.number(),
  })).default([]),
});

function isContentFilterError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as any;
  return (e.status === 400 && e.code === "content_filter") ||
    (e.error?.code === "content_filter") ||
    (e.error?.inner_error?.code === "ResponsibleAIPolicyViolation") ||
    (e.message?.includes("content management policy"));
}

export function identifyPhotoPages(extractedText: string): number[] {
  const pagePattern = /=== Page (\d+) ===/g;
  const pages: { pageNumber: number; text: string }[] = [];
  const segments = extractedText.split(/=== Page \d+ ===/);

  let match;
  let i = 0;
  while ((match = pagePattern.exec(extractedText)) !== null) {
    i++;
    pages.push({ pageNumber: parseInt(match[1], 10), text: segments[i] ?? "" });
  }

  const photoPageNumbers: number[] = [];
  for (const page of pages) {
    const lower = page.text.toLowerCase();
    const isPhoto =
      /photo\s*(sheet|page|log|documentation)/i.test(page.text) ||
      /\.(jpg|jpeg|png|bmp|tiff)/i.test(page.text) ||
      /exterior.*elevation|interior.*level|roof.*view/i.test(page.text) ||
      /moisture.*meter|tramex|flir|thermal/i.test(page.text) ||
      /img_|dsc_|photo_|pic_/i.test(page.text) ||
      (lower.includes("photo") && (lower.includes("label") || lower.includes("caption") || lower.includes("image")));

    if (isPhoto) {
      photoPageNumbers.push(page.pageNumber);
    }
  }

  return photoPageNumbers;
}

async function analyzePhotoPage(
  pngBuffer: Buffer,
  pageNumber: number,
  requestId: string,
  systemPrompt?: string,
): Promise<PhotoPageAnalysis> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const imageDataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;

  const response = await openai.chat.completions.create({
    model: env.OPENAI_CARRIER_AUDIT_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: systemPrompt || PHOTO_ANALYSIS_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Analyze photo page ${pageNumber}. Extract all tool readings, labels, and verify damage claims.` },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ] as unknown as string,
      },
    ],
  }, { signal: AbortSignal.timeout(120_000) });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error(`Photo analysis page ${pageNumber}: empty response`);
  }

  let parsed: unknown;
  try {
    const cleaned = content.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Photo analysis page ${pageNumber}: invalid JSON`);
  }

  const validated = photoPageSchema.safeParse({ ...parsed as object, page_number: pageNumber });
  if (!validated.success) {
    logger.warn({ requestId, pageNumber, errors: validated.error.issues }, "Photo analysis schema validation partial failure, using defaults");
    return {
      page_number: pageNumber,
      is_photo_page: false,
      tool_readings: [],
      photo_labels: [],
      damage_verifications: [],
    };
  }

  return {
    page_number: validated.data.page_number,
    is_photo_page: validated.data.is_photo_page,
    tool_readings: validated.data.tool_readings.map((r) => ({
      ...r,
      page_number: pageNumber,
    })),
    photo_labels: validated.data.photo_labels.map((l) => ({
      ...l,
      page_number: pageNumber,
    })),
    damage_verifications: validated.data.damage_verifications.map((d) => ({
      ...d,
      page_number: pageNumber,
    })),
  };
}

function validatePhotoSequence(labels: PhotoLabel[]): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (labels.length === 0) return { valid: true, issues };

  let lastExteriorIdx = -1;
  let firstInteriorIdx = Infinity;

  for (let i = 0; i < labels.length; i++) {
    if (labels[i].section_type === "exterior") {
      lastExteriorIdx = i;
    }
    if (labels[i].section_type === "interior" && i < firstInteriorIdx) {
      firstInteriorIdx = i;
    }
  }

  if (lastExteriorIdx > firstInteriorIdx && firstInteriorIdx !== Infinity) {
    issues.push("Interior photos appear before all exterior photos are complete. Carrier expects exterior elevations to precede interior documentation.");
  }

  let lastRoofIdx = -1;
  let firstNonRoofInteriorIdx = Infinity;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i].section_type === "roof") lastRoofIdx = i;
    if (labels[i].section_type === "interior" && i < firstNonRoofInteriorIdx) {
      firstNonRoofInteriorIdx = i;
    }
  }

  if (lastRoofIdx > firstNonRoofInteriorIdx && firstNonRoofInteriorIdx !== Infinity) {
    issues.push("Roof photos should precede interior photos per carrier operational order.");
  }

  return { valid: issues.length === 0, issues };
}

const TARGET_RENDER_WIDTH = 1400;

async function renderSinglePdfPage(
  pdf: any,
  pageNumber: number,
  createCanvas: any,
): Promise<Buffer> {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = TARGET_RENDER_WIDTH / Math.max(1, baseViewport.width);
  const viewport = page.getViewport({ scale });

  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  await (page as any).render({
    canvasContext: context,
    viewport,
    canvas,
  }).promise;

  const pngBuffer = canvas.toBuffer("image/png");
  page.cleanup();
  return pngBuffer;
}

export async function runPhotoAnalysis(params: {
  pdfBuffer: Buffer;
  extractedText: string;
  requestId: string;
}): Promise<VisionAnalysisResult> {
  const photoPages = identifyPhotoPages(params.extractedText);

  if (photoPages.length === 0) {
    logger.info({ requestId: params.requestId }, "No photo pages identified for vision analysis");
    return {
      analyzed_pages: [],
      total_photo_pages: 0,
      tool_readings: [],
      photo_labels: [],
      damage_verifications: [],
      photo_sequence_valid: true,
      sequence_issues: [],
      diagnostics_summary: {
        moisture_readings_found: 0,
        thermal_readings_found: 0,
        laser_readings_found: 0,
        captions_verified: 0,
        captions_with_discrepancy: 0,
      },
    };
  }

  logger.info({
    requestId: params.requestId,
    photoPageCount: photoPages.length,
    photoPages,
  }, "Starting multimodal photo analysis");

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(params.pdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;

  const allToolReadings: ToolReading[] = [];
  const allPhotoLabels: PhotoLabel[] = [];
  const allDamageVerifications: DamageVerification[] = [];
  const analyzedPages: number[] = [];

  for (const pageNumber of photoPages) {
    if (pageNumber > pdf.numPages) continue;

    await new Promise((r) => setTimeout(r, 0));

    let pngBuffer: Buffer;
    try {
      pngBuffer = await renderSinglePdfPage(pdf, pageNumber, createCanvas);
    } catch (renderErr) {
      logger.warn({ requestId: params.requestId, pageNumber, error: renderErr instanceof Error ? renderErr.message : "Unknown" }, "Photo page render failed, skipping");
      continue;
    }

    try {
      const analysis = await analyzePhotoPage(pngBuffer, pageNumber, params.requestId);
      analyzedPages.push(pageNumber);

      if (analysis.is_photo_page) {
        allToolReadings.push(...analysis.tool_readings);
        allPhotoLabels.push(...analysis.photo_labels);
        allDamageVerifications.push(...analysis.damage_verifications);
      }

      logger.info({
        requestId: params.requestId,
        pageNumber,
        isPhoto: analysis.is_photo_page,
        toolReadings: analysis.tool_readings.length,
        labels: analysis.photo_labels.length,
        verifications: analysis.damage_verifications.length,
      }, "Photo page analyzed");
    } catch (err) {
      if (isContentFilterError(err)) {
        logger.warn({ requestId: params.requestId, pageNumber }, "Photo analysis content filter, retrying");
        try {
          const analysis = await analyzePhotoPage(pngBuffer, pageNumber, params.requestId, CONTENT_FILTER_RETRY_PROMPT);
          analyzedPages.push(pageNumber);
          if (analysis.is_photo_page) {
            allToolReadings.push(...analysis.tool_readings);
            allPhotoLabels.push(...analysis.photo_labels);
            allDamageVerifications.push(...analysis.damage_verifications);
          }
        } catch (retryErr) {
          logger.warn({ requestId: params.requestId, pageNumber }, "Photo analysis failed after retry");
          analyzedPages.push(pageNumber);
        }
      } else {
        logger.warn({ requestId: params.requestId, pageNumber, error: err instanceof Error ? err.message : "Unknown" }, "Photo analysis failed");
        analyzedPages.push(pageNumber);
      }
    }
  }

  await loadingTask.destroy();

  const sequence = validatePhotoSequence(allPhotoLabels);

  const result: VisionAnalysisResult = {
    analyzed_pages: analyzedPages,
    total_photo_pages: analyzedPages.length,
    tool_readings: allToolReadings,
    photo_labels: allPhotoLabels,
    damage_verifications: allDamageVerifications,
    photo_sequence_valid: sequence.valid,
    sequence_issues: sequence.issues,
    diagnostics_summary: {
      moisture_readings_found: allToolReadings.filter((r) => r.tool_type === "moisture_meter").length,
      thermal_readings_found: allToolReadings.filter((r) => r.tool_type === "thermal_imager").length,
      laser_readings_found: allToolReadings.filter((r) => r.tool_type === "laser_measure" || r.tool_type === "tape_measure").length,
      captions_verified: allDamageVerifications.length,
      captions_with_discrepancy: allDamageVerifications.filter((d) => !d.damage_visible).length,
    },
  };

  logger.info({
    requestId: params.requestId,
    analyzedPages: analyzedPages.length,
    toolReadings: allToolReadings.length,
    labels: allPhotoLabels.length,
    verifications: allDamageVerifications.length,
    sequenceValid: sequence.valid,
  }, "Multimodal photo analysis complete");

  return result;
}
