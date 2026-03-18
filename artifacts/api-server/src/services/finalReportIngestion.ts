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
  logger.info({ total_pages: pdf.numPages }, "PDF loaded for page rendering");

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

    await (page as any).render({
      canvasContext: context,
      viewport,
      canvas,
    }).promise;

    pages.push({
      pageNumber,
      width,
      height,
      pngBuffer: canvas.toBuffer("image/png"),
    });

    if (pageNumber === 1 || pageNumber === pdf.numPages || pageNumber % 10 === 0) {
      logger.info({ page_number: pageNumber, total_pages: pdf.numPages }, "PDF page rendered to PNG");
    }

    page.cleanup();
  }

  await loadingTask.destroy();
  return pages;
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are an extraction assistant.",
  "Return JSON only in this exact shape:",
  '{"page_number":1,"text":"<full extracted page text>"}',
  "Extract all visible text from the page in reading order.",
  "Do not summarize.",
  "Do not omit tables, headers, footers, or labels.",
].join(" ");

const CONTENT_FILTER_RETRY_PROMPT = [
  "You are a professional document extraction assistant for licensed insurance adjusters.",
  "This page is from a property insurance claim inspection report.",
  "It may contain photographs of property damage (water damage, structural damage, mold, fire damage, etc.) with annotations, labels, dates, and descriptions.",
  "Return JSON only in this exact shape:",
  '{"page_number":1,"text":"<full extracted page text>"}',
  "Extract ALL visible text from the page in reading order including headers, photo labels, photo descriptions, dates, adjuster names, claim numbers, and any annotations or red-box callouts.",
  "Do not summarize. Do not omit any text.",
].join(" ");

function isContentFilterError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as any;
  return (e.status === 400 && e.code === "content_filter") ||
    (e.error?.code === "content_filter") ||
    (e.error?.inner_error?.code === "ResponsibleAIPolicyViolation") ||
    (e.message?.includes("content management policy"));
}

