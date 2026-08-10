import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import {
  db,
  organizationAuditEvents,
  organizationInvitations,
  organizationMemberships,
  organizations,
  passwordResetTokens,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import {
  and,
  eq,
  gt,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import {
  hashAccountToken,
  hashPassword,
  isAccountToken,
  normalizeEmail,
  validatePassword,
  verifyPassword,
} from "../lib/accountSecurity";
import { clearSession } from "../lib/auth";
import logger from "../lib/logger";
import { requireAuth } from "../middlewares/requireAuth";
import {
  findUserByEmail,
  issuePasswordReset,
} from "../services/accountAccess";

const router: IRouter = Router();

const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many account recovery attempts. Try again later." },
});

const tokenActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many token attempts. Try again later." },
});

class AccountActionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AccountActionError";
  }
}

function accountActionFailure(error: unknown, fallback: string): {
  status: number;
  message: string;
} {
  if (error instanceof AccountActionError) {
    return { status: error.status, message: error.message };
  }
  return { status: 500, message: fallback };
}

router.post(
  "/auth/password/forgot",
  recoveryLimiter,
  async (req, res) => {
    const startedAt = Date.now();
    const email = normalizeEmail(req.body?.email);
    if (email) {
      try {
        const user = await findUserByEmail(email);
        if (user?.email) {
          await issuePasswordReset({
            userId: user.id,
            email: user.email,
          });
        }
      } catch (error) {
        logger.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "Forgot-password delivery failed",
        );
      }
    }
    const minimumResponseMs = 500;
    const remainingDelay = minimumResponseMs - (Date.now() - startedAt);
    if (remainingDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, remainingDelay));
    }
    res.status(202).json({
      message:
        "If an account matches that email, a password reset link will be sent.",
    });
  },
);

router.post(
  "/auth/password/reset/inspect",
  tokenActionLimiter,
  async (req, res) => {
    const token = req.body?.token;
    if (!isAccountToken(token)) {
      res.status(410).json({ error: "This password reset link is invalid or expired" });
      return;
    }
    const [row] = await db
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashAccountToken(token)),
          isNull(passwordResetTokens.usedAt),
          isNull(passwordResetTokens.revokedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) {
      res.status(410).json({ error: "This password reset link is invalid or expired" });
      return;
    }
    res.json({ valid: true });
  },
);

