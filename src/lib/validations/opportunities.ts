import { z } from "zod";
import {
  currencyEnum,
  dealSideEnum,
  leadSourceEnum,
  optionalDate,
  optionalId,
  paginationSchema,
} from "./common";

export const opportunityCreateSchema = z.object({
  name: z.string().trim().min(1),
  accountId: optionalId,
  primaryContactId: optionalId,
  leadId: optionalId,
  linkedPropertyId: optionalId,
  dealSide: dealSideEnum,
  value: z.coerce.number(),
  currency: currencyEnum.optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  stageId: z.string().min(1),
  ownerId: optionalId,
  expectedCloseDate: optionalDate,
  source: leadSourceEnum.optional().nullable(),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const opportunityUpdateSchema = opportunityCreateSchema.partial().extend({
  stageId: z.string().min(1).optional(),
  lostReason: z.string().trim().optional().nullable(),
});

export const opportunityStagePatchSchema = z.object({
  stageId: z.string().min(1),
});

export const opportunityListQuerySchema = paginationSchema.extend({
  stageId: z.string().optional(),
  dealSide: dealSideEnum.optional(),
  ownerId: z.string().optional(),
  leadId: z.string().optional(),
});

export type OpportunityCreateInput = z.infer<typeof opportunityCreateSchema>;
export type OpportunityUpdateInput = z.infer<typeof opportunityUpdateSchema>;
