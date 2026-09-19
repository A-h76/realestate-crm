import { z } from "zod";
import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { parseBody } from "@/lib/validations/common";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { measuredRoute } from "@/lib/perf";


const reviewSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["APPROVED", "REJECTED"]),
});

export const POST = measuredRoute("POST /api/intelligence/review", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("intelligence:review");
    await enforceRateLimit({ key: `intel:${workspaceId}:${userId}`, ...RATE_LIMITS.intelligence });
    const body = parseBody(reviewSchema, await request.json());
    const existing = await prisma.intelligenceRun.findFirst({
      where: { id: body.id, workspaceId },
    });
    if (!existing) throw new ApiError(404, "Intelligence run not found");

    const runResult = await prisma.intelligenceRun.updateMany({
      where: { id: existing.id, workspaceId },
      data: {
        status: body.status,
        reviewedById: userId,
        reviewedAt: new Date(),
      },
    });
    if (runResult.count === 0) throw new ApiError(404, "Intelligence run not found");
    const run = await prisma.intelligenceRun.findFirstOrThrow({
      where: { id: existing.id, workspaceId },
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: body.status === "APPROVED" ? "INTELLIGENCE_APPROVED" : "INTELLIGENCE_REJECTED",
      entity: "IntelligenceRun",
      entityId: run.id,
      metadata: { status: body.status, kind: run.kind },
    });

    return jsonOk({ run, notice: "Recommendation updated. CRM records were not auto-mutated." });
  } catch (error) {
    return jsonError(error);
  }
});
