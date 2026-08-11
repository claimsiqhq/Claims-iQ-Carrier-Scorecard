import path from "node:path";
import {
  TenantStorageCapability,
} from "../lib/supabaseStorage";
import {
  documents,
  type ScopedDatabaseLease,
} from "@workspace/db";
import logger from "../lib/logger";
import { env } from "../env";
import { z } from "zod";

type SourceKind = "standalone_ui" | "sendgrid_inbound";

const extractionQueue: Array<{
  resolve: () => void;
}> = [];
let extractionRunning = false;

function acquireExtractionSlot(): Promise<void> {
  if (!extractionRunning) {
    extractionRunning = true;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    extractionQueue.push({ resolve });
  });
}

function releaseExtractionSlot(): void {
  const next = extractionQueue.shift();
  if (next) {
    next.resolve();
  } else {
    extractionRunning = false;
  }
}

export interface PersistedReportInput {
  source: SourceKind;
  requestId: string;
  senderEmail?: string;
  file?: Express.Multer.File;
  reportText?: string;
}

export interface PersistedReportResult {
  reportText: string;
  documentId?: string;
  storagePath?: string;
  extractionMethod: "gemini_vision_pages" | "plain_text";
}

interface PersistedExtraction {
  source: SourceKind;
  requestId: string;
  senderEmail?: string;
  fileName?: string;
  contentType?: string;
  storagePath?: string;
  extractedText: string;
  extractionMethod: "gemini_vision_pages" | "plain_text";
  extractionMeta?: Record<string, unknown>;
}

export interface FinalReportIngestionCapability {
  storeSource(input: {
    fileName: string;
    contentType: string;
    body: Buffer;
  }): Promise<string>;
  persistReport(input: PersistedExtraction): Promise<string>;
}

export function createFinalReportIngestionCapability(input: {
  databaseLease: ScopedDatabaseLease;
  storage: TenantStorageCapability;
  claimId: string;
  documentId: string;
  uploaderUserId: string;
}): FinalReportIngestionCapability {
  if (
    input.databaseLease.isReleased
    || input.databaseLease.settings.organizationId
      !== input.storage.organizationId
    || !(input.storage instanceof TenantStorageCapability)
  ) {
    throw new Error(
      "Final report ingestion requires matching live database and storage scopes",
    );
  }
  const settings = input.databaseLease.settings;
  const matchingTenantSession = Boolean(
    settings.userId
    && settings.sessionId
    && settings.userId === input.uploaderUserId
    && settings.userId === input.storage.userId
    && settings.sessionId === input.storage.sessionId,
  );
  const leasedWorkerJob = Boolean(settings.jobId && settings.workerId);
  if (!matchingTenantSession && !leasedWorkerJob) {
    throw new Error(
      "Final report ingestion requires a tenant session or leased worker job",
    );
  }
  const database = input.databaseLease.database;
  const referenceFor = (storagePath: string) => ({
    claimId: input.claimId,
    documentId: input.documentId,
    storagePath,
  });

  return Object.freeze({
    async storeSource(source: {
      fileName: string;
      contentType: string;
      body: Buffer;
    }) {
      return input.storage.uploadDocument({
        claimId: input.claimId,
        documentId: input.documentId,
        fileName: source.fileName,
        contentType: source.contentType,
        body: source.body,
      });
    },
    async persistReport(report: PersistedExtraction) {
      if (
        report.storagePath
        && !input.storage.ownsReference(referenceFor(report.storagePath))
      ) {
        throw new Error(
          "Persisted report storage path is outside the scoped document tuple",
        );
      }
      const metadata = {
        organizationId: input.storage.organizationId,
        claimId: input.claimId,
        documentId: input.documentId,
        source: report.source,
        requestId: report.requestId,
        uploaderUserId: input.uploaderUserId,
        senderEmail: report.senderEmail ?? null,
        fileName: report.fileName ?? null,
        contentType: report.contentType ?? null,
        storagePath: report.storagePath ?? null,
        extractionMethod: report.extractionMethod,
        extractionMeta: report.extractionMeta ?? {},
      };
      const [saved] = await database
        .insert(documents)
        .values({
          id: input.documentId,
          organizationId: input.storage.organizationId,
          claimId: input.claimId,
          uploadedByUserId: input.uploaderUserId,
          type:
            report.source === "sendgrid_inbound"
              ? "inbound_report"
              : "final_report",
          fileUrl: report.storagePath ?? null,
          extractedText: report.extractedText,
          metadata,
        })
        .returning({ id: documents.id });
      if (!saved?.id) {
        throw new Error("Scoped final report persistence returned no document");
      }
      return saved.id;
    },
  });
}

