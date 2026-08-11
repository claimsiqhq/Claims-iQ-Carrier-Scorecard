import { Router, type IRouter } from "express";
import { and, eq, ne } from "drizzle-orm";
import { claimActivity, claims, db } from "@workspace/db";
import {
  cancelOrganizationJob,
  ClaimJobStateError,
  getOrganizationJob,
  listClaimJobs,
  listJobAttempts,
  retryOrganizationJob,
} from "../services/jobQueue";
import { getAuthorizedClaim } from "../lib/authorization";
import { requireAuth } from "../middlewares/requireAuth";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import logger from "../lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const router: IRouter = Router();
const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

function hasJobScopeOverride(body: unknown): boolean {
  return Boolean(
    body &&
      typeof body === "object" &&
      [
        "organizationId",
        "tenantId",
        "carrier",
        "carrierKey",
        "carrierEntityId",
      ].some((key) => key in body),
  );
}

function mapJob(job: Awaited<ReturnType<typeof getOrganizationJob>>) {
  if (!job) return null;
  return {
    id: job.id,
    claimId: job.claimId,
    documentId: job.documentId,
    type: job.type,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    heartbeatAt: job.heartbeatAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    error:
      job.errorCode || job.errorMessage
        ? { code: job.errorCode, message: job.errorMessage }
        : null,
  };
}

router.get(
  "/processing-jobs/:jobId",
  requireAuth,
  requireOrganizationPermission("jobs:read"),
  async (req, res) => {
    try {
      const jobId = firstParam(req.params.jobId);
      if (!UUID_RE.test(jobId)) {
        res.status(400).json({ error: "Invalid job ID format" });
        return;
      }
      const job = await getOrganizationJob(req.organization!.organizationId, jobId);
      if (!job) {
        res.status(404).json({ error: "Processing job not found" });
        return;
      }
      const attempts = await listJobAttempts(
        req.organization!.organizationId,
        jobId,
      );
      res.json({
        job: mapJob(job),
        attempts: attempts.map((attempt) => ({
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          startedAt: attempt.startedAt.toISOString(),
          completedAt: attempt.completedAt?.toISOString() ?? null,
          error:
            attempt.errorCode || attempt.errorMessage
              ? { code: attempt.errorCode, message: attempt.errorMessage }
              : null,
        })),
      });
    } catch (error) {
      logger.error({ error }, "Processing job lookup failed");
      res.status(500).json({ error: "Failed to load processing job" });
    }
  },
);

router.get(
  "/claims/:id/processing-jobs",
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
      const limit = Number.parseInt(String(req.query.limit ?? "20"), 10);
      const jobs = await listClaimJobs(
        req.organization!.organizationId,
        claimId,
        limit,
      );
      res.json({ jobs: jobs.map((job) => mapJob(job)) });
    } catch (error) {
      logger.error({ error }, "Claim processing jobs lookup failed");
      res.status(500).json({ error: "Failed to load processing jobs" });
    }
  },
);

router.post(
  "/processing-jobs/:jobId/cancel",
  requireAuth,
  requireOrganizationPermission("jobs:cancel"),
  async (req, res) => {
    try {
      if (hasJobScopeOverride(req.body)) {
        res.status(400).json({
          error: "Processing job scope is derived from the authenticated tenant.",
        });
        return;
      }
      const jobId = firstParam(req.params.jobId);
      if (!UUID_RE.test(jobId)) {
        res.status(400).json({ error: "Invalid job ID format" });
        return;
      }
      const existing = await getOrganizationJob(
        req.organization!.organizationId,
        jobId,
      );
      if (!existing) {
        res.status(404).json({ error: "Processing job not found" });
        return;
      }
      const cancelled = await cancelOrganizationJob(
        req.organization!.organizationId,
        jobId,
      );
      if (!cancelled) {
        res.status(409).json({ error: "Only queued or running jobs can be cancelled" });
        return;
      }
      if (cancelled.claimId) {
        const claim = await getAuthorizedClaim(
          req.organization!.organizationId,
          cancelled.claimId,
        );
        await db.transaction(async (tx) => {
          await tx
            .update(claims)
            .set({
              status: claim?.currentAuditId ? "analyzed" : "pending",
              systemStatus: "ready",
              aiStatus: "cancelled",
            })
            .where(
              and(
                eq(claims.id, cancelled.claimId!),
                eq(claims.organizationId, req.organization!.organizationId),
                ne(claims.status, "archived"),
                ne(claims.systemStatus, "archived"),
              ),
            );
          await tx.insert(claimActivity).values({
            organizationId: req.organization!.organizationId,
            claimId: cancelled.claimId!,
            actorUserId: req.user!.id,
            activityType: "processing_cancelled",
            metadata: { processingJobId: jobId },
          });
        });
      }
      res.json({ job: mapJob(cancelled) });
    } catch (error) {
      logger.error({ error }, "Processing job cancellation failed");
      res.status(500).json({ error: "Failed to cancel processing job" });
    }
  },
);

router.post(
  "/processing-jobs/:jobId/retry",
  requireAuth,
  requireOrganizationPermission("jobs:retry"),
  async (req, res) => {
    try {
      if (hasJobScopeOverride(req.body)) {
        res.status(400).json({
          error: "Processing job scope is derived from the authenticated tenant.",
        });
        return;
      }
      const jobId = firstParam(req.params.jobId);
      if (!UUID_RE.test(jobId)) {
        res.status(400).json({ error: "Invalid job ID format" });
        return;
      }
      const existing = await getOrganizationJob(
        req.organization!.organizationId,
        jobId,
      );
      if (!existing) {
        res.status(404).json({ error: "Processing job not found" });
        return;
      }
      const retried = await retryOrganizationJob(
        req.organization!.organizationId,
        jobId,
      );
      if (!retried) {
        res.status(409).json({
          error: "Only failed, degraded, or cancelled jobs can be retried",
        });
        return;
      }
      if (retried.claimId) {
        await db.transaction(async (tx) => {
          await tx
            .update(claims)
            .set({
              status: "processing",
              systemStatus: "processing",
              aiStatus: "queued",
            })
            .where(
              and(
                eq(claims.id, retried.claimId!),
                eq(claims.organizationId, req.organization!.organizationId),
                ne(claims.status, "archived"),
                ne(claims.systemStatus, "archived"),
              ),
            );
          await tx.insert(claimActivity).values({
            organizationId: req.organization!.organizationId,
            claimId: retried.claimId!,
            actorUserId: req.user!.id,
            activityType: "processing_retried",
            metadata: { processingJobId: jobId },
          });
        });
      }
      res.status(202).json({ job: mapJob(retried) });
    } catch (error) {
      if (error instanceof ClaimJobStateError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ error }, "Processing job retry failed");
      res.status(500).json({ error: "Failed to retry processing job" });
    }
  },
);

export default router;
