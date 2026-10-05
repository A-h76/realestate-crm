import { cache } from "react";
import { redirect } from "next/navigation";
import { getActiveSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isDemoMode } from "@/lib/demo-mode";
import type { WorkspaceRole } from "@prisma/client";

/**
 * DAL gate for every server-rendered page: active server-side session + live membership.
 * Pages must call this themselves — the (app) layout's call does not protect them
 * (layouts render in parallel and are skipped on client navigation). cache() dedupes per request.
 */
export const requireAppAccess = cache(async () => {
  const session = await getActiveSession();
  if (!session) {
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
          // Locale settings the shell and pages format with (see @/lib/workspace/locale).
          timezone: true,
          currency: true,
          region: true,
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
});
