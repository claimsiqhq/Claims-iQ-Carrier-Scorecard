import {
  db,
  passwordResetTokens,
  usersTable,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
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
}): Promise<{ expiresAt: Date }> {
  const token = createAccountToken();
  const expiresAt = new Date(
    Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
  );

  await db.transaction(async (tx) => {
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
    await tx.insert(passwordResetTokens).values({
      userId: input.userId,
      tokenHash: token.hash,
      requestedByUserId: input.requestedByUserId,
      requestedForOrganizationId: input.organizationId,
      expiresAt,
    });
  });

  await sendPasswordResetEmail({
    to: input.email,
    token: token.raw,
    expiresAt,
  });

  return { expiresAt };
}
