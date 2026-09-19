import { z } from "zod";
import { optionalId, optionalPhone, paginationSchema } from "./common";

export const contactCreateSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().optional().nullable(),
  title: z.string().trim().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: optionalPhone,
  whatsappNumber: optionalPhone,
  accountId: optionalId,
  notes: z.string().optional().nullable(),
});

export const contactUpdateSchema = contactCreateSchema.partial();

export const contactListQuerySchema = paginationSchema.extend({
  accountId: z.string().optional(),
});

export type ContactCreateInput = z.infer<typeof contactCreateSchema>;
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;