function safeFileName(originalName: string): string {
  const base = path.basename(originalName || "report.pdf");
  return base.replace(/[^\w.\-]/g, "_");
}

const pageExtractionSchema = z
  .object({
    page_number: z.number().int().positive(),
    text: z.string(),
  })
  .strict();

const TARGET_RENDER_WIDTH = 1400;

type RenderedPage = {
  pageNumber: number;
  width: number;
  height: number;
  pngBuffer: Buffer;
};

async function renderSinglePdfPage(
  pdf: any,
  pageNumber: number,
  createCanvas: any,
): Promise<RenderedPage> {
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

  return { pageNumber, width, height, pngBuffer };
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
  const code = String(e.code ?? e.error?.code ?? e.error?.status ?? "");
  const message = String(e.message ?? e.error?.message ?? "");
  return (
    (e.status === 400 && e.code === "content_filter") ||
    e.error?.code === "content_filter" ||
    e.error?.inner_error?.code === "ResponsibleAIPolicyViolation" ||
    /SAFETY|PROHIBITED_CONTENT/i.test(code) ||
    /content management policy|blocked for safety|prohibited content/i.test(
      message,
    )
  );
}

async function extractSinglePageTextWithVision(params: {
  page: RenderedPage;
  requestId: string;
  systemPrompt?: string;
}): Promise<string> {
  const { gemini } =
    await import("@workspace/integrations-openai-ai-server/client");
  const imageDataUrl = `data:image/png;base64,${params.page.pngBuffer.toString("base64")}`;

  logger.info(
    {
      requestId: params.requestId,
      page_number: params.page.pageNumber,
      page_width: params.page.width,
      page_height: params.page.height,
    },
    "Starting Gemini Vision extraction for page",
  );

  const response = await gemini.chat.completions.create(
    {
      model: env.GEMINI_MODEL,
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
    },
    { signal: AbortSignal.timeout(120_000) },
  );

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error(
      `Page ${params.page.pageNumber} extraction returned empty content.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      `Page ${params.page.pageNumber} extraction returned invalid JSON.`,
    );
  }

  const validated = pageExtractionSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Page ${params.page.pageNumber} extraction failed schema validation.`,
    );
  }

  logger.info(
    {
      requestId: params.requestId,
      page_number: params.page.pageNumber,
      provider_request_id: response.id,
      model: env.GEMINI_MODEL,
    },
    "Vision page extraction completed",
  );

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
    source: "gemini_vision_page_by_page";
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
    filteredPages: Array<{ page_number: number; reason: string }>;
    failedPages: Array<{ page_number: number; reason: string }>;
  };
}> {
  logger.info(
    {
      requestId: params.requestId,
      fileName: params.fileName,
      queueDepth: extractionQueue.length,
    },
    "Waiting for extraction slot",
  );
  await acquireExtractionSlot();
  logger.info(
    { requestId: params.requestId, fileName: params.fileName },
    "Extraction slot acquired",
  );
  try {
    return await _extractPdfTextWithVisionPagesInner(params);
  } finally {
    releaseExtractionSlot();
  }
}

