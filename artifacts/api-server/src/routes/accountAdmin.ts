import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import {
  db,
  organizationAuditEvents,
  organizationInvitations,
  organizationMemberships,
  organizations,
  usersTable,
  type OrganizationRole,
} from "@workspace/db";
import {
  and,
  eq,
  isNull,
  sql,
} from "drizzle-orm";
import { env } from "../env";
import {
  createAccountToken,
  normalizeEmail,
} from "../lib/accountSecurity";
import logger from "../lib/logger";
import { requireAuth } from "../middlewares/requireAuth";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import { issuePasswordReset } from "../services/accountAccess";
import { sendInvitationEmail } from "../services/accountEmails";

const router: IRouter = Router();
const roles = [
  "owner",
  "admin",
  "auditor",
  "reviewer",
  "member",
  "viewer",
] as const satisfies readonly OrganizationRole[];

const accountAdminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many account administration actions. Try again later." },
});

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function canAssignRole(currentRole: string, role: OrganizationRole): boolean {
  return currentRole === "owner" || !["owner", "admin"].includes(role);
}

function emailIsConfigured(): boolean {
  return Boolean(
    process.env.SENDGRID_API_KEY
    && process.env.SENDGRID_FROM_EMAIL,
  );
}

router.post(
  "/settings/invitations",
  requireAuth,
  requireOrganizationPermission("settings:manage"),
  accountAdminLimiter,
  async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const role = String(req.body?.role || "viewer") as OrganizationRole;
    const organization = req.organization!;
    if (!isValidEmail(email) || !roles.includes(role)) {
      res.status(400).json({ error: "A valid email and organization role are required" });
      return;
    }
    if (!canAssignRole(organization.role, role)) {
      res.status(403).json({ error: "Only an organization owner can invite privileged roles" });
      return;
    }
    if (!emailIsConfigured()) {
      res.status(503).json({ error: "Outbound email is not configured" });
      return;
    }

    try {
      const [existingMembership] = await db
        .select({ id: organizationMemberships.id })
        .from(organizationMemberships)
        .innerJoin(usersTable, eq(usersTable.id, organizationMemberships.userId))
        .where(
          and(
            eq(
              organizationMemberships.organizationId,
              organization.organizationId,
            ),
            sql`lower(${usersTable.email}) = ${email}`,
          ),
        )
        .limit(1);
      if (existingMembership) {
        res.status(409).json({ error: "That user already belongs to this organization" });
        return;
      }

      const token = createAccountToken();
      const expiresAt = new Date(
        Date.now() + env.INVITATION_TTL_HOURS * 60 * 60 * 1000,
      );
      const issuance = await db.transaction(async (tx) => {
        await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, organization.organizationId))
          .for("update")
          .limit(1);
        const [pending] = await tx
          .select()
          .from(organizationInvitations)
          .where(
            and(
              eq(
                organizationInvitations.organizationId,
                organization.organizationId,
              ),
              eq(organizationInvitations.email, email),
              isNull(organizationInvitations.acceptedAt),
              isNull(organizationInvitations.revokedAt),
            ),
          )
          .for("update")
          .limit(1);
        if (pending) {
          const [updated] = await tx
            .update(organizationInvitations)
            .set({
              role,
              tokenHash: token.hash,
              invitedByUserId: req.user!.id,
              expiresAt,
              lastSentAt: null,
              sendCount: pending.sendCount + 1,
              updatedAt: new Date(),
            })
            .where(eq(organizationInvitations.id, pending.id))
            .returning();
          return { invitation: updated, previous: pending };
        }
        const [created] = await tx
          .insert(organizationInvitations)
          .values({
            organizationId: organization.organizationId,
            email,
            role,
            tokenHash: token.hash,
            invitedByUserId: req.user!.id,
            expiresAt,
          })
          .returning();
        return { invitation: created, previous: null };
      });

      try {
        await sendInvitationEmail({
          to: email,
          organizationName: organization.organizationName,
          role,
          token: token.raw,
          expiresAt,
        });
      } catch (error) {
        await db.transaction(async (tx) => {
          if (issuance.previous) {
            await tx
              .update(organizationInvitations)
              .set({
                role: issuance.previous.role,
                tokenHash: issuance.previous.tokenHash,
                invitedByUserId: issuance.previous.invitedByUserId,
                expiresAt: issuance.previous.expiresAt,
                lastSentAt: issuance.previous.lastSentAt,
                sendCount: issuance.previous.sendCount,
                updatedAt: issuance.previous.updatedAt,
              })
              .where(
                and(
                  eq(
                    organizationInvitations.id,
                    issuance.invitation.id,
                  ),
                  eq(organizationInvitations.tokenHash, token.hash),
                ),
              );
          } else {
            await tx
              .update(organizationInvitations)
              .set({ revokedAt: new Date(), updatedAt: new Date() })
              .where(
                and(
                  eq(
                    organizationInvitations.id,
                    issuance.invitation.id,
                  ),
                  eq(organizationInvitations.tokenHash, token.hash),
                ),
              );
          }
        });
        throw error;
      }
      const invitation = issuance.invitation;
      const sentAt = new Date();
      const markedDelivered = await db.transaction(async (tx) => {
        const [marked] = await tx
          .update(organizationInvitations)
          .set({ lastSentAt: sentAt, updatedAt: sentAt })
          .where(
            and(
              eq(organizationInvitations.id, invitation.id),
              eq(organizationInvitations.tokenHash, token.hash),
            ),
          )
          .returning({ id: organizationInvitations.id });
        if (!marked) return false;
        await tx.insert(organizationAuditEvents).values({
          organizationId: organization.organizationId,
          actorUserId: req.user!.id,
          eventType: "membership.invited",
          targetType: "organization_invitation",
          targetId: invitation.id,
          metadata: { email, role, expiresAt: expiresAt.toISOString() },
        });
        return true;
      });
      if (!markedDelivered) {
        res.status(409).json({
          error: "A newer invitation was sent before this request completed",
        });
        return;
      }
      res.status(201).json({
        id: invitation.id,
        email,
        role,
        status: "pending",
        expiresAt: expiresAt.toISOString(),
        lastSentAt: sentAt.toISOString(),
        sendCount: invitation.sendCount,
        createdAt: invitation.createdAt.toISOString(),
      });
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Invitation delivery failed",
      );
      res.status(502).json({
        error: "The invitation could not be delivered. Verify the email integration and retry.",
      });
    }
  },
);

