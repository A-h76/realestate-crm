import { z } from "zod";
import {
  activityStatusEnum,
  activityTypeEnum,
  optionalDate,
  optionalId,
  paginationSchema,
} from "./common";

export const activityCreateSchema = z.object({
  type: activityTypeEnum,
  leadId: optionalId,
  opportunityId: optionalId,
  accountId: optionalId,
  contactId: optionalId,
  ownerId: optionalId,
  date: optionalDate,
  status: activityStatusEnum.optional(),
  title: z.string().trim().optional().nullable(),
  notes: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const activityListQuerySchema = paginationSchema.extend({
  type: activityTypeEnum.optional(),
  leadId: z.string().optional(),
  opportunityId: z.string().optional(),
  accountId: z.string().optional(),
});

export type ActivityCreateInput = z.infer<typeof activityCreateSchema>;
