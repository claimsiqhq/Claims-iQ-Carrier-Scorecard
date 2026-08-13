import { createHash } from "node:crypto";

export type DurableJobType =
  | "ingest"
  | "audit"
  | "retry"
  | "reprocess"
  | "extract"
  | "rendition";
export type DurableJobState =
  | "queued"
  | "running"
  | "succeeded"
  | "degraded"
  | "failed"
  | "cancelled";

export function buildJobIdempotencyKey(input: {
  organizationId: string;
  type: DurableJobType;
  claimId?: string | null;
  documentId?: string | null;
  sourceHash?: string | null;
  carrierEntityId?: string | null;
  callerKey?: string | null;
}): string {
  const canonical = JSON.stringify({
    organizationId: input.organizationId,
    type: input.type,
    claimId: input.claimId ?? null,
    documentId: input.documentId ?? null,
    sourceHash: input.sourceHash ?? null,
    carrierEntityId: input.carrierEntityId?.trim().toLowerCase() ?? null,
    callerKey: input.callerKey?.trim() ?? null,
  });
  return `${input.type}:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function isTerminalJobState(status: DurableJobState): boolean {
  return ["succeeded", "degraded", "failed", "cancelled"].includes(status);
}
