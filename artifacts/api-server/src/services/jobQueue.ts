import {
  and,
  desc,
  eq,
  sql,
} from "drizzle-orm";
import {
  claims,
  db,
  processingJobAttempts,
  processingJobs,
  type DatabaseSessionSettings,
  type ProcessingJob,
  type WorkspaceDatabase,
} from "@workspace/db";
import {
  buildJobIdempotencyKey,
  isTerminalJobState,
} from "./jobPolicy";

export {
  buildJobIdempotencyKey,
  isTerminalJobState,
} from "./jobPolicy";

const DEFAULT_LEASE_MS = 90_000;

export type EnqueueJobInput = {
  organizationId: string;
  claimId?: string | null;
  documentId?: string | null;
  requestedByUserId?: string | null;
  type: ProcessingJob["type"];
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  priority?: number;
};

export interface EnqueueJobResult {
  job: ProcessingJob;
  created: boolean;
}

export interface ClaimedJob {
  id: string;
  organizationId: string;
  claimId: string | null;
  documentId: string | null;
  requestedByUserId: string | null;
  type: ProcessingJob["type"];
  status: ProcessingJob["status"];
  stage: ProcessingJob["stage"];
  payload: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string;
}

export class JobLeaseLostError extends Error {
  constructor(message = "Processing job lease was lost or cancelled") {
    super(message);
    this.name = "JobLeaseLostError";
  }
}

export class WorkerJobContextError extends Error {
  readonly code = "worker_job_context_invalid";

  constructor(message = "Worker database context does not match the claimed job") {
    super(message);
    this.name = "WorkerJobContextError";
  }
}

export function assertWorkerJobContext(
  job: Pick<ClaimedJob, "id" | "organizationId" | "leaseOwner">,
  settings: DatabaseSessionSettings,
): void {
  if (
    settings.jobId !== job.id ||
    settings.organizationId !== job.organizationId ||
    settings.workerId !== job.leaseOwner
  ) {
    throw new WorkerJobContextError();
  }
}

export class ClaimJobStateError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
    this.name = "ClaimJobStateError";
  }
}

