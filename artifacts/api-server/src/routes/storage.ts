import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, processingJobs } from "@workspace/db";
import {
  createTenantStorageCapability,
  PAGE_RENDITION_VERSION,
  type CanonicalDocumentReference,
} from "../lib/supabaseStorage";
import { getAuthorizedDocument } from "../lib/authorization";
import {
  buildJobIdempotencyKey,
  enqueueProcessingJob,
  retryOrganizationJob,
} from "../services/jobQueue";
import { readDocumentRenditionMetadata } from "../services/documentRenditions";
import { requireAuth } from "../middlewares/requireAuth";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import logger from "../lib/logger";

const router: IRouter = Router();

const SIGNED_URL_TTL_SECONDS = 120;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function storageForRequest(req: Request) {
  if (
    !req.user
    || !req.organization
    || !req.databaseSessionId
  ) {
    throw new Error("An authenticated tenant session is required");
  }
  return createTenantStorageCapability({
    organizationId: req.organization.organizationId,
    userId: req.user.id,
    sessionId: req.databaseSessionId,
    maxExpiresAt: req.organization.accessExpiresAt,
  });
}

async function authorizedDocument(
  req: Request,
  res: Response,
) {
  const documentId = firstParam(req.params.documentId);
  if (!UUID_RE.test(documentId)) {
    res.status(400).json({ error: "Invalid document ID format" });
    return null;
  }
  const document = await getAuthorizedDocument(
    req.organization!.organizationId,
    documentId,
  );
  if (!document?.claimId || !document.fileUrl) {
    res.status(404).json({ error: "Document not found" });
    return null;
  }
  return document;
}

async function latestRenditionJob(
  organizationId: string,
  documentId: string,
) {
  const [job] = await db
    .select()
    .from(processingJobs)
    .where(
      and(
        eq(processingJobs.organizationId, organizationId),
        eq(processingJobs.documentId, documentId),
        inArray(processingJobs.type, [
          "rendition",
          "ingest",
          "retry",
          "reprocess",
          "extract",
        ]),
      ),
    )
    .orderBy(desc(processingJobs.createdAt))
    .limit(1);
  return job ?? null;
}

function renditionResponse(
  document: Awaited<ReturnType<typeof getAuthorizedDocument>>,
  job: Awaited<ReturnType<typeof latestRenditionJob>>,
) {
  const rendition = readDocumentRenditionMetadata(
    document?.metadata,
    document?.pageCount,
  );
  const jobPreparing = job?.status === "queued" || job?.status === "running";
  const status = jobPreparing
    ? "preparing"
    : rendition?.status ?? "missing";
  return {
    documentId: document!.id,
    version: PAGE_RENDITION_VERSION,
    format: "jpeg" as const,
    status,
    pageCount: rendition?.pageCount ?? document!.pageCount ?? null,
    availablePages: rendition?.renderedPages ?? [],
    failedPages: rendition?.failedPages ?? [],
    error:
      rendition?.error
      ?? (job?.status === "failed" ? job.errorMessage : null)
      ?? null,
    job: job
      ? {
          id: job.id,
          status: job.status,
          stage: job.stage,
          progress: job.progress,
        }
      : null,
  };
}

export function canonicalReferenceFromDocument(
  document: {
    id: string;
    organizationId: string;
    claimId: string | null;
    fileUrl: string | null;
    metadata: unknown;
  },
  expectedOrganizationId: string,
): CanonicalDocumentReference | null {
  if (
    document.organizationId !== expectedOrganizationId
    || !document.claimId
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

router.get(
  "/documents/:documentId/download",
  requireAuth,
  requireOrganizationPermission("claims:read"),
  async (req: Request, res: Response) => {
    try {
      const organizationId = req.organization!.organizationId;
      const document = await getAuthorizedDocument(
        organizationId,
        firstParam(req.params.documentId),
      );
      const reference = document
        ? canonicalReferenceFromDocument(document, organizationId)
        : null;
      if (!reference) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      const storage = storageForRequest(req);
      storage.assertReference(reference);
      const buffer = await storage.downloadDocument(reference);
      const metadata = document!.metadata as Record<string, unknown>;
      res.setHeader(
        "Content-Type",
        typeof metadata.contentType === "string"
          ? metadata.contentType
          : "application/octet-stream",
      );
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Authorized document download failed",
      );
      res.status(404).json({ error: "Document not found" });
    }
  },
);

router.get(
  "/documents/:documentId/renditions",
  requireAuth,
  requireOrganizationPermission("claims:read"),
  async (req: Request, res: Response) => {
    try {
      const document = await authorizedDocument(req, res);
      if (!document) return;
      const job = await latestRenditionJob(
        req.organization!.organizationId,
        document.id,
      );
      res.json(renditionResponse(document, job));
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Document rendition lookup failed",
      );
      res.status(500).json({ error: "Document viewer status is unavailable" });
    }
  },
);