router.post(
  "/settings/invitations/:invitationId/resend",
  requireAuth,
  requireOrganizationPermission("settings:manage"),
  accountAdminLimiter,
  async (req, res) => {
    if (!emailIsConfigured()) {
      res.status(503).json({ error: "Outbound email is not configured" });
      return;
    }
    const organization = req.organization!;
    const invitationId = String(req.params.invitationId || "");
    const [pendingInvitation] = await db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.id, invitationId),
          eq(
            organizationInvitations.organizationId,
            organization.organizationId,
          ),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.revokedAt),
        ),
      )
      .limit(1);
    if (!pendingInvitation) {
      res.status(404).json({ error: "Pending invitation not found" });
      return;
    }
    if (
      organization.role !== "owner"
      && ["owner", "admin"].includes(pendingInvitation.role)
    ) {
      res.status(403).json({ error: "Only an organization owner can resend this invitation" });
      return;
    }

    try {
      const token = createAccountToken();
      const expiresAt = new Date(
        Date.now() + env.INVITATION_TTL_HOURS * 60 * 60 * 1000,
      );
      const [invitation] = await db
        .update(organizationInvitations)
        .set({
          tokenHash: token.hash,
          expiresAt,
          lastSentAt: null,
          sendCount: sql`${organizationInvitations.sendCount} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(organizationInvitations.id, pendingInvitation.id),
            eq(
              organizationInvitations.organizationId,
              organization.organizationId,
            ),
            isNull(organizationInvitations.acceptedAt),
            isNull(organizationInvitations.revokedAt),
          ),
        )
        .returning();
      if (!invitation) {
        res.status(409).json({ error: "The invitation is no longer pending" });
        return;
      }

      try {
        await sendInvitationEmail({
          to: invitation.email,
          organizationName: organization.organizationName,
          role: invitation.role,
          token: token.raw,
          expiresAt,
        });
      } catch (error) {
        await db
          .update(organizationInvitations)
          .set({
            tokenHash: pendingInvitation.tokenHash,
            expiresAt: pendingInvitation.expiresAt,
            lastSentAt: pendingInvitation.lastSentAt,
            sendCount: pendingInvitation.sendCount,
            updatedAt: pendingInvitation.updatedAt,
          })
          .where(
            and(
              eq(organizationInvitations.id, invitation.id),
              eq(organizationInvitations.tokenHash, token.hash),
            ),
          );
        throw error;
      }
      const sentAt = new Date();
      const markedDelivered = await db.transaction(async (tx) => {
        const [marked] = await tx
          .update(organizationInvitations)
          .set({ lastSentAt: sentAt, updatedAt: sentAt })
          .where(
            and(
              eq(organizationInvitations.id, invitation.id),
              eq(organizationInvitations.tokenHash, token.hash),
            ),
          )
          .returning({ id: organizationInvitations.id });
        if (!marked) return false;
        await tx.insert(organizationAuditEvents).values({
          organizationId: organization.organizationId,
          actorUserId: req.user!.id,
          eventType: "membership.invitation_resent",
          targetType: "organization_invitation",
          targetId: invitation.id,
          metadata: {
            email: invitation.email,
            role: invitation.role,
            expiresAt: expiresAt.toISOString(),
          },
        });
        return true;
      });
      if (!markedDelivered) {
        res.status(409).json({
          error: "A newer invitation was sent before this request completed",
        });
        return;
      }
      res.json({
        id: invitation.id,
        status: "pending",
        expiresAt: expiresAt.toISOString(),
        lastSentAt: sentAt.toISOString(),
      });
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Invitation resend failed",
      );
      res.status(502).json({ error: "The invitation could not be resent" });
    }
  },
);

router.delete(
  "/settings/invitations/:invitationId",
  requireAuth,
  requireOrganizationPermission("settings:manage"),
  accountAdminLimiter,
  async (req, res) => {
    const organization = req.organization!;
    const invitationId = String(req.params.invitationId || "");
    const [invitation] = await db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.id, invitationId),
          eq(
            organizationInvitations.organizationId,
            organization.organizationId,
          ),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.revokedAt),
        ),
      )
      .limit(1);
    if (!invitation) {
      res.status(404).json({ error: "Pending invitation not found" });
      return;
    }
    if (
      organization.role !== "owner"
      && ["owner", "admin"].includes(invitation.role)
    ) {
      res.status(403).json({ error: "Only an organization owner can revoke this invitation" });
      return;
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(organizationInvitations)
        .set({ revokedAt: now, updatedAt: now })
        .where(eq(organizationInvitations.id, invitation.id));
      await tx.insert(organizationAuditEvents).values({
        organizationId: organization.organizationId,
        actorUserId: req.user!.id,
        eventType: "membership.invitation_revoked",
        targetType: "organization_invitation",
        targetId: invitation.id,
        metadata: { email: invitation.email, role: invitation.role },
      });
    });
    res.status(204).send();
  },
);

router.post(
  "/settings/members/:membershipId/password-reset",
  requireAuth,
  requireOrganizationPermission("settings:manage"),
  accountAdminLimiter,
  async (req, res) => {
    if (!emailIsConfigured()) {
      res.status(503).json({ error: "Outbound email is not configured" });
      return;
    }
    const organization = req.organization!;
    const membershipId = String(req.params.membershipId || "");
    const [member] = await db
      .select({
        membershipId: organizationMemberships.id,
        userId: usersTable.id,
        email: usersTable.email,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(usersTable, eq(usersTable.id, organizationMemberships.userId))
      .where(
        and(
          eq(organizationMemberships.id, membershipId),
          eq(
            organizationMemberships.organizationId,
            organization.organizationId,
          ),
        ),
      )
      .limit(1);
    if (!member?.email) {
      res.status(404).json({ error: "Organization member not found" });
      return;
    }
    if (
      organization.role !== "owner"
      && ["owner", "admin"].includes(member.role)
    ) {
      res.status(403).json({ error: "Only an organization owner can reset this member" });
      return;
    }

    try {
      const { expiresAt, delivered } = await issuePasswordReset({
        userId: member.userId,
        email: member.email,
        requestedByUserId: req.user!.id,
        organizationId: organization.organizationId,
      });
      await db.insert(organizationAuditEvents).values({
        organizationId: organization.organizationId,
        actorUserId: req.user!.id,
        eventType: delivered
          ? "member.password_reset_sent"
          : "member.password_reset_suppressed",
        targetType: "organization_membership",
        targetId: member.membershipId,
        metadata: {
          userId: member.userId,
          delivered,
          expiresAt: expiresAt.toISOString(),
        },
      });
      res.status(202).json({
        message: delivered
          ? "Password reset email sent"
          : "A password reset email was already sent recently",
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Administrator password reset delivery failed",
      );
      res.status(502).json({ error: "Password reset email could not be sent" });
    }
  },
);

export default router;