async function extractSinglePageTextWithVision(params: {
  page: RenderedPage;
  requestId: string;
  systemPrompt?: string;
}): Promise<string> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const imageDataUrl = `data:image/png;base64,${params.page.pngBuffer.toString("base64")}`;

  logger.info({
    requestId: params.requestId,
    page_number: params.page.pageNumber,
    page_width: params.page.width,
    page_height: params.page.height,
  }, "Starting OpenAI Vision extraction for page");

  const response = await openai.chat.completions.create({
    model: env.OPENAI_CARRIER_AUDIT_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: params.systemPrompt || DEFAULT_SYSTEM_PROMPT,
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
  logger.info({
    requestId: params.requestId,
    file_name: params.fileName,
    pdf_bytes: params.pdfBuffer.length,
    model: env.OPENAI_CARRIER_AUDIT_MODEL,
  }, "Starting page-by-page PDF vision extraction");

  const pages = await renderPdfToPngPages(params.pdfBuffer);
  logger.info({
    requestId: params.requestId,
    file_name: params.fileName,
    page_count: pages.length,
  }, "PNG page conversion complete");
  const extractedPages: Array<{
    page_number: number;
    width: number;
    height: number;
    extracted_text: string;
    char_count: number;
  }> = [];
  const filteredPages: Array<{ page_number: number; reason: string }> = [];
  const failedPages: Array<{ page_number: number; reason: string }> = [];

  for (const page of pages) {
    try {
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
    } catch (err) {
      if (isContentFilterError(err)) {
        logger.warn({
          requestId: params.requestId,
          page_number: page.pageNumber,
          total_pages: pages.length,
        }, "Content filter triggered, retrying with insurance-specific prompt");

        try {
          const extractedText = await extractSinglePageTextWithVision({
            page,
            requestId: params.requestId,
            systemPrompt: CONTENT_FILTER_RETRY_PROMPT,
          });
          extractedPages.push({
            page_number: page.pageNumber,
            width: page.width,
            height: page.height,
            extracted_text: extractedText,
            char_count: extractedText.length,
          });
          logger.info({
            requestId: params.requestId,
            page_number: page.pageNumber,
          }, "Content filter retry succeeded");
        } catch (retryErr) {
          const reason = isContentFilterError(retryErr)
            ? "Azure content filter blocked this page (property damage photo)"
            : (retryErr instanceof Error ? retryErr.message : "Unknown retry error");
          logger.warn({
            requestId: params.requestId,
            page_number: page.pageNumber,
            reason,
          }, "Page extraction failed after retry, continuing with remaining pages");
          filteredPages.push({ page_number: page.pageNumber, reason });
          extractedPages.push({
            page_number: page.pageNumber,
            width: page.width,
            height: page.height,
            extracted_text: `[Page ${page.pageNumber}: content filter — text could not be extracted]`,
            char_count: 0,
          });
        }
      } else {
        const reason = err instanceof Error ? err.message : "Unknown error";
        logger.warn({
          requestId: params.requestId,
          page_number: page.pageNumber,
          error: reason,
        }, "Page extraction failed, continuing with remaining pages");
        failedPages.push({ page_number: page.pageNumber, reason });
        extractedPages.push({
          page_number: page.pageNumber,
          width: page.width,
          height: page.height,
          extracted_text: `[Page ${page.pageNumber}: extraction error — ${reason}]`,
          char_count: 0,
        });
      }
    }

    if (page.pageNumber === 1 || page.pageNumber === pages.length || page.pageNumber % 10 === 0) {
      logger.info({
        requestId: params.requestId,
        page_number: page.pageNumber,
        total_pages: pages.length,
        extracted_chars: extractedPages[extractedPages.length - 1]?.char_count ?? 0,
      }, "Vision extraction completed for page");
    }
  }

  if (filteredPages.length > 0 || failedPages.length > 0) {
    logger.warn({
      requestId: params.requestId,
      filteredPages,
      failedPages,
      totalPages: pages.length,
      successfulPages: pages.length - filteredPages.length - failedPages.length,
    }, "Some pages could not be extracted");
  }

  const successfulText = extractedPages
    .filter((p) => p.char_count > 0)
    .map((page) => `=== Page ${page.page_number} ===\n${page.extracted_text}`)
    .join("\n\n")
    .trim();

  if (!successfulText) {
    throw new Error(`Vision extraction returned no usable text. ${filteredPages.length} pages blocked by content filter, ${failedPages.length} pages failed.`);
  }

  const text = extractedPages
    .map((page) => `=== Page ${page.page_number} ===\n${page.extracted_text}`)
    .join("\n\n")
    .trim();

  return {
    text,
    extractionDocument: {
      version: "final_report_extraction_v1",
      source: "openai_vision_page_by_page",
      model: env.OPENAI_CARRIER_AUDIT_MODEL,
      file_name: params.fileName,
      page_count: extractedPages.length,
      pages: extractedPages,
      filteredPages,
      failedPages,
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

    logger.info({
      requestId: params.requestId,
      documentId: saved?.id,
      source: params.source,
      extraction_method: params.extractionMethod,
      has_storage_path: Boolean(params.storagePath),
      extracted_chars: params.extractedText.length,
    }, "Standalone extraction record persisted");

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
    logger.info({
      requestId: input.requestId,
      source: input.source,
      extraction_method: "plain_text",
      text_chars: reportTextBody.length,
    }, "Using pasted/plain text input");

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
  logger.info({
    requestId: input.requestId,
    source: input.source,
    file_name: fileName,
    content_type: contentType,
    file_bytes: file.buffer.length,
  }, "Received uploaded file for standalone processing");

  const storagePath = await uploadFile(file.buffer, fileName, contentType);
  logger.info({
    requestId: input.requestId,
    source: input.source,
    file_name: fileName,
    storagePath,
  }, "Uploaded source file to Supabase storage");

  const isPdf = contentType.toLowerCase() === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    logger.info({
      requestId: input.requestId,
      source: input.source,
      file_name: fileName,
      extraction_method: "plain_text",
    }, "Non-PDF upload detected; using UTF-8 text extraction");

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
