import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceDatabase } from "@workspace/db";
import {
  assertWorkerJobContext,
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
  JobLeaseLostError,
  updateJobStage,
  WorkerJobContextError,
  type ClaimedJob,
} from "./services/jobQueue";

const job: ClaimedJob = {
  id: "20000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  claimId: "30000000-0000-4000-8000-000000000001",
  documentId: "40000000-0000-4000-8000-000000000001",
  requestedByUserId: "user-1",
  type: "ingest",
  status: "running",
  stage: "uploaded",
  payload: {},
  attemptCount: 1,
  maxAttempts: 3,
  leaseOwner: "worker-1",
};

test("worker database context must match organization, job, and worker", () => {
  assert.doesNotThrow(() =>
    assertWorkerJobContext(job, {
      organizationId: job.organizationId,
      jobId: job.id,
      workerId: job.leaseOwner,
    }),
  );

  for (const settings of [
    {
      organizationId: "10000000-0000-4000-8000-000000000002",
      jobId: job.id,
      workerId: job.leaseOwner,
    },
    {
      organizationId: job.organizationId,
      jobId: "20000000-0000-4000-8000-000000000002",
      workerId: job.leaseOwner,
    },
    {
      organizationId: job.organizationId,
      jobId: job.id,
      workerId: "worker-2",
    },
  ]) {
    assert.throws(
      () => assertWorkerJobContext(job, settings),
      WorkerJobContextError,
    );
  }
});

test("worker control claiming returns the function-bound tenant and lease", async () => {
  let executions = 0;
  const database = {
    async execute() {
      executions += 1;
      return {
        rows: [
          {
            id: job.id,
            organization_id: job.organizationId,
            claim_id: job.claimId,
            document_id: job.documentId,
            requested_by_user_id: job.requestedByUserId,
            type: job.type,
            status: job.status,
            stage: job.stage,
            payload: job.payload,
            attempt_count: job.attemptCount,
            max_attempts: job.maxAttempts,
          },
        ],
      };
    },
  } as unknown as WorkspaceDatabase;

  const claimed = await claimNextJob(database, job.leaseOwner);
  assert.equal(executions, 1);
  assert.equal(claimed?.organizationId, job.organizationId);
  assert.equal(claimed?.leaseOwner, job.leaseOwner);
});

test("a rejected private heartbeat is treated as lease loss", async () => {
  const database = {
    async execute() {
      return { rows: [{ renewed: false }] };
    },
  } as unknown as WorkspaceDatabase;

  await assert.rejects(
    () => heartbeatJob(database, job),
    JobLeaseLostError,
  );
});

test("expired worker leases reject stage, heartbeat, completion, and failure writes", async () => {
  const rejectedHeartbeatDatabase = {
    async execute() {
      return { rows: [{ renewed: false }] };
    },
  } as unknown as WorkspaceDatabase;
  const rejectedCompletionDatabase = {
    async execute() {
      return { rows: [{ completed: false }] };
    },
  } as unknown as WorkspaceDatabase;
  const rejectedFailureDatabase = {
    async execute() {
      return { rows: [{ status: null }] };
    },
  } as unknown as WorkspaceDatabase;

  await assert.rejects(
    () => updateJobStage(rejectedHeartbeatDatabase, job, "auditing", 50),
    JobLeaseLostError,
  );
  await assert.rejects(
    () => heartbeatJob(rejectedHeartbeatDatabase, job),
    JobLeaseLostError,
  );
  await assert.rejects(
    () => completeJob(rejectedCompletionDatabase, job, "succeeded"),
    JobLeaseLostError,
  );
  await assert.rejects(
    () => failJob(rejectedFailureDatabase, job, new Error("late worker")),
    JobLeaseLostError,
  );
});
