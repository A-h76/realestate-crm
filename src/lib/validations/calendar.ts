import { z } from "zod";
import {
  calendarEventStatusEnum,
  calendarEventTypeEnum,
  dateCoerce,
  optionalId,
} from "./common";

export const calendarCreateSchema = z.object({
  title: z.string().trim().min(1),
  type: calendarEventTypeEnum.optional(),
  status: calendarEventStatusEnum.optional(),
  startAt: dateCoerce,
  endAt: dateCoerce,
  location: z.string().trim().optional().nullable(),
  notes: z.string().optional().nullable(),
  ownerId: optionalId,
  leadId: optionalId,
  opportunityId: optionalId,
  contactId: optionalId,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const calendarUpdateSchema = calendarCreateSchema.partial();

export const calendarListQuerySchema = z.object({
  from: dateCoerce.optional(),
  to: dateCoerce.optional(),
  leadId: z.string().optional(),
  type: calendarEventTypeEnum.optional(),
  status: calendarEventStatusEnum.optional(),
});

export type CalendarCreateInput = z.infer<typeof calendarCreateSchema>;
export type CalendarUpdateInput = z.infer<typeof calendarUpdateSchema>;
