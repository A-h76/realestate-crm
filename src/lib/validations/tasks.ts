import { z } from "zod";
import {
  optionalDate,
  optionalId,
  paginationSchema,
  taskPriorityEnum,
  taskStatusEnum,
} from "./common";

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  status: taskStatusEnum.optional(),
  priority: taskPriorityEnum.optional(),
  dueAt: optionalDate,
  ownerId: optionalId,
  leadId: optionalId,
  opportunityId: optionalId,
  accountId: optionalId,
  contactId: optionalId,
  propertyId: optionalId,
  proposalId: optionalId,
  siteVisitId: optionalId,
});

export const taskUpdateSchema = taskCreateSchema.partial();

export const taskListQuerySchema = paginationSchema.extend({
  status: taskStatusEnum.optional(),
  priority: taskPriorityEnum.optional(),
  ownerId: z.string().optional(),
  leadId: z.string().optional(),
  opportunityId: z.string().optional(),
});

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
