import { z } from "zod";
import { optionalId, paginationSchema } from "./common";

export const accountCreateSchema = z.object({
  company: z.string().trim().min(1),
  website: z.string().trim().optional().nullable(),
  industry: z.string().trim().optional().nullable(),
  companySize: z.string().trim().optional().nullable(),
  locationArea: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  revenueRange: z.string().trim().optional().nullable(),
  ownerId: optionalId,
  notes: z.string().optional().nullable(),
});

export const accountUpdateSchema = accountCreateSchema.partial();

export const accountListQuerySchema = paginationSchema.extend({
  ownerId: z.string().optional(),
  city: z.string().optional(),
});

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;
