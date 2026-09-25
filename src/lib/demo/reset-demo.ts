import "server-only";

import { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  clearWorkspaceData,
  seedDemoWorkspace,
  WORKSPACE_SLUG,
} from "../../../prisma/seed-data";
import { seedUxAuditWorkspace, UX_AUDIT_SLUG } from "../../../prisma/seed-ux-audit-data";

/**
 * Deletes all workspace-scoped data for a demo workspace, re-seeds its
 * deterministic dataset, then writes a DEMO_RESET audit log. Only the two
 * known demo workspaces (by slug, and flagged isDemo) can be reset.
 */
export async function resetDemo(workspaceId: string, actorId: string) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, slug: { in: [WORKSPACE_SLUG, UX_AUDIT_SLUG] }, deletedAt: null, isDemo: true },
  });

  if (!workspace || !workspace.isDemo) {
    throw new Error("Reset Demo is only available for the Synas demo workspaces.");
  }

  let result: { workspaceId: string; counts: Record<string, number> };
  if (workspace.slug === UX_AUDIT_SLUG) {
    result = await seedUxAuditWorkspace();
  } else {
    await clearWorkspaceData(prisma, workspace.id);
    result = await seedDemoWorkspace(prisma);
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: result.workspaceId,
      actorId,
      action: AuditAction.DEMO_RESET,
      entity: "Workspace",
      entityId: result.workspaceId,
      metadata: {
        previousWorkspaceId: workspaceId,
        counts: result.counts,
        deterministic: true,
      },
    },
  });

  return result;
}