router.post(
  "/auth/password/reset",
  tokenActionLimiter,
  async (req, res) => {
    const token = req.body?.token;
    const password = req.body?.password;
    const passwordError = validatePassword(password);
    if (!isAccountToken(token) || passwordError) {
      res.status(400).json({
        error: passwordError || "This password reset link is invalid or expired",
      });
      return;
    }

    try {
      const tokenHash = hashAccountToken(token);
      const [candidate] = await db
        .select({ id: passwordResetTokens.id })
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.usedAt),
            isNull(passwordResetTokens.revokedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!candidate) {
        throw new AccountActionError(
          "This password reset link is invalid or expired",
          410,
        );
      }
      const passwordHash = await hashPassword(password);
      await db.transaction(async (tx) => {
        const [resetToken] = await tx
          .select()
          .from(passwordResetTokens)
          .where(
            and(
              eq(passwordResetTokens.tokenHash, tokenHash),
              isNull(passwordResetTokens.usedAt),
              isNull(passwordResetTokens.revokedAt),
              gt(passwordResetTokens.expiresAt, new Date()),
            ),
          )
          .for("update")
          .limit(1);
        if (!resetToken) {
          throw new AccountActionError(
            "This password reset link is invalid or expired",
            410,
          );
        }

        const now = new Date();
        await tx
          .update(usersTable)
          .set({
            passwordHash,
            passwordChangedAt: now,
            emailVerifiedAt: now,
            authVersion: sql`${usersTable.authVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(usersTable.id, resetToken.userId));
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: now })
          .where(eq(passwordResetTokens.id, resetToken.id));
        await tx
          .update(passwordResetTokens)
          .set({ revokedAt: now })
          .where(
            and(
              eq(passwordResetTokens.userId, resetToken.userId),
              ne(passwordResetTokens.id, resetToken.id),
              isNull(passwordResetTokens.usedAt),
              isNull(passwordResetTokens.revokedAt),
            ),
          );
        await tx
          .delete(sessionsTable)
          .where(eq(sessionsTable.userId, resetToken.userId));
      });
      await clearSession(res);
      res.json({ success: true });
    } catch (error) {
      const failure = accountActionFailure(
        error,
        "Password could not be reset",
      );
      if (failure.status === 500) {
        logger.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "Password reset failed",
        );
      }
      res.status(failure.status).json({ error: failure.message });
    }
  },
);

router.post(
  "/auth/password/change",
  requireAuth,
  recoveryLimiter,
  async (req, res) => {
    const currentPassword = req.body?.currentPassword;
    const newPassword = req.body?.newPassword;
    const passwordError = validatePassword(newPassword);
    if (typeof currentPassword !== "string" || passwordError) {
      res.status(400).json({
        error: passwordError || "Current password is required",
      });
      return;
    }

    try {
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, req.user!.id))
        .limit(1);
      if (
        !user
        || !(await verifyPassword(currentPassword, user.passwordHash))
      ) {
        throw new AccountActionError("Current password is incorrect", 400);
      }
      if (await verifyPassword(newPassword, user.passwordHash)) {
        throw new AccountActionError(
          "New password must be different from the current password",
          400,
        );
      }

      const passwordHash = await hashPassword(newPassword);
      await db.transaction(async (tx) => {
        const [lockedUser] = await tx
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, user.id))
          .for("update")
          .limit(1);
        if (
          !lockedUser
          || !(await verifyPassword(currentPassword, lockedUser.passwordHash))
        ) {
          throw new AccountActionError("Current password is incorrect", 400);
        }
        if (await verifyPassword(newPassword, lockedUser.passwordHash)) {
          throw new AccountActionError(
            "New password must be different from the current password",
            400,
          );
        }
        const now = new Date();
        await tx
          .update(usersTable)
          .set({
            passwordHash,
            passwordChangedAt: now,
            authVersion: sql`${usersTable.authVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(usersTable.id, lockedUser.id));
        await tx
          .update(passwordResetTokens)
          .set({ revokedAt: now })
          .where(
            and(
              eq(passwordResetTokens.userId, lockedUser.id),
              isNull(passwordResetTokens.usedAt),
              isNull(passwordResetTokens.revokedAt),
            ),
          );
        await tx
          .delete(sessionsTable)
          .where(eq(sessionsTable.userId, lockedUser.id));
        if (req.organization) {
          await tx.insert(organizationAuditEvents).values({
            organizationId: req.organization.organizationId,
            actorUserId: lockedUser.id,
            eventType: "account.password_changed",
            targetType: "user",
            targetId: lockedUser.id,
            metadata: {},
          });
        }
      });
      await clearSession(res);
      res.json({ success: true });
    } catch (error) {
      const failure = accountActionFailure(
        error,
        "Password could not be changed",
      );
      if (failure.status === 500) {
        logger.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "Password change failed",
        );
      }
      res.status(failure.status).json({ error: failure.message });
    }
  },
);

router.post(
  "/auth/invitations/inspect",
  tokenActionLimiter,
  async (req, res) => {
    const token = req.body?.token;
    if (!isAccountToken(token)) {
      res.status(410).json({ error: "This invitation is invalid or expired" });
      return;
    }
    const [invitation] = await db
      .select({
        email: organizationInvitations.email,
        role: organizationInvitations.role,
        organizationName: organizations.name,
        expiresAt: organizationInvitations.expiresAt,
      })
      .from(organizationInvitations)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationInvitations.organizationId),
      )
      .where(
        and(
          eq(organizationInvitations.tokenHash, hashAccountToken(token)),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.revokedAt),
          gt(organizationInvitations.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!invitation) {
      res.status(410).json({ error: "This invitation is invalid or expired" });
      return;
    }
    const existingUser = await findUserByEmail(invitation.email);
    res.json({
      email: invitation.email,
      role: invitation.role,
      organizationName: invitation.organizationName,
      expiresAt: invitation.expiresAt.toISOString(),
      accountExists: Boolean(existingUser),
    });
  },
);

