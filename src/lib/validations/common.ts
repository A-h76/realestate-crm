import { z } from "zod";
import { ApiError } from "@/lib/errors";

export const leadSourceEnum = z.enum([
  "ZAMEEN",
  "FACEBOOK_ADS",
  "REFERRAL",
  "WALK_IN",
  "SIGNBOARD",
  "WHATSAPP_INBOUND",
  "COLD_CALL",
  "EXISTING_CLIENT",
]);

export const leadStageEnum = z.enum([
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "NURTURING",
  "CONVERTED",
  "LOST",
  "ARCHIVED",
]);

export const intentTypeEnum = z.enum(["BUY", "SELL", "RENT", "INVEST", "UNKNOWN"]);

export const propertyTypeEnum = z.enum([
  "PLOT",
  "HOUSE",
  "APARTMENT",
  "COMMERCIAL",
  "AGRICULTURAL",
]);

export const propertyPurposeEnum = z.enum(["SALE", "RENT"]);

export const propertyStatusEnum = z.enum([
  "AVAILABLE",
  "RESERVED",
  "SOLD",
  "RENTED",
  "WITHDRAWN",
]);

export const sizeUnitEnum = z.enum(["MARLA", "KANAL", "SQFT", "OTHER"]);

export const listingTypeEnum = z.enum(["EXCLUSIVE", "OPEN", "POCKET"]);

export const verificationStatusEnum = z.enum([
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
]);

export const currencyEnum = z.enum(["PKR", "USD"]);

export const dealSideEnum = z.enum(["BUYER", "SELLER"]);

export const activityTypeEnum = z.enum([
  "CALL",
  "WHATSAPP_MESSAGE",
  "EMAIL",
  "SITE_VISIT",
  "MEETING",
  "NOTE",
  "TASK",
  "FOLLOW_UP",
  "STAGE_CHANGE",
  "SYSTEM",
]);

export const activityStatusEnum = z.enum([
  "PLANNED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export const taskStatusEnum = z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]);

export const taskPriorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export const proposalStatusEnum = z.enum([
  "DRAFT",
  "SENT",
  "VIEWED",
  "NEGOTIATION",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
]);

export const calendarEventTypeEnum = z.enum([
  "MEETING",
  "SITE_VISIT",
  "FOLLOW_UP",
  "CALL",
  "OTHER",
]);

export const calendarEventStatusEnum = z.enum([
  "SCHEDULED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export const optionalPhone = z.string().trim().min(1).optional().nullable();

export const optionalId = z.string().min(1).optional().nullable();

export const optionalDecimal = z.coerce.number().optional().nullable();

export const dateCoerce = z.coerce.date();

export const optionalDate = z.coerce.date().optional().nullable();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
  sort: z.string().trim().optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid request body";
    throw new ApiError(400, message);
  }
  return result.data;
}

export function parseQuery<T>(schema: z.ZodType<T>, searchParams: URLSearchParams): T {
  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  const result = schema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid query parameters";
    throw new ApiError(400, message);
  }
  return result.data;
}

export function paginationSkipTake(input: PaginationInput) {
  return {
    skip: (input.page - 1) * input.pageSize,
    take: input.pageSize,
  };
}
