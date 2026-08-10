import {
  claimActivity,
  claims,
  db,
  organizationAuditEvents,
  processingJobs,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

export class ClaimArchiveError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
    this.name = "ClaimArchiveError";
  }
}

export interface ArchiveClaimsResult {
  archivedCount: number;
  alreadyArchivedCount: number;
  claimIds: string[];
}

export async function archiveClaims(input: {
  organizationId: string;
  actorUserId: string;
  claimIds: string[];
}): Promise<ArchiveClaimsResult> {
  const claimIds = Array.from(new Set(input.claimIds));

  return db.transaction(async (tx) => {
    const claimRows = await tx
      .select({
        id: claims.id,
        status: claims.status,
        systemStatus: claims.systemStatus,
        currentAuditId: claims.currentAuditId,
      })
      .from(claims)
      .where(
        and(
          eq(claims.organizationId, input.organizationId),
          inArray(claims.id, claimIds),
        ),
      )
      .for("update");

    if (claimRows.length !== claimIds.length) {
      throw new ClaimArchiveError("One or more claims were not found", 404);
    }

    const activeJobs = await tx
      .select({ claimId: processingJobs.claimId })
      .from(processingJobs)
      .where(
        and(
          eq(processingJobs.organizationId, input.organizationId),
          inArray(processingJobs.claimId, claimIds),
          inArray(processingJobs.status, ["queued", "running"]),
        ),
      )
      .limit(1)
      .for("update");

    if (activeJobs.length > 0) {
      throw new ClaimArchiveError(
        "One or more selected claims are still processing. Cancel or wait for processing to finish before deleting them.",
        409,
      );
    }

    const claimsToArchive = claimRows.filter(
      (claim) => claim.status !== "archived" || claim.systemStatus !== "archived",
    );

    if (claimsToArchive.length === 0) {
      return {
        archivedCount: 0,
        alreadyArchivedCount: claimRows.length,
        claimIds,
      };
    }

    const archivedClaimIds = claimsToArchive.map((claim) => claim.id);
    const archivedAt = new Date();

    await tx
      .update(claims)
      .set({
        status: "archived",
        systemStatus: "archived",
        updatedAt: archivedAt,
      })
      .where(
        and(
          eq(claims.organizationId, input.organizationId),
          inArray(claims.id, archivedClaimIds),
        ),
      );

    await tx.insert(claimActivity).values(
      claimsToArchive.map((claim) => ({
        organizationId: input.organizationId,
        claimId: claim.id,
        actorUserId: input.actorUserId,
        activityType: "claim_archived",
        metadata: {
          previousStatus: claim.status,
          previousSystemStatus: claim.systemStatus,
          retainedAuditId: claim.currentAuditId,
          retentionReason: "append_only_audit_provenance",
        },
      })),
    );

    await tx.insert(organizationAuditEvents).values({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType:
        claimsToArchive.length === 1 ? "claim.archived" : "claims.bulk_archived",
      targetType: claimsToArchive.length === 1 ? "claim" : "claim_batch",
      targetId: claimsToArchive.length === 1 ? archivedClaimIds[0] : null,
      metadata: {
        claimIds: archivedClaimIds,
        archivedCount: claimsToArchive.length,
        retentionReason: "append_only_audit_provenance",
      },
    });

    return {
      archivedCount: claimsToArchive.length,
      alreadyArchivedCount: claimRows.length - claimsToArchive.length,
      claimIds,
    };
  });
}