export async function enqueueProcessingJob(
  input: EnqueueJobInput,
): Promise<EnqueueJobResult> {
  return db.transaction(async (tx) => {
    if (input.claimId) {
      const [claim] = await tx
        .select({
          status: claims.status,
          systemStatus: claims.systemStatus,
        })
        .from(claims)
        .where(
          and(
            eq(claims.id, input.claimId),
            eq(claims.organizationId, input.organizationId),
          ),
        )
        .limit(1)
        .for("key share");
      if (!claim) {
        throw new ClaimJobStateError("Claim not found", 404);
      }
      if (claim.status === "archived" || claim.systemStatus === "archived") {
        throw new ClaimJobStateError(
          "Archived claims cannot start new processing",
          409,
        );
      }
    }

    const [inserted] = await tx
      .insert(processingJobs)
      .values({
        organizationId: input.organizationId,
        claimId: input.claimId ?? null,
        documentId: input.documentId ?? null,
        requestedByUserId: input.requestedByUserId ?? null,
        type: input.type,
        status: "queued",
        stage: "uploaded",
        progress: 0,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload ?? {},
        maxAttempts: input.maxAttempts ?? 3,
        priority: input.priority ?? 100,
      })
      .onConflictDoNothing({
        target: [processingJobs.organizationId, processingJobs.idempotencyKey],
      })
      .returning();

    if (inserted) return { job: inserted, created: true };

    const [existing] = await tx
      .select()
      .from(processingJobs)
      .where(
        and(
          eq(processingJobs.organizationId, input.organizationId),
          eq(processingJobs.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error("Idempotent job lookup failed after conflict");
    }
    return { job: existing, created: false };
  });
}

export async function getOrganizationJob(
  organizationId: string,
  jobId: string,
) {
  const [job] = await db
    .select()
    .from(processingJobs)
    .where(
      and(
        eq(processingJobs.id, jobId),
        eq(processingJobs.organizationId, organizationId),
      ),
    )
    .limit(1);
  return job;
}

export async function listClaimJobs(
  organizationId: string,
  claimId: string,
  limit = 20,
) {
  return db
    .select()
    .from(processingJobs)
    .where(
      and(
        eq(processingJobs.organizationId, organizationId),
        eq(processingJobs.claimId, claimId),
      ),
    )
    .orderBy(desc(processingJobs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function cancelOrganizationJob(
  organizationId: string,
  jobId: string,
): Promise<ProcessingJob | null> {
  const [job] = await db
    .update(processingJobs)
    .set({
      status: "cancelled",
      stage: "cancelled",
      cancelledAt: new Date(),
      completedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      errorCode: "cancelled_by_user",
      errorMessage: "Cancelled by an authorized user",
    })
    .where(
      and(
        eq(processingJobs.id, jobId),
        eq(processingJobs.organizationId, organizationId),
        eq(processingJobs.status, "queued"),
      ),
    )
    .returning();

  if (job) return job;

  const [running] = await db
    .update(processingJobs)
    .set({
      status: "cancelled",
      stage: "cancelled",
      cancelledAt: new Date(),
      completedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      errorCode: "cancelled_by_user",
      errorMessage: "Cancelled by an authorized user",
    })
    .where(
      and(
        eq(processingJobs.id, jobId),
        eq(processingJobs.organizationId, organizationId),
        eq(processingJobs.status, "running"),
      ),
    )
    .returning();

  return running ?? null;
}

export async function retryOrganizationJob(
  organizationId: string,
  jobId: string,
): Promise<ProcessingJob | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(processingJobs)
      .where(
        and(
          eq(processingJobs.id, jobId),
          eq(processingJobs.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!existing || !isTerminalJobState(existing.status) || existing.status === "succeeded") {
      return null;
    }

    if (existing.claimId) {
      const [claim] = await tx
        .select({
          status: claims.status,
          systemStatus: claims.systemStatus,
        })
        .from(claims)
        .where(
          and(
            eq(claims.id, existing.claimId),
            eq(claims.organizationId, organizationId),
          ),
        )
        .limit(1)
        .for("key share");
      if (!claim) {
        throw new ClaimJobStateError("Claim not found", 404);
      }
      if (claim.status === "archived" || claim.systemStatus === "archived") {
        throw new ClaimJobStateError(
          "Archived claims cannot restart processing",
          409,
        );
      }
    }

    const [job] = await tx
      .update(processingJobs)
      .set({
        status: "queued",
        stage: "uploaded",
        progress: 0,
        availableAt: new Date(),
        completedAt: null,
        cancelledAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        errorCode: null,
        errorMessage: null,
        errorMetadata: null,
        maxAttempts: Math.max(existing.maxAttempts, existing.attemptCount + 1),
      })
      .where(
        and(
          eq(processingJobs.id, jobId),
          eq(processingJobs.organizationId, organizationId),
          eq(processingJobs.status, existing.status),
        ),
      )
      .returning();
    return job ?? null;
  });
}

function mapClaimedJob(row: Record<string, unknown>, workerId: string): ClaimedJob {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    claimId: row.claim_id ? String(row.claim_id) : null,
    documentId: row.document_id ? String(row.document_id) : null,
    requestedByUserId: row.requested_by_user_id
      ? String(row.requested_by_user_id)
      : null,
    type: row.type as ClaimedJob["type"],
    status: row.status as ClaimedJob["status"],
    stage: row.stage as ClaimedJob["stage"],
    payload: (row.payload as Record<string, unknown> | null) ?? {},
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    leaseOwner: workerId,
  };
}

function rowsFromResult<Row>(result: unknown): Row[] {
  const rows = (result as { rows?: Row[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

export async function claimNextJob(
  controlDatabase: WorkspaceDatabase,
  workerId: string,
  leaseMs = DEFAULT_LEASE_MS,
): Promise<ClaimedJob | null> {
  const result = await controlDatabase.execute(sql`
    SELECT *
    FROM private.claim_processing_job(${leaseMs}::integer)
  `);
  const row = rowsFromResult<Record<string, unknown>>(result)[0];
  return row ? mapClaimedJob(row, workerId) : null;
}

export async function updateJobStage(
  jobDatabase: WorkspaceDatabase,
  job: Pick<ClaimedJob, "id" | "organizationId" | "leaseOwner">,
  stage: ProcessingJob["stage"],
  progress: number,
  leaseMs = DEFAULT_LEASE_MS,
): Promise<void> {
  const result = await jobDatabase.execute(sql`
    SELECT private.heartbeat_processing_job(
      ${leaseMs}::integer,
      ${stage}::public.processing_job_stage,
      ${Math.min(Math.max(Math.round(progress), 0), 100)}::integer
    ) AS renewed
  `);
  if (!rowsFromResult<{ renewed: boolean }>(result)[0]?.renewed) {
    throw new JobLeaseLostError();
  }
}

export async function heartbeatJob(
  jobDatabase: WorkspaceDatabase,
  job: Pick<ClaimedJob, "id" | "organizationId" | "leaseOwner">,
  leaseMs = DEFAULT_LEASE_MS,
): Promise<void> {
  const result = await jobDatabase.execute(sql`
    SELECT private.heartbeat_processing_job(
      ${leaseMs}::integer,
      NULL::public.processing_job_stage,
      NULL::integer
    ) AS renewed
  `);
  if (!rowsFromResult<{ renewed: boolean }>(result)[0]?.renewed) {
    throw new JobLeaseLostError();
  }
}

export async function completeJob(
  jobDatabase: WorkspaceDatabase,
  job: ClaimedJob,
  outcome: "succeeded" | "degraded",
  metadata?: Record<string, unknown>,
): Promise<void> {
  const result = await jobDatabase.execute(sql`
    SELECT private.complete_processing_job(
      ${outcome}::public.processing_job_state,
      ${metadata ? JSON.stringify(metadata) : null}::jsonb
    ) AS completed
  `);
  if (!rowsFromResult<{ completed: boolean }>(result)[0]?.completed) {
    throw new JobLeaseLostError();
  }
}

export async function failJob(
  jobDatabase: WorkspaceDatabase,
  job: ClaimedJob,
  error: unknown,
): Promise<"queued" | "failed" | "cancelled"> {
  const message = error instanceof Error ? error.message : "Processing failed";
  const code =
    error instanceof JobLeaseLostError
      ? "lease_lost"
      : error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "processing_failed";
  const result = await jobDatabase.execute(sql`
    SELECT private.fail_processing_job(
      ${code},
      ${message.slice(0, 2000)},
      ${JSON.stringify({
        errorName: error instanceof Error ? error.name : "UnknownError",
        retryScheduled: job.attemptCount < job.maxAttempts,
      })}::jsonb
    )::text AS status
  `);
  const status = rowsFromResult<{
    status: "queued" | "failed" | "cancelled" | null;
  }>(result)[0]?.status;
  if (!status) throw new JobLeaseLostError();
  return status;
}

export async function listJobAttempts(
  organizationId: string,
  jobId: string,
) {
  return db
    .select()
    .from(processingJobAttempts)
    .where(
      and(
        eq(processingJobAttempts.organizationId, organizationId),
        eq(processingJobAttempts.jobId, jobId),
      ),
    )
    .orderBy(desc(processingJobAttempts.attemptNumber));
}
