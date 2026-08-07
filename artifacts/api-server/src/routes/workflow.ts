import { Router, type IRouter } from "express";
import {
  and,
  desc,
  eq,
  sql,
} from "drizzle-orm";
import {
  auditFindings,
  claimActivity,
  claims,
  db,
  organizationMemberships,
  savedViews,
} from "@workspace/db";
import {
  getAuthorizedClaim,
  getAuthorizedFinding,
} from "../lib/authorization";
import { requireAuth } from "../middlewares/requireAuth";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import logger from "../lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HUMAN_REVIEW_STATES = new Set([
  "unassigned",
  "pending",
  "in_review",
  "approved",
  "changes_requested",
]);
const FINDING_DISPOSITIONS = new Set([
  "open",
  "accepted",
  "dismissed",
  "remediated",
  "overridden",
]);

const router: IRouter = Router();
const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

router.patch(
  "/claims/:id/assignment",
  requireAuth,
  requireOrganizationPermission("claims:assign"),
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

      const assigneeUserId =
        typeof req.body?.assigneeUserId === "string"
          ? req.body.assigneeUserId.trim()
          : req.body?.assigneeUserId === null
            ? null
            : undefined;
      if (assigneeUserId === undefined) {
        res.status(400).json({ error: "assigneeUserId must be a user ID or null" });
        return;
      }
      if (assigneeUserId) {
        const [membership] = await db
          .select({ id: organizationMemberships.id })
          .from(organizationMemberships)
          .where(
            and(
              eq(
                organizationMemberships.organizationId,
                req.organization!.organizationId,
              ),
              eq(organizationMemberships.userId, assigneeUserId),
            ),
          )
          .limit(1);
        if (!membership) {
          res.status(404).json({ error: "Assignee not found" });
          return;
        }
      }

      const [updated] = await db
        .update(claims)
        .set({
          assigneeUserId,
          humanReviewStatus: assigneeUserId ? "pending" : "unassigned",
        })
        .where(
          and(
            eq(claims.id, claimId),
            eq(claims.organizationId, req.organization!.organizationId),
          ),
        )
        .returning({
          assigneeUserId: claims.assigneeUserId,
          humanReviewStatus: claims.humanReviewStatus,
        });
      await db.insert(claimActivity).values({
        organizationId: req.organization!.organizationId,
        claimId,
        actorUserId: req.user!.id,
        activityType: assigneeUserId ? "claim_assigned" : "claim_unassigned",
        metadata: { assigneeUserId },
      });
      res.json(updated);
    } catch (error) {
      logger.error({ error }, "Claim assignment update failed");
      res.status(500).json({ error: "Failed to update claim assignment" });
    }
  },
);

