import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isDemoMode } from "@/lib/demo-mode";
import type { WorkspaceRole } from "@prisma/client";

export async function requireAppAccess() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id || !session.user.workspaceId) {
    redirect("/login");
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: session.user.workspaceId,
        userId: session.user.id,
      },
    },
    select: {
      role: true,
      workspaceId: true,
      workspace: {
        select: {
          id: true,
          name: true,
          isDemo: true,
          deletedAt: true,
          branding: true,
        },
      },
    },
  });

  if (!membership || membership.workspace.deletedAt) {
    redirect("/login");
  }

  return {
    session,
    userId: session.user.id,
    workspaceId: membership.workspaceId,
    role: membership.role as WorkspaceRole,
    workspace: membership.workspace,
    demoMode: isDemoMode() || membership.workspace.isDemo,
  };
}
