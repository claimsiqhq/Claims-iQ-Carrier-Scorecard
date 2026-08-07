import { Router, type IRouter, type Request, type Response } from "express";
import {
  uploadFile,
  downloadFile,
  getSignedUrl,
  ensureBucket,
  isOrganizationStoragePath,
} from "../lib/supabaseStorage";
import { and, eq } from "drizzle-orm";
import { db, documents } from "@workspace/db";
import { getAuthorizedDocument } from "../lib/authorization";
import multer from "multer";
import { requireAuth } from "../middlewares/requireAuth";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import logger from "../lib/logger";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const wildcardParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value.join("/") : (value ?? "");

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });

ensureBucket().catch((err) => {
  logger.error({ err }, "Failed to ensure Supabase Storage bucket");
});

router.post("/storage/upload", requireAuth, requireOrganizationPermission("claims:create"), upload.single("file"), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      res.status(413).json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` });
      return;
    }

    const storagePath = await uploadFile(
      file.buffer,
      file.originalname,
      file.mimetype,
      req.organization!.organizationId,
    );

    res.json({
      storagePath,
      fileName: file.originalname,
      contentType: file.mimetype,
      size: file.size,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Upload error");
    res.status(500).json({ error: "Failed to upload file" });
  }
});

router.get("/documents/:documentId/download", requireAuth, requireOrganizationPermission("claims:read"), async (req: Request, res: Response) => {
  try {
    const documentId = Array.isArray(req.params.documentId)
      ? req.params.documentId[0] ?? ""
      : req.params.documentId ?? "";
    const document = await getAuthorizedDocument(
      req.organization!.organizationId,
      documentId,
    );
    if (!document?.fileUrl) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const buffer = await downloadFile(document.fileUrl);
    const metadata = document.metadata as Record<string, unknown> | null;
    res.setHeader(
      "Content-Type",
      typeof metadata?.contentType === "string"
        ? metadata.contentType
        : "application/octet-stream",
    );
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (error) {
    logger.error({ error }, "Authorized document download failed");
    res.status(404).json({ error: "Document not found" });
  }
});

router.get("/documents/:documentId/signed-url", requireAuth, requireOrganizationPermission("claims:read"), async (req: Request, res: Response) => {
  try {
    const documentId = Array.isArray(req.params.documentId)
      ? req.params.documentId[0] ?? ""
      : req.params.documentId ?? "";
    const document = await getAuthorizedDocument(
      req.organization!.organizationId,
      documentId,
    );
    if (!document?.fileUrl) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const url = await getSignedUrl(document.fileUrl);
    res.json({ url, expiresIn: 3600 });
  } catch (error) {
    logger.error({ error }, "Authorized document signing failed");
    res.status(404).json({ error: "Document not found" });
  }
});

router.get("/storage/download/*storagePath", requireAuth, requireOrganizationPermission("claims:read"), async (req: Request, res: Response) => {
  try {
    const storagePath = wildcardParam(req.params.storagePath);
    if (!storagePath) {
      res.status(400).json({ error: "Path is required" });
      return;
    }

    const [document] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, req.organization!.organizationId),
          eq(documents.fileUrl, storagePath),
        ),
      )
      .limit(1);
    if (
      !document?.fileUrl
      || !isOrganizationStoragePath(
        document.fileUrl,
        req.organization!.organizationId,
      )
    ) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const buffer = await downloadFile(document.fileUrl);
    const ext = storagePath.split(".").pop()?.toLowerCase();
    const contentType = ext === "pdf" ? "application/pdf" : "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (error: any) {
    logger.error({ err: error }, "Download error");
    res.status(404).json({ error: "File not found" });
  }
});

router.get("/storage/signed-url/*storagePath", requireAuth, requireOrganizationPermission("claims:read"), async (req: Request, res: Response) => {
  try {
    const storagePath = wildcardParam(req.params.storagePath);
    if (!storagePath) {
      res.status(400).json({ error: "Path is required" });
      return;
    }

    const [document] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, req.organization!.organizationId),
          eq(documents.fileUrl, storagePath),
        ),
      )
      .limit(1);
    if (
      !document?.fileUrl
      || !isOrganizationStoragePath(
        document.fileUrl,
        req.organization!.organizationId,
      )
    ) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const url = await getSignedUrl(document.fileUrl);
    res.json({ url });
  } catch (error: any) {
    logger.error({ err: error }, "Signed URL error");
    res.status(500).json({ error: "Failed to generate signed URL" });
  }
});

export default router;
