import path from "node:path";
import { uploadFile } from "../lib/supabaseStorage";
import logger from "../lib/logger";
import { env } from "../env";
import { z } from "zod";

type SourceKind = "standalone_ui" | "sendgrid_inbound";

export interface PersistedReportInput {
  source: SourceKind;
  requestId: string;
  uploaderUserId?: string;
  senderEmail?: string;
  file?: Express.Multer.File;
  reportText?: string;
}

export interface PersistedReportResult {
  reportText: string;
  documentId?: string;
  storagePath?: string;
  extractionMethod: "openai_vision_pages" | "plain_text";
}

function safeFileName(originalName: string): string {
  const base = path.basename(originalName || "report.pdf");
  return base.replace(/[^\w.\-]/g, "_");
}

const pageExtractionSchema = z.object({
  page_number: z.number().int().positive(),
  text: z.string(),
}).strict();

const TARGET_RENDER_WIDTH = 1400;

type RenderedPage = {
  pageNumber: number;
  width: number;
  height: number;
  pngBuffer: Buffer;
};

async function renderPdfToPngPages(pdfBuffer: Buffer): Promise<RenderedPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;

  if (pdf.numPages > env.OPENAI_VISION_MAX_PDF_PAGES) {
    throw new Error(`PDF has ${pdf.numPages} pages; configured limit is ${env.OPENAI_VISION_MAX_PDF_PAGES}.`);
  }

  const pages: RenderedPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = TARGET_RENDER_WIDTH / Math.max(1, baseViewport.width);
    const viewport = page.getViewport({ scale });

    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");

    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    pages.push({
      pageNumber,
      width,
      height,
      pngBuffer: canvas.toBuffer("image/png"),
    });

    page.cleanup();
  }

  await loadingTask.destroy();
  return pages;
}

