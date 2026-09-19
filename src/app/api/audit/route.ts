import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/db";
import { paginationSkipTake, parseQuery, paginationSchema } from "@/lib/validations/common";
import { z } from "zod";
import { measuredRoute } from "@/lib/perf";


const auditQuerySchema = paginationSchema.extend({
  entity: z.string().optional(),
  action: z.string().optional(),
});

export const GET = measuredRoute("GET /api/audit", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("audit:read");
    const query = parseQuery(auditQuerySchema, new URL(request.url).searchParams);
    const { skip, take } = paginationSkipTake(query);

    const where = {
      workspaceId,
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.action ? { action: query.action as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { id: true, name: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return jsonOk({ items, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    return jsonError(error);
  }
});
