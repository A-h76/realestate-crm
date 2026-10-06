import { z } from "zod";
import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/db";
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

/** Replaces the workspace's declared sources with exactly the given list. */
export const PUT = measuredRoute("PUT /api/workspace/sources", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("workspace:write");
    const { sources } = parseBody(sourcesSchema, await request.json());
    const unique = [...new Set(sources)];
    await prisma.$transaction([
      prisma.sourceDeclaration.deleteMany({ where: { workspaceId, source: { notIn: unique } } }),
      prisma.sourceDeclaration.createMany({ data: unique.map((source) => ({ workspaceId, source })), skipDuplicates: true }),
    ]);
    return jsonOk(await loadSourceCoverage(workspaceId));
  } catch (error) {
    return jsonError(error);
  }
});