async function extractSinglePageTextWithVision(params: {
  page: RenderedPage;
  requestId: string;
}): Promise<string> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const imageDataUrl = `data:image/png;base64,${params.page.pngBuffer.toString("base64")}`;

  const response = await openai.chat.completions.create({
    model: env.OPENAI_CARRIER_AUDIT_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are an extraction assistant.",
          "Return JSON only in this exact shape:",
          '{"page_number":1,"text":"<full extracted page text>"}',
          "Extract all visible text from the page in reading order.",
          "Do not summarize.",
          "Do not omit tables, headers, footers, or labels.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Extract page ${params.page.pageNumber}.` },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ] as unknown as string,
      },
    ],
  }, { signal: AbortSignal.timeout(120_000) });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error(`Page ${params.page.pageNumber} extraction returned empty content.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Page ${params.page.pageNumber} extraction returned invalid JSON.`);
  }

  const validated = pageExtractionSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Page ${params.page.pageNumber} extraction failed schema validation.`);
  }

  logger.info({
    requestId: params.requestId,
    page_number: params.page.pageNumber,
    openai_request_id: response.id,
    model: env.OPENAI_CARRIER_AUDIT_MODEL,
  }, "Vision page extraction completed");

  return validated.data.text.trim();
}

export async function extractPdfTextWithVisionPages(params: {
  pdfBuffer: Buffer;
  fileName: string;
  requestId: string;
}): Promise<{
  text: string;
  extractionDocument: {
    version: "final_report_extraction_v1";
    source: "openai_vision_page_by_page";
    model: string;
    file_name: string;
    page_count: number;
    pages: Array<{
      page_number: number;
      width: number;
      height: number;
      extracted_text: string;
      char_count: number;
    }>;
  };
}> {
  const pages = await renderPdfToPngPages(params.pdfBuffer);
  const extractedPages: Array<{
    page_number: number;
    width: number;
    height: number;
    extracted_text: string;
    char_count: number;
  }> = [];

  for (const page of pages) {
    const extractedText = await extractSinglePageTextWithVision({
      page,
      requestId: params.requestId,
    });
    extractedPages.push({
      page_number: page.pageNumber,
      width: page.width,
      height: page.height,
      extracted_text: extractedText,
      char_count: extractedText.length,
    });
  }

  const text = extractedPages
    .map((page) => `=== Page ${page.page_number} ===\n${page.extracted_text}`)
    .join("\n\n")
    .trim();

  if (!text) {
    throw new Error("Vision extraction returned empty text.");
  }

  return {
    text,
    extractionDocument: {
      version: "final_report_extraction_v1",
      source: "openai_vision_page_by_page",
      model: env.OPENAI_CARRIER_AUDIT_MODEL,
      file_name: params.fileName,
      page_count: extractedPages.length,
      pages: extractedPages,
    },
  };
}

async function persistDocumentRecord(params: {
  source: SourceKind;
  requestId: string;
  uploaderUserId?: string;
  senderEmail?: string;
  fileName?: string;
  contentType?: string;
  storagePath?: string;
  extractedText: string;
  extractionMethod: "openai_vision_pages" | "plain_text";
  extractionMeta?: Record<string, unknown>;
}): Promise<string | undefined> {
  try {
    const { db, documents } = await import("@workspace/db");
    const [saved] = await db.insert(documents).values({
      claimId: null,
      type: params.source === "sendgrid_inbound" ? "standalone_inbound_report" : "standalone_final_report",
      fileUrl: params.storagePath ?? null,
      extractedText: params.extractedText,
      metadata: {
        source: params.source,
        requestId: params.requestId,
        uploaderUserId: params.uploaderUserId ?? null,
        senderEmail: params.senderEmail ?? null,
        fileName: params.fileName ?? null,
        contentType: params.contentType ?? null,
        storagePath: params.storagePath ?? null,
        extractionMethod: params.extractionMethod,
        extractionMeta: params.extractionMeta ?? {},
      },
    }).returning({ id: documents.id });

    return saved?.id;
  } catch (err) {
    logger.error({ err, requestId: params.requestId }, "Failed to persist standalone extraction record");
    return undefined;
  }
}

export async function extractAndPersistFinalReport(input: PersistedReportInput): Promise<PersistedReportResult> {
  const reportTextBody = typeof input.reportText === "string" ? input.reportText.trim() : "";
  const file = input.file;

  if (!file && !reportTextBody) {
    return {
      reportText: "",
      extractionMethod: "plain_text",
    };
  }

  if (!file) {
    const documentId = await persistDocumentRecord({
      source: input.source,
      requestId: input.requestId,
      uploaderUserId: input.uploaderUserId,
      senderEmail: input.senderEmail,
      extractedText: reportTextBody,
      extractionMethod: "plain_text",
    });

    return {
      reportText: reportTextBody,
      extractionMethod: "plain_text",
      documentId,
    };
  }

  const fileName = safeFileName(file.originalname || "final_report.pdf");
  const contentType = file.mimetype || "application/pdf";
  const storagePath = await uploadFile(file.buffer, fileName, contentType);

  const isPdf = contentType.toLowerCase() === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    const text = file.buffer.toString("utf-8").trim();
    const documentId = await persistDocumentRecord({
      source: input.source,
      requestId: input.requestId,
      uploaderUserId: input.uploaderUserId,
      senderEmail: input.senderEmail,
      fileName,
      contentType,
      storagePath,
      extractedText: text,
      extractionMethod: "plain_text",
    });

    return {
      reportText: text,
      storagePath,
      extractionMethod: "plain_text",
      documentId,
    };
  }

  const vision = await extractPdfTextWithVisionPages({
    pdfBuffer: file.buffer,
    fileName,
    requestId: input.requestId,
  });

  const documentId = await persistDocumentRecord({
    source: input.source,
    requestId: input.requestId,
    uploaderUserId: input.uploaderUserId,
    senderEmail: input.senderEmail,
    fileName,
    contentType,
    storagePath,
    extractedText: vision.text,
    extractionMethod: "openai_vision_pages",
    extractionMeta: {
      model: env.OPENAI_CARRIER_AUDIT_MODEL,
      extractionDocument: vision.extractionDocument,
    },
  });

  logger.info({
    requestId: input.requestId,
    model: env.OPENAI_CARRIER_AUDIT_MODEL,
    extraction_method: "openai_vision_pages",
    storagePath,
    extracted_chars: vision.text.length,
    page_count: vision.extractionDocument.page_count,
  }, "Final report extracted with OpenAI vision and persisted");

  return {
    reportText: vision.text,
    storagePath,
    extractionMethod: "openai_vision_pages",
    documentId,
  };
}
