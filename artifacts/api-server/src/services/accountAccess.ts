import {
  db,
  passwordResetTokens,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { env } from "../env";
import {
  createAccountToken,
  normalizeEmail,
} from "../lib/accountSecurity";
import { sendPasswordResetEmail } from "./accountEmails";

export async function findUserByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return undefined;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(sql`lower(${usersTable.email}) = ${normalizedEmail}`)
    .limit(1);
  return user;
}

export async function issuePasswordReset(input: {
  userId: string;
  email: string;
  requestedByUserId?: string;
  organizationId?: string;
}): Promise<{ expiresAt: Date; delivered: boolean }> {
  const token = createAccountToken();
  const expiresAt = new Date(
    Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
  );

  const issued = await db.transaction(async (tx) => {
    await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, input.userId))
      .for("update")
      .limit(1);
    const [activeToken] = await tx
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, input.userId),
          isNull(passwordResetTokens.usedAt),
          isNull(passwordResetTokens.revokedAt),
        ),
      )
      .orderBy(desc(passwordResetTokens.createdAt))
      .limit(1);
    if (
      activeToken
      && activeToken.createdAt > new Date(Date.now() - 60_000)
      && activeToken.expiresAt > new Date()
    ) {
      return {
        tokenId: null,
        previousToken: null,
        expiresAt: activeToken.expiresAt,
      };
    }

    await tx
      .update(passwordResetTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.userId, input.userId),
          isNull(passwordResetTokens.usedAt),
          isNull(passwordResetTokens.revokedAt),
        ),
      );
    const [created] = await tx
      .insert(passwordResetTokens)
      .values({
        userId: input.userId,
        tokenHash: token.hash,
        requestedByUserId: input.requestedByUserId,
        requestedForOrganizationId: input.organizationId,
        expiresAt,
      })
      .returning({ id: passwordResetTokens.id });
    return {
      tokenId: created.id,
      previousToken: activeToken ?? null,
      expiresAt,
    };
  });

  if (!issued.tokenId) {
    return { expiresAt: issued.expiresAt, delivered: false };
  }

  try {
    await sendPasswordResetEmail({
      to: input.email,
      token: token.raw,
      expiresAt: issued.expiresAt,
    });
  } catch (error) {
    await db.transaction(async (tx) => {
      await tx
        .update(passwordResetTokens)
        .set({ revokedAt: new Date() })
        .where(eq(passwordResetTokens.id, issued.tokenId!));
      if (
        issued.previousToken
        && issued.previousToken.usedAt === null
        && issued.previousToken.expiresAt > new Date()
      ) {
        await tx
          .update(passwordResetTokens)
          .set({ revokedAt: null })
          .where(
            and(
              eq(passwordResetTokens.id, issued.previousToken.id),
              isNull(passwordResetTokens.usedAt),
            ),
          );
      }
    });
    throw error;
  }

  return { expiresAt: issued.expiresAt, delivered: true };
}
