import { z } from "zod";
import { optionalId, paginationSchema } from "./common";

export const noteCreateSchema = z.object({
  body: z.string().trim().min(1),
  leadId: optionalId,
  opportunityId: optionalId,
  accountId: optionalId,
  contactId: optionalId,
  propertyId: optionalId,
});

export const noteListQuerySchema = paginationSchema.extend({
  leadId: z.string().optional(),
  opportunityId: z.string().optional(),
  accountId: z.string().optional(),
  contactId: z.string().optional(),
  propertyId: z.string().optional(),
});

export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