router.patch(
  "/claims/:id/review-status",
  requireAuth,
  requireOrganizationPermission("findings:review"),
  async (req, res) => {
    try {
      const claimId = firstParam(req.params.id);
      const status =
        typeof req.body?.status === "string" ? req.body.status.trim() : "";
      if (!UUID_RE.test(claimId)) {
        res.status(400).json({ error: "Invalid claim ID format" });
        return;
      }
      if (!HUMAN_REVIEW_STATES.has(status)) {
        res.status(400).json({ error: "Invalid human review status" });
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

      const [updated] = await db
        .update(claims)
        .set({
          humanReviewStatus: status as
            | "unassigned"
            | "pending"
            | "in_review"
            | "approved"
            | "changes_requested",
        })
        .where(
          and(
            eq(claims.id, claimId),
            eq(claims.organizationId, req.organization!.organizationId),
          ),
        )
        .returning({ humanReviewStatus: claims.humanReviewStatus });
      await db.insert(claimActivity).values({
        organizationId: req.organization!.organizationId,
        claimId,
        actorUserId: req.user!.id,
        activityType: "human_review_status_changed",
        metadata: {
          previousStatus: claim.humanReviewStatus,
          status,
        },
      });
      res.json(updated);
    } catch (error) {
      logger.error({ error }, "Human review status update failed");
      res.status(500).json({ error: "Failed to update review status" });
    }
  },
);

router.patch(
  "/claims/:id/findings/:findingId",
  requireAuth,
  requireOrganizationPermission("findings:review"),
  async (req, res) => {
    try {
      const claimId = firstParam(req.params.id);
      const findingId = firstParam(req.params.findingId);
      if (!UUID_RE.test(claimId) || !UUID_RE.test(findingId)) {
        res.status(400).json({ error: "Invalid ID format" });
        return;
      }
      const finding = await getAuthorizedFinding(
        req.organization!.organizationId,
        claimId,
        findingId,
      );
      if (!finding) {
        res.status(404).json({ error: "Finding not found" });
        return;
      }

      const disposition =
        typeof req.body?.disposition === "string"
          ? req.body.disposition.trim()
          : finding.disposition;
      const overrideReason =
        typeof req.body?.overrideReason === "string"
          ? req.body.overrideReason.trim()
          : req.body?.overrideReason === null
            ? null
            : finding.overrideReason;
      const reviewNotes =
        typeof req.body?.notes === "string"
          ? req.body.notes.trim()
          : req.body?.notes === null
            ? null
            : finding.reviewNotes;
      if (!FINDING_DISPOSITIONS.has(disposition)) {
        res.status(400).json({ error: "Invalid finding disposition" });
        return;
      }
      if (disposition === "overridden" && !overrideReason) {
        res.status(400).json({
          error: "overrideReason is required when overriding a finding",
        });
        return;
      }

      const [updated] = await db
        .update(auditFindings)
        .set({
          disposition: disposition as
            | "open"
            | "accepted"
            | "dismissed"
            | "remediated"
            | "overridden",
          overrideReason: disposition === "overridden" ? overrideReason : null,
          reviewNotes,
          reviewedByUserId: req.user!.id,
          reviewedAt: new Date(),
        })
        .where(
          and(
            eq(auditFindings.id, findingId),
            eq(
              auditFindings.organizationId,
              req.organization!.organizationId,
            ),
          ),
        )
        .returning({
          id: auditFindings.id,
          disposition: auditFindings.disposition,
          overrideReason: auditFindings.overrideReason,
          reviewNotes: auditFindings.reviewNotes,
          reviewedByUserId: auditFindings.reviewedByUserId,
          reviewedAt: auditFindings.reviewedAt,
        });
      await db.insert(claimActivity).values({
        organizationId: req.organization!.organizationId,
        claimId,
        actorUserId: req.user!.id,
        activityType: "finding_reviewed",
        metadata: {
          findingId,
          previousDisposition: finding.disposition,
          disposition,
          hasNotes: Boolean(reviewNotes),
          hasOverrideReason: Boolean(overrideReason),
        },
      });
      res.json({
        ...updated,
        reviewedAt: updated.reviewedAt?.toISOString() ?? null,
      });
    } catch (error) {
      logger.error({ error }, "Finding review update failed");
      res.status(500).json({ error: "Failed to update finding review" });
    }
  },
);

router.get(
  "/claims/:id/activity",
  requireAuth,
  requireOrganizationPermission("claims:read"),
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
      const limit = Math.min(
        Math.max(Number.parseInt(String(req.query.limit ?? "100"), 10) || 100, 1),
        200,
      );
      const offset = Math.max(
        Number.parseInt(String(req.query.offset ?? "0"), 10) || 0,
        0,
      );
      const activity = await db
        .select()
        .from(claimActivity)
        .where(
          and(
            eq(claimActivity.organizationId, req.organization!.organizationId),
            eq(claimActivity.claimId, claimId),
          ),
        )
        .orderBy(desc(claimActivity.createdAt))
        .limit(limit)
        .offset(offset);
      res.json({
        activity: activity.map((item) => ({
          id: item.id,
          type: item.activityType,
          actorUserId: item.actorUserId,
          metadata: item.metadata,
          createdAt: item.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      logger.error({ error }, "Claim activity lookup failed");
      res.status(500).json({ error: "Failed to load claim activity" });
    }
  },
);

router.get(
  "/saved-views",
  requireAuth,
  requireOrganizationPermission("views:manage"),
  async (req, res) => {
    try {
      const resourceType =
        typeof req.query.resourceType === "string"
          ? req.query.resourceType
          : "claims";
      const views = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.organizationId, req.organization!.organizationId),
            eq(savedViews.userId, req.user!.id),
            eq(savedViews.resourceType, resourceType),
          ),
        )
        .orderBy(desc(savedViews.isDefault), savedViews.name);
      res.json({ views });
    } catch (error) {
      logger.error({ error }, "Saved views lookup failed");
      res.status(500).json({ error: "Failed to load saved views" });
    }
  },
);

router.post(
  "/saved-views",
  requireAuth,
  requireOrganizationPermission("views:manage"),
  async (req, res) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const resourceType =
        typeof req.body?.resourceType === "string"
          ? req.body.resourceType.trim()
          : "claims";
      const filters =
        req.body?.filters && typeof req.body.filters === "object"
          ? req.body.filters
          : {};
      const sort =
        req.body?.sort && typeof req.body.sort === "object" ? req.body.sort : {};
      const columns = Array.isArray(req.body?.columns)
        ? req.body.columns.filter((value: unknown) => typeof value === "string")
        : null;
      const isDefault = req.body?.isDefault === true;
      if (!name || name.length > 100) {
        res.status(400).json({ error: "name is required and must be 100 characters or fewer" });
        return;
      }

      const view = await db.transaction(async (tx) => {
        if (isDefault) {
          await tx
            .update(savedViews)
            .set({ isDefault: false })
            .where(
              and(
                eq(savedViews.organizationId, req.organization!.organizationId),
                eq(savedViews.userId, req.user!.id),
                eq(savedViews.resourceType, resourceType),
              ),
            );
        }
        const [created] = await tx
          .insert(savedViews)
          .values({
            organizationId: req.organization!.organizationId,
            userId: req.user!.id,
            name,
            resourceType,
            filters,
            sort,
            columns,
            isDefault,
          })
          .returning();
        return created;
      });
      res.status(201).json(view);
    } catch (error) {
      logger.error({ error }, "Saved view creation failed");
      res.status(500).json({ error: "Failed to create saved view" });
    }
  },
);

