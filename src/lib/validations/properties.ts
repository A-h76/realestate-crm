import { z } from "zod";
import {
  currencyEnum,
  listingTypeEnum,
  optionalDate,
  optionalDecimal,
  optionalId,
  paginationSchema,
  propertyPurposeEnum,
  propertyStatusEnum,
  propertyTypeEnum,
  sizeUnitEnum,
  verificationStatusEnum,
} from "./common";

export const propertyCreateSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  area: z.string().trim().optional().nullable(),
  city: z.string().trim().optional(),
  propertyType: propertyTypeEnum,
  purpose: propertyPurposeEnum,
  size: optionalDecimal,
  sizeUnit: sizeUnitEnum.optional(),
  bedrooms: z.coerce.number().int().optional().nullable(),
  bathrooms: z.coerce.number().int().optional().nullable(),
  furnishedStatus: z.string().trim().optional().nullable(),
  price: z.coerce.number(),
  currency: currencyEnum.optional(),
  status: propertyStatusEnum.optional(),
  listingType: listingTypeEnum.optional(),
  ownerContactId: optionalId,
  assignedAgentId: optionalId,
  listingSource: z.string().trim().optional().nullable(),
  verificationStatus: verificationStatusEnum.optional(),
  dateListed: optionalDate,
});

export const propertyUpdateSchema = propertyCreateSchema.partial();

export const propertyListQuerySchema = paginationSchema.extend({
  status: propertyStatusEnum.optional(),
  propertyType: propertyTypeEnum.optional(),
  purpose: propertyPurposeEnum.optional(),
  area: z.string().optional(),
  city: z.string().optional(),
  assignedAgentId: z.string().optional(),
});

export type PropertyCreateInput = z.infer<typeof propertyCreateSchema>;
export type PropertyUpdateInput = z.infer<typeof propertyUpdateSchema>;
