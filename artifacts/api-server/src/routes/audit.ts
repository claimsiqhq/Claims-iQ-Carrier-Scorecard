import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import {
  claimActivity,
  claims,
  db,
  documents,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  buildJobIdempotencyKey,
  enqueueProcessingJob,
} from "../services/jobQueue";
import { getAuthorizedClaim } from "../lib/authorization";
import { requireAuth } from "../middlewares/requireAuth";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import logger from "../lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const auditLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Audit rate limit exceeded. Try again later." },
});

const router: IRouter = Router();
const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

router.post(
  "/claims/:id/audit",
  requireAuth,
  requireOrganizationPermission("audits:run"),
  auditLimiter,
  async (req, res) => {
  try {
    const id = firstParam(req.params.id);

    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid claim ID format" });
      return;
    }

    const claim = await getAuthorizedClaim(req.organization!.organizationId, id);
    if (!claim) {
      res.status(404).json({ error: "Claim not found" });
      return;
    }

    const [document] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, req.organization!.organizationId),
          eq(documents.claimId, id),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(1);
    const callerKey =
      typeof req.headers["x-idempotency-key"] === "string"
        ? req.headers["x-idempotency-key"].trim()
        : null;
    const idempotencyKey = buildJobIdempotencyKey({
      organizationId: req.organization!.organizationId,
      type: "audit",
      claimId: id,
      documentId: document?.id,
      callerKey: callerKey || `audit:${claim.currentAuditId ?? "none"}`,
    });
    const queued = await enqueueProcessingJob({
      organizationId: req.organization!.organizationId,
      claimId: id,
      documentId: document?.id,
      requestedByUserId: req.user!.id,
      type: "audit",
      idempotencyKey,
    });
    if (queued.created) {
      await db.transaction(async (tx) => {
        await tx
          .update(claims)
          .set({ status: "processing", systemStatus: "processing", aiStatus: "queued" })
          .where(
            and(
              eq(claims.id, id),
              eq(claims.organizationId, req.organization!.organizationId),
            ),
          );
        await tx.insert(claimActivity).values({
          organizationId: req.organization!.organizationId,
          claimId: id,
          actorUserId: req.user!.id,
          activityType: "audit_queued",
          metadata: { processingJobId: queued.job.id },
        });
      });
    }

    res.status(202).json({
      job: {
        id: queued.job.id,
        claimId: id,
        status: queued.job.status,
        stage: queued.job.stage,
        progress: queued.job.progress,
      },
      duplicate: !queued.created,
    });
  } catch (err) {
    logger.error({ err }, "Error running audit");
    res.status(500).json({ error: "Failed to run audit" });
  }
  },
);

export default router;
