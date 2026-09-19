import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { parseBody } from "@/lib/validations/common";
import { noteCreateSchema } from "@/lib/validations/notes";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/notes", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const url = new URL(request.url);
    const leadId = url.searchParams.get("leadId") ?? undefined;
    const opportunityId = url.searchParams.get("opportunityId") ?? undefined;

    const items = await prisma.note.findMany({
      where: { workspaceId, leadId, opportunityId },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { id: true, name: true } } },
      take: 100,
    });

    return jsonOk({ items });
  } catch (error) {
    return jsonError(error);
  }
});

export const POST = measuredRoute("POST /api/notes", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const body = parseBody(noteCreateSchema, await request.json());
    await assertRelationsInWorkspace(workspaceId, {
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      accountId: body.accountId,
      contactId: body.contactId,
      propertyId: body.propertyId,
    });

    const note = await prisma.note.create({
      data: {
        workspaceId,
        body: body.body,
        authorId: userId,
        leadId: body.leadId,
        opportunityId: body.opportunityId,
        accountId: body.accountId,
        contactId: body.contactId,
        propertyId: body.propertyId,
      },
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "NOTE_CREATED",
      entity: "Note",
      entityId: note.id,
    });

    return jsonOk(note, 201);
  } catch (error) {
    return jsonError(error);
  }
});
