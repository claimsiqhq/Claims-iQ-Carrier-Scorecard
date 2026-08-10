import { Router, type IRouter } from "express";
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
  deleteFile,
  isOrganizationStoragePath,
} from "../lib/supabaseStorage";
import {
  getAuthorizedClaim,
  getAuthorizedDocument,
} from "../lib/authorization";
import { requireAuth } from "../middlewares/requireAuth";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import logger from "../lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const router: IRouter = Router();
const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

router.post(
  "/claims/:id/documents",
  requireAuth,
  requireOrganizationPermission("claims:update"),
  async (req, res) => {
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

      const { type, storagePath, fileName, contentType } = req.body;
      if (
        typeof storagePath !== "string"
        || !storagePath
        || typeof fileName !== "string"
        || !fileName
      ) {
        res.status(400).json({ error: "storagePath and fileName are required" });
        return;
      }
      if (
        !isOrganizationStoragePath(
          storagePath,
          req.organization!.organizationId,
        )
      ) {
        res.status(400).json({ error: "Invalid organization storage path" });
        return;
      }

      const [document] = await db
        .insert(documents)
        .values({
          organizationId: req.organization!.organizationId,
          claimId,
          uploadedByUserId: req.user!.id,
          type: typeof type === "string" && type ? type : "claim_file",
          fileUrl: storagePath,
          metadata: {
            fileName,
            contentType:
              typeof contentType === "string"
                ? contentType
                : "application/octet-stream",
            storagePath,
          },
        })
        .returning();
      await db.insert(claimActivity).values({
        organizationId: req.organization!.organizationId,
        claimId,
        actorUserId: req.user!.id,
        activityType: "document_added",
        metadata: { documentId: document.id, type: document.type },
      });
      res.status(201).json({
        id: document.id,
        claimId: document.claimId,
        type: document.type,
        createdAt: document.createdAt?.toISOString(),
      });
    } catch (error) {
      logger.error({ error }, "Document creation failed");
      res.status(500).json({ error: "Failed to create document" });
    }
  },
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

      if (
        document.fileUrl
        && isOrganizationStoragePath(
          document.fileUrl,
          req.organization!.organizationId,
        )
      ) {
        await deleteFile(document.fileUrl);
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