async function _extractPdfTextWithVisionPagesInner(params: {
  pdfBuffer: Buffer;
  fileName: string;
  requestId: string;
}): Promise<{
  text: string;
  extractionDocument: {
    version: "final_report_extraction_v1";
    source: "gemini_vision_page_by_page";
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
    filteredPages: Array<{ page_number: number; reason: string }>;
    failedPages: Array<{ page_number: number; reason: string }>;
  };
}> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");

  logger.info(
    {
      requestId: params.requestId,
      file_name: params.fileName,
      pdf_bytes: params.pdfBuffer.length,
      model: env.GEMINI_MODEL,
    },
    "Starting page-by-page PDF vision extraction",
  );

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(params.pdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  logger.info({ total_pages: totalPages }, "PDF loaded for page rendering");

  if (totalPages > env.GEMINI_VISION_MAX_PDF_PAGES) {
    await loadingTask.destroy();
    throw new Error(
      `PDF has ${totalPages} pages; configured limit is ${env.GEMINI_VISION_MAX_PDF_PAGES}.`,
    );
  }

  const extractedPages: Array<{
    page_number: number;
    width: number;
    height: number;
    extracted_text: string;
    char_count: number;
  }> = [];
  const filteredPages: Array<{ page_number: number; reason: string }> = [];
  const failedPages: Array<{ page_number: number; reason: string }> = [];

  const CONCURRENCY = 5;

  async function processOnePage(pageNumber: number) {
    let page: RenderedPage;
    try {
      page = await renderSinglePdfPage(pdf, pageNumber, createCanvas);
    } catch (renderErr) {
      const reason =
        renderErr instanceof Error ? renderErr.message : "Render failed";
      logger.warn(
        { requestId: params.requestId, page_number: pageNumber, error: reason },
        "Page render failed, skipping",
      );
      failedPages.push({ page_number: pageNumber, reason });
      return {
        page_number: pageNumber,
        width: 0,
        height: 0,
        extracted_text: `[Page ${pageNumber}: render error]`,
        char_count: 0,
      };
    }

    if (
      pageNumber === 1 ||
      pageNumber === totalPages ||
      pageNumber % 10 === 0
    ) {
      logger.info(
        { page_number: pageNumber, total_pages: totalPages },
        "PDF page rendered to PNG",
      );
    }

    try {
      const extractedText = await extractSinglePageTextWithVision({
        page,
        requestId: params.requestId,
      });
      if (
        pageNumber === 1 ||
        pageNumber === totalPages ||
        pageNumber % 10 === 0
      ) {
        logger.info(
          {
            requestId: params.requestId,
            page_number: pageNumber,
            total_pages: totalPages,
            extracted_chars: extractedText.length,
          },
          "Vision extraction completed for page",
        );
      }
      return {
        page_number: page.pageNumber,
        width: page.width,
        height: page.height,
        extracted_text: extractedText,
        char_count: extractedText.length,
      };
    } catch (err) {
      if (isContentFilterError(err)) {
        logger.warn(
          {
            requestId: params.requestId,
            page_number: page.pageNumber,
            total_pages: totalPages,
          },
          "Content filter triggered, retrying with insurance-specific prompt",
        );
        try {
          const extractedText = await extractSinglePageTextWithVision({
            page,
            requestId: params.requestId,
            systemPrompt: CONTENT_FILTER_RETRY_PROMPT,
          });
          logger.info(
            { requestId: params.requestId, page_number: page.pageNumber },
            "Content filter retry succeeded",
          );
          return {
            page_number: page.pageNumber,
            width: page.width,
            height: page.height,
            extracted_text: extractedText,
            char_count: extractedText.length,
          };
        } catch (retryErr) {
          const reason = isContentFilterError(retryErr)
            ? "Gemini safety filtering blocked this page (property damage photo)"
            : retryErr instanceof Error
              ? retryErr.message
              : "Unknown retry error";
          logger.warn(
            {
              requestId: params.requestId,
              page_number: page.pageNumber,
              reason,
            },
            "Page extraction failed after retry, continuing with remaining pages",
          );
          filteredPages.push({ page_number: page.pageNumber, reason });
          return {
            page_number: page.pageNumber,
            width: page.width,
            height: page.height,
            extracted_text: `[Page ${page.pageNumber}: content filter — text could not be extracted]`,
            char_count: 0,
          };
        }
      } else {
        const reason = err instanceof Error ? err.message : "Unknown error";
        logger.warn(
          {
            requestId: params.requestId,
            page_number: page.pageNumber,
            error: reason,
          },
          "Page extraction failed, continuing with remaining pages",
        );
        failedPages.push({ page_number: page.pageNumber, reason });
        return {
          page_number: page.pageNumber,
          width: page.width,
          height: page.height,
          extracted_text: `[Page ${page.pageNumber}: extraction error — ${reason}]`,
          char_count: 0,
        };
      }
    }
  }

  for (
    let batchStart = 1;
    batchStart <= totalPages;
    batchStart += CONCURRENCY
  ) {
    const batchEnd = Math.min(batchStart + CONCURRENCY - 1, totalPages);
    const batchPages = Array.from(
      { length: batchEnd - batchStart + 1 },
      (_, i) => batchStart + i,
    );
    const results = await Promise.all(batchPages.map(processOnePage));
    extractedPages.push(...results);
  }

  await loadingTask.destroy();

  if (filteredPages.length > 0 || failedPages.length > 0) {
    logger.warn(
      {
        requestId: params.requestId,
        filteredPages,
        failedPages,
        totalPages,
        successfulPages: totalPages - filteredPages.length - failedPages.length,
      },
      "Some pages could not be extracted",
    );
  }

  const successfulText = extractedPages
    .filter((p) => p.char_count > 0)
    .map((page) => `=== Page ${page.page_number} ===\n${page.extracted_text}`)
    .join("\n\n")
    .trim();

  if (!successfulText) {
    throw new Error(
      `Vision extraction returned no usable text. ${filteredPages.length} pages blocked by content filter, ${failedPages.length} pages failed.`,
    );
  }

  const text = extractedPages
    .map((page) => `=== Page ${page.page_number} ===\n${page.extracted_text}`)
    .join("\n\n")
    .trim();

  return {
    text,
    extractionDocument: {
      version: "final_report_extraction_v1",
      source: "gemini_vision_page_by_page",
      model: env.GEMINI_MODEL,
      file_name: params.fileName,
      page_count: extractedPages.length,
      pages: extractedPages,
      filteredPages,
      failedPages,
    },
  };
}

