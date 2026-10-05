import { prisma } from "@/lib/db";

export type InvitationState = { state: "PENDING" | "EXPIRED"; expiresAt: string };

/**
 * A member who has an unused setup link has not finished creating their password yet.
 * PENDING: the newest unused link is still valid. EXPIRED: every unused link has lapsed (re-issue to get a new one).
 * No unused link = the member completed setup (or was never invited through a link): returns null.
 */
export function classifyInvitation(
  tokens: Array<{ expiresAt: Date; usedAt: Date | null }>,
  now: Date = new Date(),
): InvitationState | null {
  const unused = tokens.filter((t) => t.usedAt === null);
  if (unused.length === 0) return null;
  const latest = unused.reduce((a, b) => (a.expiresAt >= b.expiresAt ? a : b));
  return { state: latest.expiresAt > now ? "PENDING" : "EXPIRED", expiresAt: latest.expiresAt.toISOString() };
}

export async function invitationStatesFor(userIds: string[], now: Date = new Date()): Promise<Map<string, InvitationState>> {
  const result = new Map<string, InvitationState>();
  if (userIds.length === 0) return result;
  const rows = await prisma.accountSetupToken.findMany({
    where: { userId: { in: userIds }, usedAt: null },
    select: { userId: true, expiresAt: true, usedAt: true },
  });
  const byUser = new Map<string, Array<{ expiresAt: Date; usedAt: Date | null }>>();
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  for (const [userId, tokens] of byUser) {
    const state = classifyInvitation(tokens, now);
    if (state) result.set(userId, state);
  }
  return result;
}