router.post(
  "/auth/invitations/accept",
  tokenActionLimiter,
  async (req, res) => {
    const token = req.body?.token;
    const password = req.body?.password;
    if (!isAccountToken(token) || typeof password !== "string") {
      res.status(400).json({ error: "Invitation token and password are required" });
      return;
    }

    try {
      const tokenHash = hashAccountToken(token);
      const [preview] = await db
        .select({ email: organizationInvitations.email })
        .from(organizationInvitations)
        .where(
          and(
            eq(organizationInvitations.tokenHash, tokenHash),
            isNull(organizationInvitations.acceptedAt),
            isNull(organizationInvitations.revokedAt),
            gt(organizationInvitations.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!preview) {
        throw new AccountActionError("This invitation is invalid or expired", 410);
      }

      const existingUser = await findUserByEmail(preview.email);
      let passwordHash: string | undefined;
      if (existingUser) {
        if (!(await verifyPassword(password, existingUser.passwordHash))) {
          throw new AccountActionError(
            "Password confirmation did not match the existing account",
            400,
          );
        }
      } else {
        const passwordError = validatePassword(password);
        if (passwordError) throw new AccountActionError(passwordError, 400);
        passwordHash = await hashPassword(password);
      }

      const acceptance = await db.transaction(async (tx) => {
        const [invitation] = await tx
          .select()
          .from(organizationInvitations)
          .where(
            and(
              eq(organizationInvitations.tokenHash, tokenHash),
              isNull(organizationInvitations.acceptedAt),
              isNull(organizationInvitations.revokedAt),
              gt(organizationInvitations.expiresAt, new Date()),
            ),
          )
          .for("update")
          .limit(1);
        if (!invitation) {
          throw new AccountActionError("This invitation is invalid or expired", 410);
        }

        const [currentUser] = await tx
          .select()
          .from(usersTable)
          .where(sql`lower(${usersTable.email}) = ${invitation.email}`)
          .for("update")
          .limit(1);
        let acceptedUser = currentUser;
        if (
          acceptedUser
          && !(await verifyPassword(password, acceptedUser.passwordHash))
        ) {
          throw new AccountActionError(
            "Password confirmation did not match the existing account",
            400,
          );
        }
        if (!acceptedUser) {
          const firstName =
            typeof req.body?.firstName === "string"
              ? req.body.firstName.trim().slice(0, 80)
              : "";
          const lastName =
            typeof req.body?.lastName === "string"
              ? req.body.lastName.trim().slice(0, 80)
              : "";
          if (!firstName) {
            throw new AccountActionError("First name is required", 400);
          }
          [acceptedUser] = await tx
            .insert(usersTable)
            .values({
              email: invitation.email,
              passwordHash: passwordHash!,
              firstName,
              lastName: lastName || null,
              emailVerifiedAt: new Date(),
            })
            .returning();
        } else if (!acceptedUser.emailVerifiedAt) {
          [acceptedUser] = await tx
            .update(usersTable)
            .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
            .where(eq(usersTable.id, acceptedUser.id))
            .returning();
        }

        const [existingMembership] = await tx
          .select({ id: organizationMemberships.id })
          .from(organizationMemberships)
          .where(
            and(
              eq(
                organizationMemberships.organizationId,
                invitation.organizationId,
              ),
              eq(organizationMemberships.userId, acceptedUser.id),
            ),
          )
          .limit(1);
        if (existingMembership) {
          throw new AccountActionError(
            "This account already belongs to the organization",
            409,
          );
        }

        const [membershipCount] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(organizationMemberships)
          .where(eq(organizationMemberships.userId, acceptedUser.id));
        const [membership] = await tx
          .insert(organizationMemberships)
          .values({
            organizationId: invitation.organizationId,
            userId: acceptedUser.id,
            role: invitation.role,
            isDefault: membershipCount.count === 0,
          })
          .returning();
        const now = new Date();
        await tx
          .update(organizationInvitations)
          .set({
            acceptedByUserId: acceptedUser.id,
            acceptedAt: now,
            updatedAt: now,
          })
          .where(eq(organizationInvitations.id, invitation.id));
        await tx.insert(organizationAuditEvents).values({
          organizationId: invitation.organizationId,
          actorUserId: acceptedUser.id,
          eventType: "membership.invitation_accepted",
          targetType: "organization_membership",
          targetId: membership.id,
          metadata: {
            invitationId: invitation.id,
            role: invitation.role,
          },
        });
        return {
          user: acceptedUser,
          organizationId: invitation.organizationId,
        };
      });

      res.json({
        success: true,
        organizationId: acceptance.organizationId,
        user: {
          id: acceptance.user.id,
          email: acceptance.user.email,
          firstName: acceptance.user.firstName,
          lastName: acceptance.user.lastName,
        },
      });
    } catch (error) {
      const failure = accountActionFailure(
        error,
        "Invitation could not be accepted",
      );
      if (failure.status === 500) {
        logger.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "Invitation acceptance failed",
        );
      }
      res.status(failure.status).json({ error: failure.message });
    }
  },
);

export default router;
