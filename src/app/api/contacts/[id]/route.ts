import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull } from "@/lib/validations/helpers";
import { parseBody } from "@/lib/validations/common";
import { contactUpdateSchema } from "@/lib/validations/contacts";
import { measuredRoute } from "@/lib/perf";


type RouteContext = { params: Promise<{ id: string }> };

async function findContact(workspaceId: string, id: string) {
  const contact = await prisma.contact.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: { account: { select: { id: true, company: true } } },
  });
  if (!contact) throw new ApiError(404, "Contact not found");
  return contact;
}

export const GET = measuredRoute("GET /api/contacts/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const { id } = await context.params;
    return jsonOk(await findContact(workspaceId, id));
  } catch (error) {
    return jsonError(error);
  }
});

export const PATCH = measuredRoute("PATCH /api/contacts/:id", async (request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    await findContact(workspaceId, id);
    const body = emptyToNull(parseBody(contactUpdateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, { accountId: body.accountId });

    const result = await prisma.contact.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: {
        ...body,
        email: body.email === undefined ? undefined : body.email || null,
      },
    });
    if (result.count === 0) throw new ApiError(404, "Contact not found");
    const contact = await findContact(workspaceId, id);

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "CONTACT_UPDATED",
      entity: "Contact",
      entityId: contact.id,
      metadata: { fields: Object.keys(body) },
    });

    return jsonOk(contact);
  } catch (error) {
    return jsonError(error);
  }
});

export const DELETE = measuredRoute("DELETE /api/contacts/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:delete");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    await findContact(workspaceId, id);

    const result = await prisma.contact.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw new ApiError(404, "Contact not found");

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "CONTACT_UPDATED",
      entity: "Contact",
      entityId: id,
      metadata: { softDeleted: true },
    });

    return jsonOk({ ok: true, id });
  } catch (error) {
    return jsonError(error);
  }
});
