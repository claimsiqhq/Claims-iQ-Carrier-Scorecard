import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { claims, documents, audits } from "@workspace/db";
import { eq } from "drizzle-orm";
import { uploadFile, downloadFile, fileExists } from "../lib/supabaseStorage";
import { parseClaimFromText } from "../services/ingest";
import { extractPdfTextWithVisionPages } from "../services/finalReportIngestion";
import { requireAuth } from "../middlewares/requireAuth";
import logger from "../lib/logger";
import multer from "multer";

const MAX_PDF_SIZE = 100 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router: IRouter = Router();

router.post("/ingest", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded. Please attach a PDF." });
      return;
    }

    const fileBuffer = file.buffer;
    const fileName = file.originalname;
    const contentType = file.mimetype;

    if (fileBuffer.length > MAX_PDF_SIZE) {
      res.status(413).json({ error: `File too large. Maximum size is ${MAX_PDF_SIZE / 1024 / 1024}MB.` });
      return;
    }

    const storagePath = await uploadFile(fileBuffer, fileName, contentType);

    const carrierFromForm = typeof req.body?.carrier === "string" ? req.body.carrier.trim() : null;

    const [newClaim] = await db.insert(claims).values({
      claimNumber: `CLM-${Date.now()}`,
      insuredName: "Processing…",
      status: "processing",
      carrier: carrierFromForm || null,
    }).returning();

    const [doc] = await db.insert(documents).values({
      claimId: newClaim.id,
      type: "claim_file",
      fileUrl: storagePath,
      metadata: { fileName, contentType, storagePath },
    }).returning();

    logger.info({ claimId: newClaim.id, documentId: doc.id, fileName }, "Ingest accepted — starting background processing");

    res.status(202).json({
      claim: {
        id: newClaim.id,
        claimNumber: newClaim.claimNumber ?? "",
        insuredName: "",
        carrier: "",
        dateOfLoss: "",
        status: "processing",
      },
      document: { id: doc.id, fileName, storagePath },
    });

    processInBackground(newClaim.id, doc.id, fileBuffer, fileName, contentType, storagePath, carrierFromForm).catch((err) => {
      logger.error({ err, claimId: newClaim.id }, "Background processing crashed unexpectedly");
    });
  } catch (err) {
    logger.error({ err }, "Ingest error");
    res.status(500).json({ error: "Failed to process claim file. Please try again." });
  }
});

async function processInBackground(
  claimId: string,
  docId: string,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  storagePath: string,
  userSelectedCarrier?: string | null,
) {
  try {
    let extractedText = "";
    let extractionMeta: Record<string, unknown> | undefined;

    if (contentType === "application/pdf") {
      const requestId = randomUUID();
      const vision = await extractPdfTextWithVisionPages({
        pdfBuffer: fileBuffer,
        fileName,
        requestId,
      });
      extractedText = vision.text;
      extractionMeta = { extractionDocument: vision.extractionDocument };
    } else {
      extractedText = fileBuffer.toString("utf-8");
    }

    if (!extractedText || extractedText.trim().length < 50) {
      await db.update(claims).set({ status: "error", summary: "Could not extract meaningful text from the PDF. The file may be image-only or corrupted." }).where(eq(claims.id, claimId));
      logger.warn({ claimId }, "Background extraction produced insufficient text");
      return;
    }

    logger.info({ claimId, extractedChars: extractedText.length }, "Background extraction complete, parsing claim");

    const parsedData = await parseClaimFromText(extractedText);

    const claimNumber = parsedData.claimNumber || `CLM-${Date.now()}`;
    const insuredName = parsedData.insuredName || "Unknown Insured";

    await db.update(claims).set({
      claimNumber,
      insuredName,
      carrier: userSelectedCarrier || parsedData.carrier || null,
      dateOfLoss: parsedData.dateOfLoss || null,
      status: "pending",
      policyNumber: parsedData.policyNumber || null,
      lossType: parsedData.lossType || null,
      propertyAddress: parsedData.propertyAddress || null,
      adjuster: parsedData.adjusterName || null,
      totalClaimAmount: parsedData.totalClaimAmount || null,
      deductible: parsedData.deductible || null,
      summary: parsedData.summary || null,
    }).where(eq(claims.id, claimId));

    await db.update(documents).set({
      extractedText,
      metadata: {
        fileName,
        contentType,
        storagePath,
        parsedData,
        ...(extractionMeta ?? {}),
      },
    }).where(eq(documents.id, docId));

    logger.info({ claimId }, "Background processing complete — claim ready");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Processing failed";
    logger.error({ err, claimId }, "Background processing failed");
    try {
      await db.update(claims).set({ status: "error", summary: errorMessage }).where(eq(claims.id, claimId));
    } catch (dbErr) {
      logger.error({ err: dbErr, claimId }, "Failed to mark claim as error");
    }
  }
}

