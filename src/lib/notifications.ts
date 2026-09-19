import type { NotificationType, Prisma } from "@prisma/client";
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

export async function unreadCount(workspaceId: string, userId: string) {
  return prisma.notification.count({
    where: { workspaceId, userId, readAt: null },
  });
}

export type NotificationCreate = Prisma.NotificationCreateInput;
