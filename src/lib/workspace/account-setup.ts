import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";

/**
 * CORE-002: invited members choose their own password through a one-time link.
 * The server never stores or returns a password; only the SHA-256 of the link
 * token is persisted, and the token itself is never audited or logged.
 */
export const SETUP_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

export const setupPasswordSchema = z.string().min(12, "Use at least 12 characters").max(72);

const INVALID_LINK = "This setup link is invalid or has expired";

export function hashSetupToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Replaces any earlier unused link for the user with a fresh one. Returns the plaintext token (shown once). */
export async function issueSetupToken(userId: string, createdById: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_MS);
  await prisma.$transaction([
    prisma.accountSetupToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.accountSetupToken.create({ data: { userId, tokenHash: hashSetupToken(token), expiresAt, createdById } }),
  ]);
  return { token, expiresAt };
}

/** True while the user has never completed setup (an unused link exists, even if expired). */
export async function hasPendingSetup(userId: string): Promise<boolean> {
  return (await prisma.accountSetupToken.count({ where: { userId, usedAt: null } })) > 0;
}

/**
 * Consumes the link and sets the password atomically. The `usedAt: null` guard in the
 * UPDATE makes the link single-use even under concurrent submissions; every failure
 * (unknown, used, expired, deactivated account) returns the same message.
 */
export async function acceptSetupToken(token: string, password: string): Promise<{ email: string }> {
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();
  const tokenHash = hashSetupToken(token);

  return prisma.$transaction(async (tx) => {
    const consumed = await tx.accountSetupToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) throw new ApiError(400, INVALID_LINK);

    const row = await tx.accountSetupToken.findUniqueOrThrow({
      where: { tokenHash },
      select: { userId: true, user: { select: { email: true, deletedAt: true } } },
    });
    if (row.user.deletedAt) throw new ApiError(400, INVALID_LINK);

    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
    await tx.authSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });

    const memberships = await tx.workspaceMember.findMany({
      where: { userId: row.userId },
      select: { id: true, workspaceId: true },
    });
    for (const membership of memberships) {
      await writeAudit(
        {
          workspaceId: membership.workspaceId,
          actorId: row.userId,
          action: "MEMBER_INVITE_ACCEPTED",
          entity: "WorkspaceMember",
          entityId: membership.id,
        },
        tx,
      );
    }
    return { email: row.user.email };
  });
}