router.put(
  "/saved-views/:viewId",
  requireAuth,
  requireOrganizationPermission("views:manage"),
  async (req, res) => {
    try {
      const viewId = firstParam(req.params.viewId);
      if (!UUID_RE.test(viewId)) {
        res.status(400).json({ error: "Invalid saved view ID format" });
        return;
      }
      const [existing] = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.id, viewId),
            eq(savedViews.organizationId, req.organization!.organizationId),
            eq(savedViews.userId, req.user!.id),
          ),
        )
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Saved view not found" });
        return;
      }
      const name =
        typeof req.body?.name === "string" ? req.body.name.trim() : existing.name;
      if (!name || name.length > 100) {
        res.status(400).json({ error: "Invalid saved view name" });
        return;
      }
      const isDefault =
        typeof req.body?.isDefault === "boolean"
          ? req.body.isDefault
          : existing.isDefault;
      const updated = await db.transaction(async (tx) => {
        if (isDefault) {
          await tx
            .update(savedViews)
            .set({ isDefault: false })
            .where(
              and(
                eq(savedViews.organizationId, req.organization!.organizationId),
                eq(savedViews.userId, req.user!.id),
                eq(savedViews.resourceType, existing.resourceType),
                sql`${savedViews.id} <> ${viewId}`,
              ),
            );
        }
        const [view] = await tx
          .update(savedViews)
          .set({
            name,
            filters:
              req.body?.filters && typeof req.body.filters === "object"
                ? req.body.filters
                : existing.filters,
            sort:
              req.body?.sort && typeof req.body.sort === "object"
                ? req.body.sort
                : existing.sort,
            columns: Array.isArray(req.body?.columns)
              ? req.body.columns.filter(
                  (value: unknown) => typeof value === "string",
                )
              : existing.columns,
            isDefault,
          })
          .where(
            and(
              eq(savedViews.id, viewId),
              eq(savedViews.organizationId, req.organization!.organizationId),
              eq(savedViews.userId, req.user!.id),
            ),
          )
          .returning();
        return view;
      });
      res.json(updated);
    } catch (error) {
      logger.error({ error }, "Saved view update failed");
      res.status(500).json({ error: "Failed to update saved view" });
    }
  },
);

router.delete(
  "/saved-views/:viewId",
  requireAuth,
  requireOrganizationPermission("views:manage"),
  async (req, res) => {
    try {
      const viewId = firstParam(req.params.viewId);
      if (!UUID_RE.test(viewId)) {
        res.status(400).json({ error: "Invalid saved view ID format" });
        return;
      }
      const [deleted] = await db
        .delete(savedViews)
        .where(
          and(
            eq(savedViews.id, viewId),
            eq(savedViews.organizationId, req.organization!.organizationId),
            eq(savedViews.userId, req.user!.id),
          ),
        )
        .returning({ id: savedViews.id });
      if (!deleted) {
        res.status(404).json({ error: "Saved view not found" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      logger.error({ error }, "Saved view deletion failed");
      res.status(500).json({ error: "Failed to delete saved view" });
    }
  },
);

export default router;
