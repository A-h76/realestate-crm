import { z } from "zod";
import {
  currencyEnum,
  optionalDate,
  optionalId,
  paginationSchema,
  proposalStatusEnum,
} from "./common";

export const proposalCreateSchema = z.object({
  proposalNumber: z.string().trim().min(1).optional(),
  leadId: optionalId,
  opportunityId: optionalId,
  linkedPropertyId: optionalId,
  value: z.coerce.number(),
  currency: currencyEnum.optional(),
  status: proposalStatusEnum.optional(),
  expiryAt: optionalDate,
  attachmentUrl: z.string().trim().optional().nullable(),
  notes: z.string().optional().nullable(),
  ownerId: optionalId,
});

export const proposalUpdateSchema = proposalCreateSchema.partial();

export const proposalListQuerySchema = paginationSchema.extend({
  status: proposalStatusEnum.optional(),
  leadId: z.string().optional(),
  opportunityId: z.string().optional(),
});

export type ProposalCreateInput = z.infer<typeof proposalCreateSchema>;
export type ProposalUpdateInput = z.infer<typeof proposalUpdateSchema>;
