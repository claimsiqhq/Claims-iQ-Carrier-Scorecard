import path from "node:path";
import { uploadFile } from "../lib/supabaseStorage";
import logger from "../lib/logger";
import { env } from "../env";

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
  extractionMethod: "openai_vision_pdf" | "plain_text";
}

function safeFileName(originalName: string): string {
  const base = path.basename(originalName || "report.pdf");
  return base.replace(/[^\w.\-]/g, "_");
}

async function extractPdfTextWithVision(params: {
  pdfBuffer: Buffer;
  fileName: string;
  requestId: string;
}): Promise<{ text: string; openaiFileId?: string; openaiRequestId?: string }> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const { toFile } = await import("openai/uploads");

  const uploaded = await openai.files.create({
    purpose: "user_data",
    file: await toFile(params.pdfBuffer, params.fileName, { type: "application/pdf" }),
  });

  try {
    const response = await openai.responses.create({
      model: env.OPENAI_CARRIER_AUDIT_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_file", file_id: uploaded.id },
            {
              type: "input_text",
              text: [
                "Extract the complete report text from every page in reading order.",
                "Return plain text only.",
                "Do not summarize.",
                "Do not omit sections, tables, headers, or footers.",
                "Preserve page order and meaningful line breaks.",
              ].join(" "),
            },
          ],
        },
      ],
    });

    const directText = typeof response.output_text === "string" ? response.output_text.trim() : "";
    if (directText.length > 0) {
      return { text: directText, openaiFileId: uploaded.id, openaiRequestId: response.id };
    }

    let fallbackText = "";
    const output = (response as unknown as { output?: Array<{ content?: Array<{ text?: string }> }> }).output ?? [];
    for (const item of output) {
      const content = item.content ?? [];
      for (const chunk of content) {
        if (typeof chunk.text === "string" && chunk.text.trim().length > 0) {
          fallbackText += `${chunk.text}\n`;
        }
      }
    }

    const text = fallbackText.trim();
    if (!text) {
      throw new Error("Vision extraction returned empty text.");
    }

    return { text, openaiFileId: uploaded.id, openaiRequestId: response.id };
  } finally {
    try {
      await openai.files.del(uploaded.id);
    } catch (err) {
      logger.warn({ err, requestId: params.requestId, fileId: uploaded.id }, "Failed to delete uploaded OpenAI file");
    }
  }
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
  extractionMethod: "openai_vision_pdf" | "plain_text";
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

  const vision = await extractPdfTextWithVision({
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
    extractionMethod: "openai_vision_pdf",
    extractionMeta: {
      model: env.OPENAI_CARRIER_AUDIT_MODEL,
      openaiFileId: vision.openaiFileId,
      openaiRequestId: vision.openaiRequestId,
    },
  });

  logger.info({
    requestId: input.requestId,
    model: env.OPENAI_CARRIER_AUDIT_MODEL,
    extraction_method: "openai_vision_pdf",
    storagePath,
    extracted_chars: vision.text.length,
  }, "Final report extracted with OpenAI vision and persisted");

  return {
    reportText: vision.text,
    storagePath,
    extractionMethod: "openai_vision_pdf",
    documentId,
  };
}
