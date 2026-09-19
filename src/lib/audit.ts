import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function writeAudit(input: {
  workspaceId: string;
  actorId?: string | null;
  action: AuditAction;
  entity: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      metadata: input.metadata,
    },
  });
}