router.post(
  "/documents/:documentId/renditions",
  requireAuth,
  requireOrganizationPermission("claims:read"),
  async (req: Request, res: Response) => {
    try {
      const document = await authorizedDocument(req, res);
      if (!document) return;
      const metadata =
        document.metadata
        && typeof document.metadata === "object"
        && !Array.isArray(document.metadata)
          ? document.metadata as Record<string, unknown>
          : {};
      const fileName =
        typeof metadata.fileName === "string" ? metadata.fileName : "";
      const contentType =
        typeof metadata.contentType === "string" ? metadata.contentType : "";
      if (
        contentType.toLowerCase() !== "application/pdf"
        && !fileName.toLowerCase().endsWith(".pdf")
      ) {
        res.status(415).json({
          error: "Only PDF documents can be prepared for page viewing",
        });
        return;
      }

      const existingMetadata = readDocumentRenditionMetadata(
        document.metadata,
        document.pageCount,
      );
      if (
        existingMetadata
        && ["ready", "degraded"].includes(existingMetadata.status)
        && existingMetadata.renderedPages.length > 0
      ) {
        const job = await latestRenditionJob(
          req.organization!.organizationId,
          document.id,
        );
        res.json(renditionResponse(document, job));
        return;
      }

      const activeSourceJob = await latestRenditionJob(
        req.organization!.organizationId,
        document.id,
      );
      if (
        activeSourceJob?.status === "queued"
        || activeSourceJob?.status === "running"
      ) {
        res.json(renditionResponse(document, activeSourceJob));
        return;
      }

      const idempotencyKey = buildJobIdempotencyKey({
        organizationId: req.organization!.organizationId,
        type: "rendition",
        claimId: document.claimId,
        documentId: document.id,
        sourceHash: document.sourceSha256,
        callerKey:
          `${PAGE_RENDITION_VERSION}:${document.updatedAt.toISOString()}`,
      });
      const queued = await enqueueProcessingJob({
        organizationId: req.organization!.organizationId,
        claimId: document.claimId,
        documentId: document.id,
        requestedByUserId: req.user!.id,
        type: "rendition",
        idempotencyKey,
        priority: 80,
      });
      let job = queued.job;
      if (
        !queued.created
        && ["failed", "degraded", "cancelled"].includes(job.status)
      ) {
        job =
          await retryOrganizationJob(
            req.organization!.organizationId,
            job.id,
          )
          ?? job;
      }
      res.status(queued.created ? 202 : 200).json(
        renditionResponse(document, job),
      );
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Document rendition enqueue failed",
      );
      res.status(500).json({ error: "Document viewer could not be prepared" });
    }
  },
);

router.get(
  "/documents/:documentId/renditions/:pageNumber",
  requireAuth,
  requireOrganizationPermission("claims:read"),
  async (req: Request, res: Response) => {
    try {
      const document = await authorizedDocument(req, res);
      if (!document) return;
      const pageNumber = Number.parseInt(
        firstParam(req.params.pageNumber),
        10,
      );
      if (
        !Number.isInteger(pageNumber)
        || pageNumber < 1
        || (document.pageCount && pageNumber > document.pageCount)
      ) {
        res.status(400).json({ error: "Invalid page number" });
        return;
      }
      const storage = storageForRequest(req);
      const reference = storage.pageRenditionReference({
        claimId: document.claimId!,
        documentId: document.id,
        pageNumber,
      });
      if (!(await storage.pageRenditionExists(reference))) {
        res.status(404).json({ error: "Document page is not available" });
        return;
      }
      const url = await storage.createSignedPageRenditionUrl(
        reference,
        SIGNED_URL_TTL_SECONDS,
      );
      res.setHeader("Cache-Control", "private, max-age=30");
      res.redirect(302, url);
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Authorized document page signing failed",
      );
      res.status(404).json({ error: "Document page is not available" });
    }
  },
);

router.get(
  "/documents/:documentId/signed-url",
  requireAuth,
  requireOrganizationPermission("claims:read"),
  async (req: Request, res: Response) => {
    try {
      const organizationId = req.organization!.organizationId;
      const document = await getAuthorizedDocument(
        organizationId,
        firstParam(req.params.documentId),
      );
      const reference = document
        ? canonicalReferenceFromDocument(document, organizationId)
        : null;
      if (!reference) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      const storage = storageForRequest(req);
      storage.assertReference(reference);
      if (!(await storage.documentExists(reference))) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      const url = await storage.createSignedDocumentUrl(
        reference,
        SIGNED_URL_TTL_SECONDS,
      );
      res.json({ url, expiresIn: SIGNED_URL_TTL_SECONDS });
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Authorized document signing failed",
      );
      res.status(404).json({ error: "Document not found" });
    }
  },
);

export default router;