async function persistDocumentRecord(
  capability: FinalReportIngestionCapability,
  params: PersistedExtraction,
): Promise<string> {
  const documentId = await capability.persistReport(params);
  logger.info(
    {
      requestId: params.requestId,
      documentId,
      source: params.source,
      extraction_method: params.extractionMethod,
      has_storage_path: Boolean(params.storagePath),
      extracted_chars: params.extractedText.length,
    },
    "Scoped extraction record persisted",
  );
  return documentId;
}

export async function extractAndPersistFinalReport(
  capability: FinalReportIngestionCapability,
  input: PersistedReportInput,
): Promise<PersistedReportResult> {
  const reportTextBody =
    typeof input.reportText === "string" ? input.reportText.trim() : "";
  const file = input.file;

  if (!file && !reportTextBody) {
    return {
      reportText: "",
      extractionMethod: "plain_text",
    };
  }

  if (!file) {
    logger.info(
      {
        requestId: input.requestId,
        source: input.source,
        extraction_method: "plain_text",
        text_chars: reportTextBody.length,
      },
      "Using pasted/plain text input",
    );

    const documentId = await persistDocumentRecord(capability, {
      source: input.source,
      requestId: input.requestId,
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
  logger.info(
    {
      requestId: input.requestId,
      source: input.source,
      file_name: fileName,
      content_type: contentType,
      file_bytes: file.buffer.length,
    },
    "Received uploaded file for standalone processing",
  );

  const storagePath = await capability.storeSource({
    body: file.buffer,
    fileName,
    contentType,
  });
  logger.info(
    {
      requestId: input.requestId,
      source: input.source,
      file_name: fileName,
      storagePath,
    },
    "Uploaded source file to Supabase storage",
  );

  const isPdf =
    contentType.toLowerCase() === "application/pdf" ||
    fileName.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    logger.info(
      {
        requestId: input.requestId,
        source: input.source,
        file_name: fileName,
        extraction_method: "plain_text",
      },
      "Non-PDF upload detected; using UTF-8 text extraction",
    );

    const text = file.buffer.toString("utf-8").trim();
    const documentId = await persistDocumentRecord(capability, {
      source: input.source,
      requestId: input.requestId,
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

  const documentId = await persistDocumentRecord(capability, {
    source: input.source,
    requestId: input.requestId,
    senderEmail: input.senderEmail,
    fileName,
    contentType,
    storagePath,
    extractedText: vision.text,
    extractionMethod: "gemini_vision_pages",
    extractionMeta: {
      model: env.GEMINI_MODEL,
      extractionDocument: vision.extractionDocument,
    },
  });

  logger.info(
    {
      requestId: input.requestId,
      model: env.GEMINI_MODEL,
      extraction_method: "gemini_vision_pages",
      storagePath,
      extracted_chars: vision.text.length,
      page_count: vision.extractionDocument.page_count,
    },
    "Final report extracted with Gemini vision and persisted",
  );

  return {
    reportText: vision.text,
    storagePath,
    extractionMethod: "gemini_vision_pages",
    documentId,
  };
}
