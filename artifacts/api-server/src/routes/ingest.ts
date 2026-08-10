import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import multer from "multer";
import {
  and,
  desc,
  eq,
  ne,
} from "drizzle-orm";
import {
  claimActivity,
  claims,
  db,
  documents,
  processingJobs,
} from "@workspace/db";
import {
  buildJobIdempotencyKey,
  ClaimJobStateError,
  enqueueProcessingJob,
  retryOrganizationJob,
} from "../services/jobQueue";
import {
  deleteFile,
  uploadFile,
} from "../lib/supabaseStorage";
import { getAuthorizedClaim } from "../lib/authorization";
import { requireAuth } from "../middlewares/requireAuth";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import logger from "../lib/logger";

const MAX_PDF_SIZE = 100 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_SIZE },
});
const router: IRouter = Router();

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function callerIdempotencyKey(req: {
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  const value = req.headers["x-idempotency-key"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

router.post(
  "/ingest",
  requireAuth,
  requireOrganizationPermission("claims:create"),
  upload.single("file"),
  async (req, res) => {
    const organization = req.organization!;
    let uploadedStoragePath: string | null = null;
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No file uploaded. Please attach a document." });
        return;
      }
      if (file.buffer.length > MAX_PDF_SIZE) {
        res.status(413).json({
          error: `File too large. Maximum size is ${MAX_PDF_SIZE / 1024 / 1024}MB.`,
        });
        return;
      }
      if (file.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
        res.status(415).json({
          error: "Only valid PDF claim packages are accepted.",
        });
        return;
      }

      const sourceHash = createHash("sha256").update(file.buffer).digest("hex");
      const requestedCarrier =
        typeof req.body?.carrier === "string" && req.body.carrier.trim()
          ? req.body.carrier.trim()
          : null;
      const idempotencyKey = buildJobIdempotencyKey({
        organizationId: organization.organizationId,
        type: "ingest",
        sourceHash,
        requestedCarrier,
        callerKey: callerIdempotencyKey(req),
      });

      const [existing] = await db
        .select()
        .from(processingJobs)
        .where(
          and(
            eq(processingJobs.organizationId, organization.organizationId),
            eq(processingJobs.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        res.status(202).json({
          job: {
            id: existing.id,
            claimId: existing.claimId,
            status: existing.status,
            stage: existing.stage,
            progress: existing.progress,
          },
          duplicate: true,
        });
        return;
      }

      uploadedStoragePath = await uploadFile(
        file.buffer,
        file.originalname,
        "application/pdf",
        organization.organizationId,
      );

      const result = await db.transaction(async (tx) => {
        const [reservedJob] = await tx
          .insert(processingJobs)
          .values({
            organizationId: organization.organizationId,
            requestedByUserId: req.user!.id,
            type: "ingest",
            status: "queued",
            stage: "uploaded",
            idempotencyKey,
            payload: { carrier: requestedCarrier },
          })
          .onConflictDoNothing({
            target: [
              processingJobs.organizationId,
              processingJobs.idempotencyKey,
            ],
          })
          .returning();

        if (!reservedJob) return null;

        const [newClaim] = await tx
          .insert(claims)
          .values({
            organizationId: organization.organizationId,
            ownerUserId: req.user!.id,
            claimNumber: `CLM-${reservedJob.id.slice(0, 8)}`,
            insuredName: "Processing…",
            status: "processing",
            carrier: requestedCarrier,
            systemStatus: "processing",
            aiStatus: "queued",
            humanReviewStatus: "unassigned",
          })
          .returning();

        const [document] = await tx
          .insert(documents)
          .values({
            organizationId: organization.organizationId,
            claimId: newClaim.id,
            uploadedByUserId: req.user!.id,
            type: "claim_file",
            fileUrl: uploadedStoragePath!,
            sourceSha256: sourceHash,
            metadata: {
              fileName: file.originalname,
              contentType: "application/pdf",
              storagePath: uploadedStoragePath,
              size: file.size,
            },
          })
          .returning();

        const [job] = await tx
          .update(processingJobs)
          .set({
            claimId: newClaim.id,
            documentId: document.id,
          })
          .where(eq(processingJobs.id, reservedJob.id))
          .returning();

        await tx.insert(claimActivity).values({
          organizationId: organization.organizationId,
          claimId: newClaim.id,
          actorUserId: req.user!.id,
          activityType: "claim_uploaded",
          metadata: {
            documentId: document.id,
            processingJobId: job.id,
            sourceSha256: sourceHash,
          },
        });

        return { claim: newClaim, document, job };
      });

      if (!result) {
        await deleteFile(uploadedStoragePath);
        uploadedStoragePath = null;
        const [raceWinner] = await db
          .select()
          .from(processingJobs)
          .where(
            and(
              eq(processingJobs.organizationId, organization.organizationId),
              eq(processingJobs.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (!raceWinner) throw new Error("Failed to resolve duplicate ingestion");
        res.status(202).json({
          job: {
            id: raceWinner.id,
            claimId: raceWinner.claimId,
            status: raceWinner.status,
            stage: raceWinner.stage,
            progress: raceWinner.progress,
          },
          duplicate: true,
        });
        return;
      }

      logger.info(
        {
          claimId: result.claim.id,
          documentId: result.document.id,
          jobId: result.job.id,
          organizationId: organization.organizationId,
        },
        "Ingestion stored and queued",
      );
      res.status(202).json({
        claim: {
          id: result.claim.id,
          claimNumber: result.claim.claimNumber,
          status: result.claim.status,
        },
        document: {
          id: result.document.id,
          fileName: file.originalname,
        },
        job: {
          id: result.job.id,
          status: result.job.status,
          stage: result.job.stage,
          progress: result.job.progress,
        },
      });
    } catch (error) {
      if (uploadedStoragePath) {
        await deleteFile(uploadedStoragePath).catch(() => undefined);
      }
      logger.error({ error }, "Ingestion enqueue failed");
      res.status(500).json({ error: "Failed to store and queue claim file" });
    }
  },
);

router.get(
  "/claims/:id/processing-status",
  requireAuth,
  requireOrganizationPermission("jobs:read"),
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
      const [job] = await db
        .select()
        .from(processingJobs)
        .where(
          and(
            eq(processingJobs.organizationId, req.organization!.organizationId),
            eq(processingJobs.claimId, claimId),
          ),
        )
        .orderBy(desc(processingJobs.createdAt))
        .limit(1);

      res.json({
        claimId,
        status:
          job?.status === "queued" || job?.status === "running"
            ? "processing"
            : job?.status === "failed"
              ? "error"
              : "ready",
        error: job?.status === "failed" ? job.errorMessage : undefined,
        claimNumber: claim.claimNumber,
        insuredName: claim.insuredName,
        carrier: claim.carrier ?? "",
        dateOfLoss: claim.dateOfLoss ?? "",
        systemStatus: claim.systemStatus,
        aiStatus: claim.aiStatus,
        humanReviewStatus: claim.humanReviewStatus,
        job: job
          ? {
              id: job.id,
              type: job.type,
              status: job.status,
              stage: job.stage,
              progress: job.progress,
              attemptCount: job.attemptCount,
              maxAttempts: job.maxAttempts,
              error:
                job.status === "failed" || job.status === "degraded"
                  ? {
                      code: job.errorCode,
                      message: job.errorMessage,
                    }
                  : undefined,
            }
          : null,
      });
    } catch (error) {
      logger.error({ error }, "Processing status lookup failed");
      res.status(500).json({ error: "Failed to check processing status" });
    }
  },
);

async function enqueueExistingClaimJob(input: {
  organizationId: string;
  userId: string;
  claimId: string;
  type: "retry" | "reprocess";
  carrier?: string | null;
  callerKey?: string | null;
}) {
  const [document] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, input.organizationId),
        eq(documents.claimId, input.claimId),
        eq(documents.type, "claim_file"),
      ),
    )
    .orderBy(desc(documents.createdAt))
    .limit(1);
  if (!document?.fileUrl) return null;

  const [active] = await db
    .select()
    .from(processingJobs)
    .where(
      and(
        eq(processingJobs.organizationId, input.organizationId),
        eq(processingJobs.claimId, input.claimId),
        eq(processingJobs.status, "queued"),
      ),
    )
    .orderBy(desc(processingJobs.createdAt))
    .limit(1);
  if (active) return { job: active, created: false };

  const [running] = await db
    .select()
    .from(processingJobs)
    .where(
      and(
        eq(processingJobs.organizationId, input.organizationId),
        eq(processingJobs.claimId, input.claimId),
        eq(processingJobs.status, "running"),
      ),
    )
    .orderBy(desc(processingJobs.createdAt))
    .limit(1);
  if (running) return { job: running, created: false };

  const [claim] = await db
    .select({ currentAuditId: claims.currentAuditId })
    .from(claims)
    .where(
      and(
        eq(claims.id, input.claimId),
        eq(claims.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  const idempotencyKey = buildJobIdempotencyKey({
    organizationId: input.organizationId,
    type: input.type,
    claimId: input.claimId,
    documentId: document.id,
    requestedCarrier: input.carrier,
    callerKey:
      input.callerKey
      ?? `${input.type}:${claim?.currentAuditId ?? "no-successful-audit"}`,
  });
  const queued = await enqueueProcessingJob({
    organizationId: input.organizationId,
    claimId: input.claimId,
    documentId: document.id,
    requestedByUserId: input.userId,
    type: input.type,
    idempotencyKey,
    payload: { carrier: input.carrier ?? null },
  });
  if (
    !queued.created
    && ["failed", "degraded", "cancelled"].includes(queued.job.status)
  ) {
    const retried = await retryOrganizationJob(
      input.organizationId,
      queued.job.id,
    );
    if (retried) return { job: retried, created: false };
  }
  return queued;
}

router.post(
  "/claims/:id/retry",
  requireAuth,
  requireOrganizationPermission("jobs:retry"),
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

      const [latest] = await db
        .select()
        .from(processingJobs)
        .where(
          and(
            eq(processingJobs.organizationId, req.organization!.organizationId),
            eq(processingJobs.claimId, claimId),
          ),
        )
        .orderBy(desc(processingJobs.createdAt))
        .limit(1);
      if (
        latest
        && ["failed", "degraded", "cancelled"].includes(latest.status)
      ) {
        const retried = await retryOrganizationJob(
          req.organization!.organizationId,
          latest.id,
        );
        if (retried) {
          res.status(202).json({
            job: {
              id: retried.id,
              claimId,
              status: retried.status,
              stage: retried.stage,
            },
          });
          return;
        }
      }

      const queued = await enqueueExistingClaimJob({
        organizationId: req.organization!.organizationId,
        userId: req.user!.id,
        claimId,
        type: "retry",
        carrier: claim.carrier,
        callerKey: callerIdempotencyKey(req),
      });
      if (!queued) {
        res.status(400).json({ error: "No source document found for this claim" });
        return;
      }
      await db
        .update(claims)
        .set({ status: "processing", systemStatus: "processing", aiStatus: "queued" })
        .where(
          and(
            eq(claims.id, claimId),
            eq(claims.organizationId, req.organization!.organizationId),
            ne(claims.status, "archived"),
            ne(claims.systemStatus, "archived"),
          ),
        );
      res.status(202).json({
        job: {
          id: queued.job.id,
          claimId,
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
      logger.error({ error }, "Claim retry enqueue failed");
      res.status(500).json({ error: "Failed to queue claim retry" });
    }
  },
);

router.post(
  "/claims/:id/reprocess",
  requireAuth,
  requireOrganizationPermission("audits:run"),
  async (req, res) => {
    try {
      const claimId = firstParam(req.params.id);
      if (!UUID_RE.test(claimId)) {
        res.status(400).json({ error: "Invalid claim ID format" });
        return;
      }
      const carrier =
        typeof req.body?.carrier === "string" ? req.body.carrier.trim() : "";
      if (!carrier) {
        res.status(400).json({ error: "carrier is required" });
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

      const queued = await enqueueExistingClaimJob({
        organizationId: req.organization!.organizationId,
        userId: req.user!.id,
        claimId,
        type: "reprocess",
        carrier,
        callerKey: callerIdempotencyKey(req),
      });
      if (!queued) {
        res.status(400).json({ error: "No source document found for this claim" });
        return;
      }
      await db
        .update(claims)
        .set({
          carrier,
          status: "processing",
          systemStatus: "processing",
          aiStatus: "queued",
        })
        .where(
          and(
            eq(claims.id, claimId),
            eq(claims.organizationId, req.organization!.organizationId),
            ne(claims.status, "archived"),
            ne(claims.systemStatus, "archived"),
          ),
        );
      res.status(202).json({
        job: {
          id: queued.job.id,
          claimId,
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
      logger.error({ error }, "Claim reprocess enqueue failed");
      res.status(500).json({ error: "Failed to queue claim reprocessing" });
    }
  },
);

export async function recoverStuckClaims(): Promise<void> {
  // Compatibility export for older callers. Lease recovery is now atomic and
  // happens inside claimNextJob() with FOR UPDATE SKIP LOCKED.
}

export default router;
