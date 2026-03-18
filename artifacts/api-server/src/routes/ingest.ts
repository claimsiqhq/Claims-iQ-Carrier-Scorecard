import { Router, type IRouter } from "express";
import { createRequire } from "module";
import { db } from "@workspace/db";
import { claims, documents } from "@workspace/db";
import { uploadFile, downloadFile } from "../lib/supabaseStorage";
import { parseClaimFromText } from "../services/ingest";
import multer from "multer";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post("/ingest", upload.single("file"), async (req, res) => {
  try {
    let fileBuffer: Buffer;
    let fileName: string;
    let contentType: string;

    if (req.file) {
      fileBuffer = req.file.buffer;
      fileName = req.file.originalname;
      contentType = req.file.mimetype;
    } else if (req.body.storagePath && req.body.fileName) {
      const { storagePath, fileName: fn, contentType: ct } = req.body;
      fileBuffer = await downloadFile(storagePath);
      fileName = fn;
      contentType = ct || "application/pdf";
    } else {
      res.status(400).json({ error: "Provide a file upload or storagePath + fileName" });
      return;
    }

    const isPdf = contentType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      res.status(400).json({ error: "Only PDF files are supported for ingest." });
      return;
    }

    let extractedText = "";
    try {
      const pdfData = await pdfParse(fileBuffer);
      extractedText = pdfData.text;
    } catch (pdfErr) {
      console.error("PDF extraction failed during ingest:", pdfErr);
      res.status(422).json({ error: "Failed to extract text from PDF. Please ensure the file is a valid PDF." });
      return;
    }

    if (!extractedText || extractedText.trim().length < 50) {
      res.status(422).json({ error: "Could not extract meaningful text from the PDF. The file may be image-only or corrupted." });
      return;
    }

    console.log(`Ingest: extracted ${extractedText.length} chars, sending to OpenAI for parsing...`);

    const storagePath = await uploadFile(fileBuffer, fileName, contentType);

    const parsedData = await parseClaimFromText(extractedText);

    const claimNumber = parsedData.claimNumber || `CLAIM-${Date.now()}`;
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

    console.log(`Ingest complete: claim ${newClaim.id} created with document ${doc.id}`);

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
    console.error("Ingest error:", err);
    res.status(500).json({ error: "Failed to process claim file. Please try again." });
  }
});

export default router;
