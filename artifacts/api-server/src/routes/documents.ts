import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { and, eq } from "drizzle-orm";
import {
  claimActivity,
  db,
  documents,
} from "@workspace/db";
import {
  buildJobIdempotencyKey,
  ClaimJobStateError,
  enqueueProcessingJob,
} from "../services/jobQueue";
import {
  createTenantStorageCapability,
  type CanonicalDocumentReference,
} from "../lib/supabaseStorage";
import {
  getAuthorizedClaim,
  getAuthorizedDocument,
} from "../lib/authorization";
import { requireAuth } from "../middlewares/requireAuth";
import {
  requireOrganizationPermission,
  withTenantDatabaseContext,
} from "../middlewares/organizationContext";
import logger from "../lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DOCUMENT_SIZE = 100 * 1024 * 1024;
const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_SIZE, files: 1 },
});
const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

function storageForRequest(req: Express.Request) {
  if (!req.user || !req.organization || !req.databaseSessionId) {
    throw new Error("An authenticated tenant session is required");
  }
  return createTenantStorageCapability({
    organizationId: req.organization.organizationId,
    userId: req.user.id,
    sessionId: req.databaseSessionId,
    maxExpiresAt: req.organization.accessExpiresAt,
  });
}

function exactDocumentReference(document: {
  id: string;
  organizationId: string;
  claimId: string | null;
  fileUrl: string | null;
  metadata: unknown;
}): CanonicalDocumentReference | null {
  if (
    !document.claimId
    || !document.fileUrl
    || !document.metadata
    || typeof document.metadata !== "object"
    || Array.isArray(document.metadata)
  ) {
    return null;
  }
  const metadata = document.metadata as Record<string, unknown>;
  if (
    metadata.organizationId !== document.organizationId
    || metadata.claimId !== document.claimId
    || metadata.documentId !== document.id
    || metadata.storagePath !== document.fileUrl
  ) {
    return null;
  }
  return {
    claimId: document.claimId,
    documentId: document.id,
    storagePath: document.fileUrl,
  };
}

router.post(
  "/claims/:id/documents",
  requireAuth,
  requireOrganizationPermission("claims:update"),
  upload.single("file"),
  withTenantDatabaseContext(async (req, res) => {
    let uploadedReference: CanonicalDocumentReference | null = null;
    try {
      const claimId = firstParam(req.params.id);
      if (!UUID_RE.test(claimId)) {
        res.status(400).json({ error: "Invalid claim ID format" });
        return;
      }
      const claim = await getAuthorizedClaim(
        req.organization!.organizationId,
        claimId,
      );
      if (!claim) {
        res.status(404).json({ error: "Claim not found" });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({
          error: "A file upload is required; raw storage paths are not accepted",
        });
        return;
      }
      if (file.buffer.length > MAX_DOCUMENT_SIZE) {
        res.status(413).json({ error: "Document exceeds the upload limit" });
        return;
      }

      const organizationId = req.organization!.organizationId;
      const documentId = randomUUID();
      const storage = storageForRequest(req);
      const storagePath = await storage.uploadDocument({
        claimId,
        documentId,
        fileName: file.originalname,
        contentType: file.mimetype || "application/octet-stream",
        body: file.buffer,
      });
      uploadedReference = { claimId, documentId, storagePath };
      if (!(await storage.documentExists(uploadedReference))) {
        throw new Error("Uploaded storage object could not be verified");
      }

      const document = await db.transaction(async (tx) => {
        const [registeredDocument] = await tx
          .insert(documents)
          .values({
            id: documentId,
            organizationId,
            claimId,
            uploadedByUserId: req.user!.id,
            type:
              typeof req.body?.type === "string" && req.body.type.trim()
                ? req.body.type.trim()
                : "claim_file",
            fileUrl: storagePath,
            metadata: {
              organizationId,
              claimId,
              documentId,
              fileName: file.originalname,
              contentType: file.mimetype || "application/octet-stream",
              storagePath,
              size: file.size,
            },
          })
          .returning();
        await tx.insert(claimActivity).values({
          organizationId: req.organization!.organizationId,
          claimId,
          actorUserId: req.user!.id,
          activityType: "document_added",
          metadata: {
            documentId: registeredDocument.id,
            type: registeredDocument.type,
          },
        });
        return registeredDocument;
      });
      uploadedReference = null;
      res.status(201).json({
        id: document.id,
        claimId: document.claimId,
        type: document.type,
        createdAt: document.createdAt?.toISOString(),
      });
    } catch (error) {
      if (uploadedReference) {
        try {
          await storageForRequest(req).deleteDocument(uploadedReference);
        } catch (cleanupError) {
          logger.error(
            {
              errorName:
                cleanupError instanceof Error
                  ? cleanupError.name
                  : "UnknownError",
            },
            "Failed to clean up unregistered document object",
          );
        }
      }
      logger.error({ error }, "Document creation failed");
      res.status(500).json({ error: "Failed to create document" });
    }
  }),
);

