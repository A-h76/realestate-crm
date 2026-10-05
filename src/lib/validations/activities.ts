import { z } from "zod";
import {
  activityStatusEnum,
  activityTypeEnum,
  optionalDate,
  optionalId,
  paginationSchema,
} from "./common";

/**
 * Activity types a person can record by hand. The rest are written by the system and must not be forgeable
 * through the API: STAGE_CHANGE and SYSTEM (audit-like entries), TASK, SITE_VISIT (created via the calendar)
 * and WHATSAPP_MESSAGE (created by real message sends/receipts).
 */
export const MANUAL_ACTIVITY_TYPES = ["CALL", "EMAIL", "MEETING", "NOTE", "FOLLOW_UP"] as const;

export const activityCreateSchema = z.object({
  type: z.enum(MANUAL_ACTIVITY_TYPES),
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
