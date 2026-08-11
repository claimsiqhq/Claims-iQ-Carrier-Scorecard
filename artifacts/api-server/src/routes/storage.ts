import { Router, type IRouter, type Request, type Response } from "express";
import {
  createTenantStorageCapability,
  type CanonicalDocumentReference,
} from "../lib/supabaseStorage";
import { getAuthorizedDocument } from "../lib/authorization";
import { requireAuth } from "../middlewares/requireAuth";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import logger from "../lib/logger";

const router: IRouter = Router();

const SIGNED_URL_TTL_SECONDS = 120;

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
