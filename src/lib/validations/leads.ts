import { z } from "zod";
import {
  currencyEnum,
  intentTypeEnum,
  leadSourceEnum,
  leadStageEnum,
  optionalDate,
  optionalDecimal,
  optionalId,
  optionalPhone,
  paginationSchema,
  propertyPurposeEnum,
  propertyTypeEnum,
  sizeUnitEnum,
} from "./common";

export const leadCreateSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().optional().nullable(),
  company: z.string().trim().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: optionalPhone,
  whatsappNumber: optionalPhone,
  website: z.string().trim().optional().nullable(),
  industry: z.string().trim().optional().nullable(),
  companySize: z.string().trim().optional().nullable(),
  source: leadSourceEnum.optional(),
  notes: z.string().optional().nullable(),
  estimatedValue: optionalDecimal,
  currency: currencyEnum.optional(),
  ownerId: optionalId,
  stage: leadStageEnum.optional(),
  accountId: optionalId,
  contactId: optionalId,
  intentType: intentTypeEnum.optional(),
  preferredArea: z.string().trim().optional().nullable(),
  budgetMin: optionalDecimal,
  budgetMax: optionalDecimal,
  propertyPurpose: propertyPurposeEnum.optional().nullable(),
  propertyTypePref: propertyTypeEnum.optional().nullable(),
  sizePrefMin: optionalDecimal,
  sizePrefMax: optionalDecimal,
  sizeUnitPref: sizeUnitEnum.optional().nullable(),
  bedroomPref: z.coerce.number().int().optional().nullable(),
  bathroomPref: z.coerce.number().int().optional().nullable(),
  furnishedPref: z.string().trim().optional().nullable(),
  timeline: z.string().trim().optional().nullable(),
  followUpDue: optionalDate,
  nextAction: z.string().trim().optional().nullable(),
});

export const leadUpdateSchema = leadCreateSchema.partial();

export const leadListQuerySchema = paginationSchema.extend({
  stage: leadStageEnum.optional(),
  source: leadSourceEnum.optional(),
  ownerId: z.string().optional(),
  intentType: intentTypeEnum.optional(),
});

export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;
