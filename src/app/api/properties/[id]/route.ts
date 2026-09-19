import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull } from "@/lib/validations/helpers";
import { parseBody } from "@/lib/validations/common";
import { propertyUpdateSchema } from "@/lib/validations/properties";
import { measuredRoute } from "@/lib/perf";


type RouteContext = { params: Promise<{ id: string }> };

async function findProperty(workspaceId: string, id: string) {
  const property = await prisma.property.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: {
      assignedAgent: { select: { id: true, name: true } },
      ownerContact: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!property) throw new ApiError(404, "Property not found");
  return property;
}

export const GET = measuredRoute("GET /api/properties/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const { id } = await context.params;
    return jsonOk(await findProperty(workspaceId, id));
  } catch (error) {
    return jsonError(error);
  }
});

export const PATCH = measuredRoute("PATCH /api/properties/:id", async (request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    const existing = await findProperty(workspaceId, id);
    const body = emptyToNull(parseBody(propertyUpdateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, {
      ownerContactId: body.ownerContactId,
      assignedAgentId: body.assignedAgentId,
    });

    const statusChanged =
      body.status !== undefined && body.status !== existing.status;

    const updated = await prisma.property.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: {
        title: body.title,
        description: body.description,
        address: body.address,
        area: body.area,
        city: body.city,
        propertyType: body.propertyType,
        purpose: body.purpose,
        size: body.size,
        sizeUnit: body.sizeUnit,
        bedrooms: body.bedrooms,
        bathrooms: body.bathrooms,
        furnishedStatus: body.furnishedStatus,
        price: body.price,
        currency: body.currency,
        status: body.status,
        listingType: body.listingType,
        ownerContactId: body.ownerContactId,
        assignedAgentId: body.assignedAgentId,
        listingSource: body.listingSource,
        verificationStatus: body.verificationStatus,
        dateListed: body.dateListed ?? undefined,
        ...(body.price !== undefined ? { lastPriceUpdate: new Date() } : {}),
      },
    });
    if (updated.count === 0) throw new ApiError(404, "Property not found");
    const property = await findProperty(workspaceId, id);

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: statusChanged ? "PROPERTY_STATUS_CHANGED" : "PROPERTY_UPDATED",
      entity: "Property",
      entityId: property.id,
      metadata: statusChanged
        ? { from: existing.status, to: property.status }
        : { fields: Object.keys(body) },
    });

    return jsonOk(property);
  } catch (error) {
    return jsonError(error);
  }
});

export const DELETE = measuredRoute("DELETE /api/properties/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:delete");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    await findProperty(workspaceId, id);

    const result = await prisma.property.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw new ApiError(404, "Property not found");
    const property = { id };

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "PROPERTY_UPDATED",
      entity: "Property",
      entityId: property.id,
      metadata: { softDeleted: true },
    });

    return jsonOk({ ok: true, id: property.id });
  } catch (error) {
    return jsonError(error);
  }
});
