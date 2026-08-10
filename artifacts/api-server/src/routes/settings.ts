import { Router, type IRouter } from "express";
import {
  db,
  organizationAuditEvents,
  organizationInvitations,
  organizationMemberships,
  organizationSettings,
  promptSettings,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { SYSTEM_PROMPT as DEFAULT_SYSTEM, USER_PROMPT_TEMPLATE as DEFAULT_USER } from "../services/prompts";
import logger from "../lib/logger";
import { requireAuth } from "../middlewares/requireAuth";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import { env } from "../env";
import { SESSION_TTL } from "../lib/auth";

const router: IRouter = Router();

router.get(
  "/settings/overview",
  requireAuth,
  requireOrganizationPermission("settings:manage"),
  async (req, res) => {
    const organizationId = req.organization!.organizationId;
    try {
      const [members, invitations, settingsRows, events] = await Promise.all([
        db
          .select({
            membershipId: organizationMemberships.id,
            userId: organizationMemberships.userId,
            role: organizationMemberships.role,
            firstName: usersTable.firstName,
            lastName: usersTable.lastName,
            email: usersTable.email,
            joinedAt: organizationMemberships.joinedAt,
          })
          .from(organizationMemberships)
          .innerJoin(usersTable, eq(usersTable.id, organizationMemberships.userId))
          .where(eq(organizationMemberships.organizationId, organizationId))
          .orderBy(organizationMemberships.joinedAt),
        db
          .select({
            id: organizationInvitations.id,
            email: organizationInvitations.email,
            role: organizationInvitations.role,
            expiresAt: organizationInvitations.expiresAt,
            lastSentAt: organizationInvitations.lastSentAt,
            sendCount: organizationInvitations.sendCount,
            createdAt: organizationInvitations.createdAt,
          })
          .from(organizationInvitations)
          .where(
            and(
              eq(organizationInvitations.organizationId, organizationId),
              sql`${organizationInvitations.acceptedAt} is null`,
              sql`${organizationInvitations.revokedAt} is null`,
            ),
          )
          .orderBy(desc(organizationInvitations.createdAt)),
        db
          .select()
          .from(organizationSettings)
          .where(eq(organizationSettings.organizationId, organizationId))
          .limit(1),
        db
          .select({
            id: organizationAuditEvents.id,
            eventType: organizationAuditEvents.eventType,
            targetType: organizationAuditEvents.targetType,
            targetId: organizationAuditEvents.targetId,
            metadata: organizationAuditEvents.metadata,
            createdAt: organizationAuditEvents.createdAt,
            actorFirstName: usersTable.firstName,
            actorLastName: usersTable.lastName,
          })
          .from(organizationAuditEvents)
          .leftJoin(usersTable, eq(usersTable.id, organizationAuditEvents.actorUserId))
          .where(eq(organizationAuditEvents.organizationId, organizationId))
          .orderBy(desc(organizationAuditEvents.createdAt))
          .limit(30),
      ]);

      const settings = settingsRows[0];
      res.json({
        members: members.map((member) => ({
          ...member,
          joinedAt: member.joinedAt.toISOString(),
        })),
        invitations: invitations.map((invitation) => ({
          ...invitation,
          expiresAt: invitation.expiresAt.toISOString(),
          lastSentAt: invitation.lastSentAt?.toISOString() ?? null,
          createdAt: invitation.createdAt.toISOString(),
          status: invitation.expiresAt > new Date() ? "pending" : "expired",
        })),
        integrations: {
          ai: {
            configured: Boolean(process.env.GEMINI_API_KEY),
            modelIdentifier: env.GEMINI_MODEL,
          },
          storage: {
            configured: Boolean(
              process.env.SUPABASE_DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE,
            ),
          },
          email: {
            configured: Boolean(
              process.env.SENDGRID_API_KEY
              && process.env.SENDGRID_FROM_EMAIL,
            ),
          },
        },
        security: {
          sessionTtlDays: Math.round(SESSION_TTL / (24 * 60 * 60 * 1000)),
          cookieHttpOnly: true,
          sameSite: "lax",
          mfaReady: false,
          ssoReady: false,
        },
        organizationSettings: {
          inAppNotificationsEnabled: settings?.inAppNotificationsEnabled ?? true,
          emailNotificationsEnabled: settings?.emailNotificationsEnabled ?? false,
          retentionDays: settings?.retentionDays ?? null,
          purgeMode: settings?.purgeMode ?? "manual",
          updatedAt: settings?.updatedAt?.toISOString() ?? null,
        },
        auditHistory: events.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          targetType: event.targetType,
          targetId: event.targetId,
          metadata: event.metadata,
          actorName:
            [event.actorFirstName, event.actorLastName].filter(Boolean).join(" ")
            || "System",
          createdAt: event.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      logger.error({ err }, "Error fetching settings overview");
      res.status(500).json({ error: "Failed to fetch settings overview" });
    }
  },
);

router.put(
  "/settings/organization",
  requireAuth,
  requireOrganizationPermission("settings:manage"),
  async (req, res) => {
    const {
      inAppNotificationsEnabled,
      emailNotificationsEnabled,
      retentionDays,
      purgeMode,
    } = req.body;
    if (
      typeof inAppNotificationsEnabled !== "boolean"
      || typeof emailNotificationsEnabled !== "boolean"
      || !["manual", "scheduled"].includes(purgeMode)
      || (
        retentionDays !== null
        && (
          !Number.isInteger(retentionDays)
          || retentionDays < 30
          || retentionDays > 3650
        )
      )
    ) {
      res.status(400).json({ error: "Invalid organization settings" });
      return;
    }

    const organizationId = req.organization!.organizationId;
    try {
      const [settings] = await db.transaction(async (tx) => {
        const rows = await tx
          .insert(organizationSettings)
          .values({
            organizationId,
            inAppNotificationsEnabled,
            emailNotificationsEnabled,
            retentionDays,
            purgeMode,
            updatedByUserId: req.user!.id,
          })
          .onConflictDoUpdate({
            target: organizationSettings.organizationId,
            set: {
              inAppNotificationsEnabled,
              emailNotificationsEnabled,
              retentionDays,
              purgeMode,
              updatedByUserId: req.user!.id,
              updatedAt: new Date(),
            },
          })
          .returning();
        await tx.insert(organizationAuditEvents).values({
          organizationId,
          actorUserId: req.user!.id,
          eventType: "organization_settings.updated",
          targetType: "organization_settings",
          targetId: organizationId,
          metadata: {
            inAppNotificationsEnabled,
            emailNotificationsEnabled,
            retentionDays,
            purgeMode,
          },
        });
        return rows;
      });
      res.json({
        inAppNotificationsEnabled: settings.inAppNotificationsEnabled,
        emailNotificationsEnabled: settings.emailNotificationsEnabled,
        retentionDays: settings.retentionDays,
        purgeMode: settings.purgeMode,
        updatedAt: settings.updatedAt.toISOString(),
      });
    } catch (err) {
      logger.error({ err }, "Error saving organization settings");
      res.status(500).json({ error: "Failed to save organization settings" });
    }
  },
);

router.patch(
  "/settings/members/:membershipId",
  requireAuth,
  requireOrganizationPermission("settings:manage"),
  async (req, res) => {
    const membershipId = String(req.params.membershipId || "");
    const role = String(req.body?.role || "");
    const roles = ["owner", "admin", "auditor", "reviewer", "member", "viewer"] as const;
    if (!roles.includes(role as (typeof roles)[number])) {
      res.status(400).json({ error: "Invalid organization role" });
      return;
    }

    const organization = req.organization!;
    const [target] = await db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.id, membershipId),
          eq(organizationMemberships.organizationId, organization.organizationId),
        ),
      )
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Organization member not found" });
      return;
    }
    if (
      organization.role !== "owner"
      && (target.role === "owner" || role === "owner" || role === "admin")
    ) {
      res.status(403).json({ error: "Only an organization owner can manage privileged roles" });
      return;
    }
    if (target.role === "owner" && role !== "owner") {
      const [ownerCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organization.organizationId),
            eq(organizationMemberships.role, "owner"),
          ),
        );
      if (ownerCount.count <= 1) {
        res.status(409).json({ error: "The last organization owner cannot be demoted" });
        return;
      }
    }

    try {
      const [updated] = await db.transaction(async (tx) => {
        const rows = await tx
          .update(organizationMemberships)
          .set({ role: role as (typeof roles)[number], updatedAt: new Date() })
          .where(
            and(
              eq(organizationMemberships.id, membershipId),
              eq(organizationMemberships.organizationId, organization.organizationId),
            ),
          )
          .returning();
        await tx.insert(organizationAuditEvents).values({
          organizationId: organization.organizationId,
          actorUserId: req.user!.id,
          eventType: "membership.role_updated",
          targetType: "organization_membership",
          targetId: membershipId,
          metadata: {
            userId: target.userId,
            previousRole: target.role,
            nextRole: role,
          },
        });
        return rows;
      });
      res.json({
        membershipId: updated.id,
        userId: updated.userId,
        role: updated.role,
      });
    } catch (err) {
      logger.error({ err }, "Error updating member role");
      res.status(500).json({ error: "Failed to update member role" });
    }
  },
);

