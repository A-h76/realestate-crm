import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/db";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/notifications", async (_request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("notifications:read");
    const items = await prisma.notification.findMany({
      where: { workspaceId, userId },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    const unread = items.filter((n) => !n.readAt).length;
    return jsonOk({ items, unread });
  } catch (error) {
    return jsonError(error);
  }
});

export const PATCH = measuredRoute("PATCH /api/notifications", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("notifications:read");
    const body = (await request.json().catch(() => ({}))) as { id?: string; all?: boolean };
    if (body.all) {
      await prisma.notification.updateMany({
        where: { workspaceId, userId, readAt: null },
        data: { readAt: new Date() },
      });
      return jsonOk({ ok: true });
    }
    if (!body.id) return jsonOk({ ok: false }, 400);
    await prisma.notification.updateMany({
      where: { id: body.id, workspaceId, userId },
      data: { readAt: new Date() },
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
});
