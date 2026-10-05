import { z } from "zod";
import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { roleHasPermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseBody } from "@/lib/validations/common";
import { evaluateInactiveLeads } from "@/lib/automation/engine";
import { measuredRoute } from "@/lib/perf";


const patchSchema = z.object({
  id: z.string().min(1),
  paused: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const GET = measuredRoute("GET /api/automations", async (_request: Request) => {
  try {
    const { workspaceId, role } = await requirePermission("automations:read");
    const items = await prisma.automation.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { executions: true } } },
    });
    return jsonOk({ items, canManage: roleHasPermission(role, "automations:manage") });
  } catch (error) {
    return jsonError(error);
  }
});

export const PATCH = measuredRoute("PATCH /api/automations", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("automations:manage");
    const body = parseBody(patchSchema, await request.json());
    const existing = await prisma.automation.findFirst({
      where: { id: body.id, workspaceId },
    });
    if (!existing) throw new ApiError(404, "Automation not found");
    const item = await prisma.automation.updateMany({
      where: { id: existing.id, workspaceId },
      data: {
        paused: body.paused,
        enabled: body.enabled,
      },
    });
    if (item.count === 0) throw new ApiError(404, "Automation not found");
    const updated = await prisma.automation.findFirstOrThrow({ where: { id: existing.id, workspaceId } });
    return jsonOk(updated);
  } catch (error) {
    return jsonError(error);
  }
});

export const POST = measuredRoute("POST /api/automations", async (_request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("automations:execute");
    // Bounded: this runs inside the HTTP request, so it stops starting new leads after 20s (AUTO-005).
    const state = { truncated: false };
    const executions = await evaluateInactiveLeads(workspaceId, userId, { deadlineMs: 20_000, state });
    return jsonOk({
      executions,
      truncated: state.truncated,
      notice: state.truncated
        ? "Time budget reached; remaining inactive leads will be handled by the next run."
        : "Inactive-lead automations evaluated.",
    });
  } catch (error) {
    return jsonError(error);
  }
});
