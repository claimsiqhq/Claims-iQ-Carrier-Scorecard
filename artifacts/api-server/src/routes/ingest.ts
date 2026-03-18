import { Router, type IRouter } from "express";
import { createRequire } from "module";
import { db } from "@workspace/db";
import { claims, documents } from "@workspace/db";
import { uploadFile } from "../lib/supabaseStorage";
import { parseClaimFromText } from "../services/ingest";
import { requireAuth } from "../middlewares/requireAuth";
import logger from "../lib/logger";
import multer from "multer";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

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

    let extractedText = "";
    if (contentType === "application/pdf") {
      try {
        const pdfData = await pdfParse(fileBuffer);
        extractedText = pdfData.text;
      } catch (pdfErr) {
        logger.error({ err: pdfErr }, "PDF parsing failed");
        res.status(422).json({ error: "Could not extract text from the PDF. The file may be image-only or corrupted." });
        return;
      }
    } else {
      extractedText = fileBuffer.toString("utf-8");
    }

    if (!extractedText || extractedText.trim().length < 50) {
      res.status(422).json({ error: "Could not extract meaningful text from the PDF. The file may be image-only or corrupted." });
      return;
    }

    logger.info({ extractedChars: extractedText.length }, "Ingest: extracted text, sending to OpenAI");

    const storagePath = await uploadFile(fileBuffer, fileName, contentType);

    const parsedData = await parseClaimFromText(extractedText);

    const claimNumber = parsedData.claimNumber || `CLM-${Date.now()}`;
    const insuredName = parsedData.insuredName || "Unknown Insured";

    const [newClaim] = await db.insert(claims).values({
      claimNumber,
      insuredName,
      carrier: parsedData.carrier || null,
      dateOfLoss: parsedData.dateOfLoss || null,
      status: "pending",
      policyNumber: parsedData.policyNumber || null,
      lossType: parsedData.lossType || null,
      propertyAddress: parsedData.propertyAddress || null,
      adjuster: parsedData.adjusterName || null,
      totalClaimAmount: parsedData.totalClaimAmount || null,
      deductible: parsedData.deductible || null,
      summary: parsedData.summary || null,
    }).returning();

    const [doc] = await db.insert(documents).values({
      claimId: newClaim.id,
      type: "claim_file",
      fileUrl: storagePath,
      extractedText,
      metadata: {
        fileName,
        contentType,
        storagePath,
        parsedData,
      },
    }).returning();

    logger.info({ claimId: newClaim.id, documentId: doc.id }, "Ingest complete");

    res.status(201).json({
      claim: {
        id: newClaim.id,
        claimNumber: newClaim.claimNumber ?? "",
        insuredName: newClaim.insuredName ?? "",
        carrier: newClaim.carrier ?? "",
        dateOfLoss: newClaim.dateOfLoss ?? "",
        status: newClaim.status ?? "pending",
      },
      document: {
        id: doc.id,
        fileName,
        extractedLength: extractedText.length,
        storagePath,
      },
      parsedData,
    });
  } catch (err) {
    logger.error({ err }, "Ingest error");
    res.status(500).json({ error: "Failed to process claim file. Please try again." });
  }
});

export default router;
