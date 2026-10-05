import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { WorkspaceRole } from "@prisma/client";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { hasPendingSetup, issueSetupToken } from "@/lib/workspace/account-setup";

/**
 * CORE-002. There is no self-service signup and no email delivery in this product, so an
 * OWNER/ADMIN adds a person and hands them a one-time setup link out of band:
 *  - new email: account created with an unusable random password + a 72h single-use link;
 *  - existing active user: membership only, nothing to hand over;
 *  - existing member who never finished setup: their link is re-issued (the old one dies).
 * No password or token is ever stored in plaintext, audited, or logged.
 */
export type InviteResult = {
  userId: string;
  email: string;
  role: WorkspaceRole;
  setup: { token: string; expiresAt: Date } | null;
};

export async function inviteWorkspaceMember(input: {
  workspaceId: string;
  actorId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
}): Promise<InviteResult> {
  const email = input.email.toLowerCase();
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    if (existingUser.deletedAt) throw new ApiError(400, "This email belongs to a deactivated account");
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: existingUser.id } },
    });
    if (membership) {
      if (!(await hasPendingSetup(existingUser.id))) {
        throw new ApiError(400, "This person is already a member of the workspace");
      }
      const setup = await issueSetupToken(existingUser.id, input.actorId);
      await writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: "MEMBER_INVITED",
        entity: "WorkspaceMember",
        entityId: membership.id,
        metadata: { userId: existingUser.id, email, role: membership.role, reissued: true },
      });
      return { userId: existingUser.id, email, role: membership.role, setup };
    }

    const member = await prisma.workspaceMember.create({
      data: { workspaceId: input.workspaceId, userId: existingUser.id, role: input.role },
    });
    await writeAudit({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: "MEMBER_INVITED",
      entity: "WorkspaceMember",
      entityId: member.id,
      metadata: { userId: existingUser.id, email, role: input.role, newAccount: false },
    });
    return { userId: existingUser.id, email, role: input.role, setup: null };
  }

  // Nobody ever knows this password; the member sets their own via the setup link.
  const unusableHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  const { user, member } = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { email, name: input.name, passwordHash: unusableHash } });
    const membership = await tx.workspaceMember.create({
      data: { workspaceId: input.workspaceId, userId: created.id, role: input.role },
    });
    return { user: created, member: membership };
  });
  const setup = await issueSetupToken(user.id, input.actorId);
  await writeAudit({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    action: "MEMBER_INVITED",
    entity: "WorkspaceMember",
    entityId: member.id,
    metadata: { userId: user.id, email, role: input.role, newAccount: true },
  });
  return { userId: user.id, email, role: input.role, setup };
}