router.get("/claims/:id/processing-status", requireAuth, async (req, res) => {
  try {
    const [claim] = await db.select({
      id: claims.id,
      status: claims.status,
      claimNumber: claims.claimNumber,
      insuredName: claims.insuredName,
      carrier: claims.carrier,
      dateOfLoss: claims.dateOfLoss,
      summary: claims.summary,
    }).from(claims).where(eq(claims.id, req.params.id as string));

    if (!claim) {
      res.status(404).json({ error: "Claim not found" });
      return;
    }

    if (claim.status === "processing") {
      res.json({ status: "processing" });
    } else if (claim.status === "error") {
      res.json({ status: "error", error: claim.summary || "Processing failed" });
    } else {
      res.json({
        status: "ready",
        claimNumber: claim.claimNumber,
        insuredName: claim.insuredName,
        carrier: claim.carrier ?? "",
        dateOfLoss: claim.dateOfLoss ?? "",
      });
    }
  } catch (err) {
    logger.error({ err }, "Processing status check error");
    res.status(500).json({ error: "Failed to check processing status" });
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post("/claims/:id/retry", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid claim ID format" });
      return;
    }

    const [claim] = await db.select().from(claims).where(eq(claims.id, id));
    if (!claim) {
      res.status(404).json({ error: "Claim not found" });
      return;
    }

    if (claim.status !== "processing" && claim.status !== "error") {
      res.status(400).json({ error: "Only claims in processing or error status can be retried" });
      return;
    }

    const claimDocs = await db.select().from(documents).where(eq(documents.claimId, id));
    const doc = claimDocs.find((d) => d.type === "claim_file" && d.fileUrl);
    if (!doc || !doc.fileUrl) {
      res.status(400).json({ error: "No document file found for this claim" });
      return;
    }

    const storagePath = doc.fileUrl;
    const check = await fileExists(storagePath);
    if (!check.exists) {
      if (check.error) {
        logger.warn({ claimId: id, storagePath, storageError: check.error }, "Retry: storage check failed");
        res.status(500).json({ error: "Could not verify file in storage — please try again" });
      } else {
        res.status(400).json({ error: "Original file not found in storage — please re-upload the claim" });
      }
      return;
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await downloadFile(storagePath);
    } catch (dlErr) {
      logger.error({ err: dlErr, claimId: id }, "Retry: failed to download file from storage");
      res.status(500).json({ error: "Failed to download file from storage" });
      return;
    }

    await db.update(claims).set({
      status: "processing",
      summary: null,
      insuredName: "Processing…",
    }).where(eq(claims.id, id));

    const meta = doc.metadata as Record<string, unknown> | null;
    const fileName = (meta?.fileName as string) || "claim.pdf";
    const contentType = (meta?.contentType as string) || "application/pdf";

    logger.info({ claimId: id, storagePath, fileName }, "Retry: re-processing claim");

    res.status(202).json({ status: "processing", claimId: id });

    processInBackground(id, doc.id, fileBuffer, fileName, contentType, storagePath, claim.carrier).catch((err) => {
      logger.error({ err, claimId: id }, "Retry: background processing crashed unexpectedly");
    });
  } catch (err) {
    logger.error({ err }, "Retry endpoint error");
    res.status(500).json({ error: "Failed to retry claim processing" });
  }
});

router.post("/claims/:id/reprocess", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid claim ID format" });
      return;
    }

    const { carrier } = req.body as { carrier?: string };
    if (!carrier || typeof carrier !== "string" || carrier.trim().length === 0) {
      res.status(400).json({ error: "carrier is required" });
      return;
    }

    const [claim] = await db.select().from(claims).where(eq(claims.id, id));
    if (!claim) {
      res.status(404).json({ error: "Claim not found" });
      return;
    }

    if (claim.status === "processing") {
      res.status(409).json({ error: "Claim is already being processed" });
      return;
    }

    const claimDocs = await db.select().from(documents).where(eq(documents.claimId, id));
    const doc = claimDocs.find((d) => d.type === "claim_file" && d.fileUrl);
    if (!doc || !doc.fileUrl) {
      res.status(400).json({ error: "No document file found for this claim" });
      return;
    }

    const storagePath = doc.fileUrl;
    const check = await fileExists(storagePath);
    if (!check.exists) {
      if (check.error) {
        logger.warn({ claimId: id, storagePath, storageError: check.error }, "Reprocess: storage check failed");
        res.status(500).json({ error: "Could not verify file in storage — please try again" });
      } else {
        res.status(400).json({ error: "Original file not found in storage — please re-upload the claim" });
      }
      return;
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await downloadFile(storagePath);
    } catch (dlErr) {
      logger.error({ err: dlErr, claimId: id }, "Reprocess: failed to download file from storage");
      res.status(500).json({ error: "Failed to download file from storage" });
      return;
    }

    const trimmedCarrier = carrier.trim();

    await db.delete(audits).where(eq(audits.claimId, id));

    await db.update(claims).set({
      status: "processing",
      carrier: trimmedCarrier,
      summary: null,
      insuredName: "Processing…",
    }).where(eq(claims.id, id));

    const meta = doc.metadata as Record<string, unknown> | null;
    const fileName = (meta?.fileName as string) || "claim.pdf";
    const contentType = (meta?.contentType as string) || "application/pdf";

    logger.info({ claimId: id, carrier: trimmedCarrier, storagePath, fileName }, "Reprocess: re-processing with new carrier");

    res.status(202).json({ status: "processing", claimId: id, carrier: trimmedCarrier });

    processInBackground(id, doc.id, fileBuffer, fileName, contentType, storagePath, trimmedCarrier).catch((err) => {
      logger.error({ err, claimId: id }, "Reprocess: background processing crashed unexpectedly");
    });
  } catch (err) {
    logger.error({ err }, "Reprocess endpoint error");
    res.status(500).json({ error: "Failed to reprocess claim" });
  }
});

export default router;
