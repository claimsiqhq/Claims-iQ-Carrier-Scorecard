import { Router, type IRouter } from "express";
import { createRequire } from "module";
import { db } from "@workspace/db";
import { claims, documents } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { parseClaimFromText } from "../services/ingest";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

router.post("/ingest", async (req, res) => {
  try {
    const { objectPath, fileName, contentType } = req.body;
    if (!objectPath || !fileName) {
      res.status(400).json({ error: "objectPath and fileName are required" });
      return;
    }

    let extractedText = "";
    const isPdf = contentType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");

    if (isPdf && objectPath) {
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
        const downloadResponse = await objectStorageService.downloadObject(objectFile);

        if (downloadResponse.body) {
          const chunks: Uint8Array[] = [];
          const reader = (downloadResponse.body as ReadableStream<Uint8Array>).getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
          }
          const buffer = Buffer.concat(chunks);
          const pdfData = await pdfParse(buffer);
          extractedText = pdfData.text;
        }
      } catch (pdfErr) {
        console.error("PDF extraction failed during ingest:", pdfErr);
        res.status(422).json({ error: "Failed to extract text from PDF. Please ensure the file is a valid PDF." });
        return;
      }
    } else {
      res.status(400).json({ error: "Only PDF files are supported for ingest." });
      return;
    }

    if (!extractedText || extractedText.trim().length < 50) {
      res.status(422).json({ error: "Could not extract meaningful text from the PDF. The file may be image-only or corrupted." });
      return;
    }

    console.log(`Ingest: extracted ${extractedText.length} chars from ${fileName}, sending to OpenAI for parsing...`);

    const parsedData = await parseClaimFromText(extractedText);

    const claimNumber = parsedData.claimNumber || `CLAIM-${Date.now()}`;
    const insuredName = parsedData.insuredName || "Unknown Insured";

    const [newClaim] = await db.insert(claims).values({
      claimNumber,
      insuredName,
      carrier: parsedData.carrier || null,
      dateOfLoss: parsedData.dateOfLoss || null,
      status: "pending",
    }).returning();

    const [doc] = await db.insert(documents).values({
      claimId: newClaim.id,
      type: "claim_file",
      fileUrl: objectPath,
      extractedText,
      metadata: {
        fileName,
        contentType: contentType || "application/pdf",
        objectPath,
        parsedData,
      },
    }).returning();

    console.log(`Ingest complete: claim ${newClaim.id} (${claimNumber}) created with document ${doc.id}`);

    res.status(201).json({
      claim: {
        id: newClaim.id,
        claimNumber: newClaim.claimNumber ?? "",
        insuredName: newClaim.insuredName ?? "",
        carrier: newClaim.carrier ?? "",
        dateOfLoss: newClaim.dateOfLoss ?? "",
        status: newClaim.status ?? "pending",
        createdAt: newClaim.createdAt?.toISOString() ?? "",
      },
      document: {
        id: doc.id,
        fileName,
        extractedLength: extractedText.length,
      },
      parsedData,
    });
  } catch (err) {
    console.error("Ingest error:", err);
    res.status(500).json({ error: "Failed to process claim file. Please try again." });
  }
});

export default router;