router.get(
  "/settings/prompts",
  requireAuth,
  requireOrganizationPermission("settings:manage"),
  async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(promptSettings)
      .where(eq(promptSettings.organizationId, req.organization!.organizationId));

    const systemRow = rows.find((r) => r.key === "system_prompt");
    const userRow = rows.find((r) => r.key === "user_prompt_template");

    res.json({
      system_prompt: systemRow?.value ?? DEFAULT_SYSTEM,
      user_prompt_template: userRow?.value ?? DEFAULT_USER,
      model_identifier: env.GEMINI_MODEL,
      updated_at:
        [systemRow?.updatedAt, userRow?.updatedAt]
          .filter((value): value is Date => value instanceof Date)
          .sort((left, right) => right.getTime() - left.getTime())[0]
          ?.toISOString() ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching prompt settings");
    res.status(500).json({ error: "Failed to fetch settings" });
  }
  },
);

router.put(
  "/settings/prompts",
  requireAuth,
  requireOrganizationPermission("settings:manage"),
  async (req, res) => {
  try {
    const { system_prompt, user_prompt_template } = req.body;

    if (typeof system_prompt !== "string" || typeof user_prompt_template !== "string") {
      res.status(400).json({ error: "Both system_prompt and user_prompt_template are required" });
      return;
    }

    if (system_prompt.trim().length === 0 || user_prompt_template.trim().length === 0) {
      res.status(400).json({ error: "Prompts cannot be empty" });
      return;
    }

    const missingPlaceholders = [
      "{{DA_QUESTIONS}}",
      "{{FA_QUESTIONS}}",
      "{{REPORT}}",
    ].filter((placeholder) => !user_prompt_template.includes(placeholder));
    if (missingPlaceholders.length > 0) {
      res.status(400).json({
        error: `User prompt is missing required placeholders: ${missingPlaceholders.join(", ")}`,
      });
      return;
    }

    if (system_prompt.length > 100_000 || user_prompt_template.length > 200_000) {
      res.status(413).json({ error: "Prompt configuration is too large" });
      return;
    }

    const organizationId = req.organization!.organizationId;
    await db.transaction(async (tx) => {
      for (const { key, value } of [
        { key: "system_prompt", value: system_prompt.trim() },
        { key: "user_prompt_template", value: user_prompt_template.trim() },
      ]) {
        await tx
          .insert(promptSettings)
          .values({ organizationId, key, value })
          .onConflictDoUpdate({
            target: [promptSettings.organizationId, promptSettings.key],
            set: { value, updatedAt: new Date() },
          });
      }
      await tx.insert(organizationAuditEvents).values({
        organizationId,
        actorUserId: req.user!.id,
        eventType: "prompt_settings.updated",
        targetType: "prompt_settings",
        metadata: {
          modelIdentifier: env.GEMINI_MODEL,
          systemPromptLength: system_prompt.trim().length,
          userPromptLength: user_prompt_template.trim().length,
        },
      });
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Error saving prompt settings");
    res.status(500).json({ error: "Failed to save settings" });
  }
  },
);

router.post(
  "/settings/prompts/reset",
  requireAuth,
  requireOrganizationPermission("settings:manage"),
  async (req, res) => {
  try {
    const organizationId = req.organization!.organizationId;
    await db.transaction(async (tx) => {
      await tx
        .delete(promptSettings)
        .where(
          and(
            eq(promptSettings.organizationId, organizationId),
            eq(promptSettings.key, "system_prompt"),
          ),
        );
      await tx
        .delete(promptSettings)
        .where(
          and(
            eq(promptSettings.organizationId, organizationId),
            eq(promptSettings.key, "user_prompt_template"),
          ),
        );
      await tx.insert(organizationAuditEvents).values({
        organizationId,
        actorUserId: req.user!.id,
        eventType: "prompt_settings.reset",
        targetType: "prompt_settings",
      });
    });

    res.json({
      success: true,
      system_prompt: DEFAULT_SYSTEM,
      user_prompt_template: DEFAULT_USER,
    });
  } catch (err) {
    logger.error({ err }, "Error resetting prompt settings");
    res.status(500).json({ error: "Failed to reset settings" });
  }
  },
);

export default router;
