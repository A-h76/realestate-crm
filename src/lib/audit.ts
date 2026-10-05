import type { ActorType, AuditAction, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type AuditDb = Pick<typeof prisma, "auditLog">;

export async function writeAudit(
  input: {
    workspaceId: string;
    actorId?: string | null;
    /** Defaults to USER when there is an actorId, otherwise SYSTEM. Say CUSTOMER / AI / PROVIDER explicitly. */
    actorType?: ActorType;
    action: AuditAction;
    entity: string;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
    /** When it really happened, if that differs from now (e.g. a provider timestamp). */
    occurredAt?: Date;
    fromState?: string | null;
    toState?: string | null;
    providerEventId?: string | null;
  },
  db: AuditDb = prisma,
) {
  return db.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      actorType: input.actorType ?? (input.actorId ? "USER" : "SYSTEM"),
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      metadata: input.metadata,
      occurredAt: input.occurredAt,
      fromState: input.fromState,
      toState: input.toState,
      providerEventId: input.providerEventId,
    },
  });
}
