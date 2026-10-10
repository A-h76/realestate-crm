import { z } from "zod";
import { ApiError } from "@/lib/errors";

/** US residential lead sources. Mirrors the LeadSource enum in prisma/schema.prisma. */
export const leadSourceEnum = z.enum([
  "ZILLOW",
  "REALTOR_COM",
  "HOMES_COM",
  "WEB_FORM",
  "OPEN_HOUSE",
  "SIGN_CALL",
  "AGENT_REFERRAL",
  "FACEBOOK_ADS",
  "REFERRAL",
  "WALK_IN",
  "COLD_CALL",
  "EXISTING_CLIENT",
  "WHATSAPP_INBOUND",
  "GOOGLE_ADS",
  "PHONE",
  "MANUAL",
  "EMAIL",
  "OTHER",
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
  "SINGLE_FAMILY",
  "CONDO",
  "TOWNHOUSE",
  "MULTI_FAMILY",
  "LAND",
  "COMMERCIAL",
]);

export const propertyPurposeEnum = z.enum(["SALE", "RENT"]);

export const propertyStatusEnum = z.enum([
  "AVAILABLE",
  "RESERVED",
  "SOLD",
  "RENTED",
  "WITHDRAWN",
]);

export const sizeUnitEnum = z.enum(["SQFT", "ACRE", "SQM", "OTHER"]);

export const listingTypeEnum = z.enum(["EXCLUSIVE", "OPEN", "POCKET"]);

export const verificationStatusEnum = z.enum([
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
]);

/** USD only: the product targets the US market (see PRODUCT_DECISION_REGISTER D-01). */
export const currencyEnum = z.enum(["USD"]);

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

/**
 * A phone number as typed. Shape is not validated here — `@/lib/phone` decides validity with
 * the workspace region, and callers store only the canonical E.164 form it returns.
 */
export const optionalPhone = z.string().trim().min(1).optional().nullable();

/**
 * IANA zones covering the US market this product serves. A workspace time zone is chosen
 * from this list rather than accepted as free text: an unrecognized zone would make every
 * date, time and SLA clock in the app silently wrong.
 */
export const US_TIME_ZONES = [
  "America/New_York",
  "America/Detroit",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
] as const;

export const timeZoneEnum = z.enum(US_TIME_ZONES);

/** USPS two-letter state code, upper-cased. */
export const usStateCode = z
  .string()
  .trim()
  .length(2, "State must be a 2-letter US state code")
  .transform((v) => v.toUpperCase());

/** 5-digit or ZIP+4. */
export const usPostalCode = z
  .string()
  .trim()
  .regex(/^\d{5}(-\d{4})?$/, "ZIP code must be 12345 or 12345-6789");

export const optionalId = z.string().min(1).optional().nullable();

export const optionalDecimal = z.coerce.number().optional().nullable();

export const dateCoerce = z.coerce.date();

export const optionalDate = z.coerce.date().optional().nullable();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  sort: z.string().trim().max(64).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

/** Backstop for schemas without per-field .max(): no single string in a JSON body may exceed this. */
export const MAX_FIELD_CHARS = 10_000;

function hasOversizedString(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return value.length > MAX_FIELD_CHARS;
  if (depth > 8 || value === null || typeof value !== "object") return false;
  return Object.values(value).some((item) => hasOversizedString(item, depth + 1));
}

export function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  if (hasOversizedString(data)) {
    throw new ApiError(400, `Text fields are limited to ${MAX_FIELD_CHARS} characters`);
  }
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
