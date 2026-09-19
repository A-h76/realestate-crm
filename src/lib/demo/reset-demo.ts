import "server-only";

import { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  clearWorkspaceData,
  seedDemoWorkspace,
  WORKSPACE_SLUG,
  type SeedResult,
} from "../../../prisma/seed-data";

/**
 * Deletes all workspace-scoped data for the demo workspace, re-seeds the
 * deterministic dataset, then writes a DEMO_RESET audit log.
 */
export async function resetDemo(
  workspaceId: string,
  actorId: string,
): Promise<SeedResult> {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, slug: WORKSPACE_SLUG, deletedAt: null, isDemo: true },
  });

  if (!workspace || !workspace.isDemo) {
    throw new Error(
      "Reset Demo is only available for the Synas Realty demo workspace.",
    );
  }

  await clearWorkspaceData(prisma, workspace.id);
  const result = await seedDemoWorkspace(prisma);

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
