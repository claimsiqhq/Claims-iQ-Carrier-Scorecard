import { Router, type IRouter } from "express";
import { createRequire } from "module";
import { db, pool } from "@workspace/db";
import { claims, documents } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { downloadFile } from "../lib/supabaseStorage";
import { requireAuth } from "../middlewares/requireAuth";
import logger from "../lib/logger";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PDF_SIZE = 100 * 1024 * 1024;
const router: IRouter = Router();

router.post("/claims/:id/documents", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid claim ID format" });
      return;
    }

    const [claim] = await db.select().from(claims).where(eq(claims.id, id));
    if (!claim) {
      res.status(404).json({ error: "Claim not found" });
      return;
    }

    const { type, storagePath, fileName, contentType } = req.body;
    if (!storagePath || !fileName) {
      res.status(400).json({ error: "storagePath and fileName are required" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const txDb = drizzle(client, { schema });

      await txDb.delete(documents).where(eq(documents.claimId, id));

      const [doc] = await txDb.insert(documents).values({
        claimId: id,
        type: type || "claim_file",
        fileUrl: storagePath,
        metadata: { fileName, contentType: contentType || "application/octet-stream", storagePath },
      }).returning();

      await client.query("COMMIT");

      res.status(201).json({
        id: doc.id,
        claimId: doc.claimId ?? "",
        type: doc.type ?? "",
        fileUrl: doc.fileUrl ?? undefined,
        createdAt: doc.createdAt?.toISOString() ?? undefined,
      });
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, "Error creating document");
    res.status(500).json({ error: "Failed to create document" });
  }
});

router.delete("/claims/:id/documents/:docId", requireAuth, async (req, res) => {
  try {
    const { id, docId } = req.params;
    if (!UUID_RE.test(id) || !UUID_RE.test(docId)) {
      res.status(400).json({ error: "Invalid ID format" });
      return;
    }

    const [doc] = await db.select().from(documents).where(
      and(eq(documents.id, docId), eq(documents.claimId, id))
    );

    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    await db.delete(documents).where(eq(documents.id, docId));
    res.json({ success: true, message: "Document deleted" });
  } catch (err) {
    logger.error({ err }, "Error deleting document");
    res.status(500).json({ error: "Failed to delete document" });
  }
});

router.post("/claims/:id/documents/:docId/extract", requireAuth, async (req, res) => {
  try {
    const { id, docId } = req.params;
    if (!UUID_RE.test(id) || !UUID_RE.test(docId)) {
      res.status(400).json({ error: "Invalid ID format" });
      return;
    }

    const [doc] = await db.select().from(documents).where(
      and(eq(documents.id, docId), eq(documents.claimId, id))
    );

    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const meta = doc.metadata as Record<string, unknown> | null;
    const storagePath = (meta?.storagePath as string) || doc.fileUrl || "";
    const contentType = (meta?.contentType as string) || "";

    let extractedText = "";

    if (contentType === "application/pdf" && storagePath) {
      try {
        const buffer = await downloadFile(storagePath);
        if (buffer.length > MAX_PDF_SIZE) {
          res.status(413).json({ error: `File too large for text extraction (${MAX_PDF_SIZE / 1024 / 1024}MB limit)` });
          return;
        }
        const pdfData = await pdfParse(buffer);
        extractedText = pdfData.text;
      } catch (pdfErr) {
        logger.error({ err: pdfErr }, "PDF extraction failed");
        extractedText = "[PDF extraction failed]";
      }
    } else if (contentType?.startsWith("text/") && storagePath) {
      try {
        const buffer = await downloadFile(storagePath);
        if (buffer.length > MAX_PDF_SIZE) {
          res.status(413).json({ error: "File too large for text extraction" });
          return;
        }
        extractedText = buffer.toString("utf-8");
      } catch (txtErr) {
        logger.error({ err: txtErr }, "Text extraction failed");
        extractedText = "[Text extraction failed]";
      }
    } else {
      extractedText = `[No text extraction available for ${contentType}]`;
    }

    await db.update(documents).set({ extractedText }).where(eq(documents.id, docId));

    res.json({
      documentId: docId,
      extractedLength: extractedText.length,
      preview: extractedText.substring(0, 500),
    });
  } catch (err) {
    logger.error({ err }, "Error extracting text");
    res.status(500).json({ error: "Failed to extract text" });
  }
});

export default router;
