import {
  and,
  desc,
  eq,
} from "drizzle-orm";
import {
  claims,
  db,
  pool,
  processingJobAttempts,
  processingJobs,
  type ProcessingJob,
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

export async function claimNextJob(
  workerId: string,
  leaseMs = DEFAULT_LEASE_MS,
): Promise<ClaimedJob | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      UPDATE processing_job_attempts a
      SET
        status = 'lease_expired',
        completed_at = now(),
        error_code = 'lease_expired',
        error_message = 'Worker lease expired before completion'
      FROM processing_jobs j
      WHERE j.id = a.job_id
        AND j.status = 'running'
        AND j.lease_expires_at < now()
        AND a.attempt_number = j.attempt_count
        AND a.status = 'running'
    `);

    await client.query(`
      UPDATE processing_jobs
      SET
        status = CASE
          WHEN attempt_count < max_attempts THEN 'queued'::processing_job_state
          ELSE 'failed'::processing_job_state
        END,
        stage = CASE
          WHEN attempt_count < max_attempts THEN 'uploaded'::processing_job_stage
          ELSE 'failed'::processing_job_stage
        END,
        available_at = now(),
        completed_at = CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        heartbeat_at = NULL,
        error_code = 'lease_expired',
        error_message = 'Worker lease expired before completion',
        updated_at = now()
      WHERE status = 'running'
        AND lease_expires_at < now()
    `);

    const selected = await client.query<Record<string, unknown>>(`
      SELECT *
      FROM processing_jobs
      WHERE status = 'queued'
        AND available_at <= now()
        AND attempt_count < max_attempts
      ORDER BY priority ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    const row = selected.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }

    const attemptNumber = Number(row.attempt_count) + 1;
    const updated = await client.query<Record<string, unknown>>(
      `
        UPDATE processing_jobs
        SET
          status = 'running',
          attempt_count = $2,
          lease_owner = $3,
          lease_expires_at = now() + ($4::integer * interval '1 millisecond'),
          heartbeat_at = now(),
          started_at = coalesce(started_at, now()),
          updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [row.id, attemptNumber, workerId, leaseMs],
    );

    await client.query(
      `
        INSERT INTO processing_job_attempts (
          organization_id,
          job_id,
          attempt_number,
          worker_id,
          status
        )
        VALUES ($1, $2, $3, $4, 'running')
      `,
      [row.organization_id, row.id, attemptNumber, workerId],
    );

    await client.query("COMMIT");
    return mapClaimedJob(updated.rows[0]!, workerId);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateJobStage(
  job: Pick<ClaimedJob, "id" | "organizationId" | "leaseOwner">,
  stage: ProcessingJob["stage"],
  progress: number,
  leaseMs = DEFAULT_LEASE_MS,
): Promise<void> {
  const result = await pool.query(
    `
      UPDATE processing_jobs
      SET
        stage = $4,
        progress = $5,
        heartbeat_at = now(),
        lease_expires_at = now() + ($6::integer * interval '1 millisecond'),
        updated_at = now()
      WHERE id = $1
        AND organization_id = $2
        AND lease_owner = $3
        AND status = 'running'
    `,
    [
      job.id,
      job.organizationId,
      job.leaseOwner,
      stage,
      Math.min(Math.max(Math.round(progress), 0), 100),
      leaseMs,
    ],
  );
  if (result.rowCount !== 1) throw new JobLeaseLostError();
}

export async function heartbeatJob(
  job: Pick<ClaimedJob, "id" | "organizationId" | "leaseOwner">,
  leaseMs = DEFAULT_LEASE_MS,
): Promise<void> {
  const result = await pool.query(
    `
      UPDATE processing_jobs
      SET
        heartbeat_at = now(),
        lease_expires_at = now() + ($4::integer * interval '1 millisecond'),
        updated_at = now()
      WHERE id = $1
        AND organization_id = $2
        AND lease_owner = $3
        AND status = 'running'
    `,
    [job.id, job.organizationId, job.leaseOwner, leaseMs],
  );
  if (result.rowCount !== 1) throw new JobLeaseLostError();
}

export async function completeJob(
  job: ClaimedJob,
  outcome: "succeeded" | "degraded",
  metadata?: Record<string, unknown>,
): Promise<void> {
  const stage = outcome === "succeeded" ? "completed" : "degraded";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
        UPDATE processing_jobs
        SET
          status = $4,
          stage = $5,
          progress = 100,
          completed_at = now(),
          lease_owner = NULL,
          lease_expires_at = NULL,
          heartbeat_at = now(),
          error_metadata = coalesce($6::jsonb, error_metadata),
          updated_at = now()
        WHERE id = $1
          AND organization_id = $2
          AND lease_owner = $3
          AND status = 'running'
      `,
      [
        job.id,
        job.organizationId,
        job.leaseOwner,
        outcome,
        stage,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
    if (result.rowCount !== 1) throw new JobLeaseLostError();

    await client.query(
      `
        UPDATE processing_job_attempts
        SET status = $3, completed_at = now()
        WHERE job_id = $1
          AND attempt_number = $2
          AND status = 'running'
      `,
      [job.id, job.attemptCount, outcome],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function failJob(
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ status: ProcessingJob["status"] }>(
      "SELECT status FROM processing_jobs WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [job.id, job.organizationId],
    );
    if (!current.rows[0]) {
      await client.query("COMMIT");
      return "failed";
    }
    if (current.rows[0].status === "cancelled") {
      await client.query(
        `
          UPDATE processing_job_attempts
          SET
            status = 'cancelled',
            completed_at = now(),
            error_code = 'cancelled_by_user',
            error_message = 'Cancelled while processing'
          WHERE job_id = $1 AND attempt_number = $2 AND status = 'running'
        `,
        [job.id, job.attemptCount],
      );
      await client.query("COMMIT");
      return "cancelled";
    }

    const shouldRetry = job.attemptCount < job.maxAttempts;
    const nextStatus = shouldRetry ? "queued" : "failed";
    const delaySeconds = Math.min(60, 2 ** Math.max(job.attemptCount - 1, 0));
    await client.query(
      `
        UPDATE processing_jobs
        SET
          status = $4,
          stage = 'failed',
          progress = CASE WHEN $4 = 'queued' THEN 0 ELSE progress END,
          available_at = now() + ($5::integer * interval '1 second'),
          completed_at = CASE WHEN $4 = 'failed' THEN now() ELSE NULL END,
          lease_owner = NULL,
          lease_expires_at = NULL,
          heartbeat_at = NULL,
          error_code = $6,
          error_message = $7,
          error_metadata = $8::jsonb,
          updated_at = now()
        WHERE id = $1
          AND organization_id = $2
          AND lease_owner = $3
          AND status = 'running'
      `,
      [
        job.id,
        job.organizationId,
        job.leaseOwner,
        nextStatus,
        delaySeconds,
        code,
        message.slice(0, 2000),
        JSON.stringify({ errorName: error instanceof Error ? error.name : "UnknownError" }),
      ],
    );
    await client.query(
      `
        UPDATE processing_job_attempts
        SET
          status = 'failed',
          completed_at = now(),
          error_code = $3,
          error_message = $4,
          error_metadata = $5::jsonb
        WHERE job_id = $1 AND attempt_number = $2 AND status = 'running'
      `,
      [
        job.id,
        job.attemptCount,
        code,
        message.slice(0, 2000),
        JSON.stringify({ retryScheduled: shouldRetry }),
      ],
    );
    await client.query("COMMIT");
    return nextStatus;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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