router.delete(
  "/claims/:id/documents/:docId",
  requireAuth,
  requireOrganizationPermission("claims:update"),
  async (req, res) => {
    try {
      const claimId = firstParam(req.params.id);
      const documentId = firstParam(req.params.docId);
      if (!UUID_RE.test(claimId) || !UUID_RE.test(documentId)) {
        res.status(400).json({ error: "Invalid ID format" });
        return;
      }
      const document = await getAuthorizedDocument(
        req.organization!.organizationId,
        documentId,
        claimId,
      );
      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      const storage = storageForRequest(req);
      const storageReference = document.fileUrl
        ? exactDocumentReference(document)
        : null;
      if (
        document.fileUrl
        && (
          !storageReference
          || !storage.ownsReference(storageReference)
          || !(await storage.documentExists(storageReference))
        )
      ) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      try {
        await db.transaction(async (tx) => {
          await tx
            .delete(documents)
            .where(
              and(
                eq(documents.id, documentId),
                eq(
                  documents.organizationId,
                  req.organization!.organizationId,
                ),
              ),
            );
          await tx.insert(claimActivity).values({
            organizationId: req.organization!.organizationId,
            claimId,
            actorUserId: req.user!.id,
            activityType: "document_deleted",
            metadata: { documentId },
          });
        });
      } catch (error) {
        logger.warn(
          { error, documentId },
          "Document deletion blocked by retained audit evidence",
        );
        res.status(409).json({
          error: "Document is retained because it is referenced by audit evidence",
        });
        return;
      }

      if (storageReference) {
        await storage.deleteDocument(storageReference);
      }
      res.json({ success: true, message: "Document deleted" });
    } catch (error) {
      logger.error({ error }, "Document deletion failed");
      res.status(500).json({ error: "Failed to delete document" });
    }
  },
);

router.post(
  "/claims/:id/documents/:docId/extract",
  requireAuth,
  requireOrganizationPermission("claims:update"),
  async (req, res) => {
    try {
      const claimId = firstParam(req.params.id);
      const documentId = firstParam(req.params.docId);
      if (!UUID_RE.test(claimId) || !UUID_RE.test(documentId)) {
        res.status(400).json({ error: "Invalid ID format" });
        return;
      }
      const document = await getAuthorizedDocument(
        req.organization!.organizationId,
        documentId,
        claimId,
      );
      if (!document?.fileUrl) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      const callerKey =
        typeof req.headers["x-idempotency-key"] === "string"
          ? req.headers["x-idempotency-key"].trim()
          : null;
      const idempotencyKey = buildJobIdempotencyKey({
        organizationId: req.organization!.organizationId,
        type: "extract",
        claimId,
        documentId,
        sourceHash: document.sourceSha256,
        callerKey:
          callerKey
          || `extract:${document.updatedAt.toISOString()}`,
      });
      const queued = await enqueueProcessingJob({
        organizationId: req.organization!.organizationId,
        claimId,
        documentId,
        requestedByUserId: req.user!.id,
        type: "extract",
        idempotencyKey,
      });
      res.status(202).json({
        job: {
          id: queued.job.id,
          claimId,
          documentId,
          status: queued.job.status,
          stage: queued.job.stage,
        },
        duplicate: !queued.created,
      });
    } catch (error) {
      if (error instanceof ClaimJobStateError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ error }, "Document extraction enqueue failed");
      res.status(500).json({ error: "Failed to queue document extraction" });
    }
  },
);

export default router;
