import { z } from "zod";
import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { loadSourceCoverage } from "@/lib/sources/coverage";
import { leadSourceEnum, parseBody } from "@/lib/validations/common";
import { measuredRoute } from "@/lib/perf";

const sourcesSchema = z.object({
  sources: z.array(leadSourceEnum).max(17),
});

export const GET = measuredRoute("GET /api/workspace/sources", async () => {
  try {
    const { workspaceId } = await requirePermission("workspace:read");
    return jsonOk(await loadSourceCoverage(workspaceId));
  } catch (error) {
    return jsonError(error);
  }
});

/** Replaces the workspace's declared sources with exactly the given list. A real change is audited (SOURCES_DECLARED). */
export const PUT = measuredRoute("PUT /api/workspace/sources", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("workspace:write");
    const { sources } = parseBody(sourcesSchema, await request.json());
    const unique = [...new Set(sources)];
    await prisma.$transaction(async (tx) => {
      // Serialise saves per workspace so the before/after diff (and its audit row) is never computed from a stale read.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sources:${workspaceId}`}))`;
      const before = (await tx.sourceDeclaration.findMany({ where: { workspaceId }, select: { source: true } })).map((d) => d.source);
      const added = unique.filter((s) => !before.includes(s));
      const removed = before.filter((s) => !unique.includes(s));
      if (added.length === 0 && removed.length === 0) return;
      await tx.sourceDeclaration.deleteMany({ where: { workspaceId, source: { in: removed } } });
      await tx.sourceDeclaration.createMany({ data: added.map((source) => ({ workspaceId, source })), skipDuplicates: true });
      await writeAudit(
        {
          workspaceId,
          actorId: userId,
          action: "SOURCES_DECLARED",
          entity: "Workspace",
          entityId: workspaceId,
          fromState: [...before].sort().join(",") || null,
          toState: [...unique].sort().join(",") || null,
          metadata: { added, removed },
        },
        tx,
      );
    });
    return jsonOk(await loadSourceCoverage(workspaceId));
  } catch (error) {
    return jsonError(error);
  }
});
