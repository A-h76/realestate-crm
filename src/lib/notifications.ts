import { Prisma, type NotificationType } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function notify(input: {
  workspaceId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
  entityType?: string;
  entityId?: string;
}) {
  return prisma.notification.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      href: input.href,
      entityType: input.entityType,
      entityId: input.entityId,
    },
  });
}

/**
 * Idempotent notification for automation actions: the (userId, dedupeKey) unique index makes a
 * replayed or concurrent identical action a no-op. Returns null when it was already sent.
 */
export async function notifyOnce(input: Parameters<typeof notify>[0] & { dedupeKey: string }) {
  try {
    return await prisma.notification.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        href: input.href,
        entityType: input.entityType,
        entityId: input.entityId,
        dedupeKey: input.dedupeKey,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

export async function unreadCount(workspaceId: string, userId: string) {
  return prisma.notification.count({
    where: { workspaceId, userId, readAt: null },
  });
}

export type NotificationCreate = Prisma.NotificationCreateInput;
