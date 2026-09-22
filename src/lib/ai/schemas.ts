import { z } from "zod";

export const AI_MODEL = "synas-demo-deterministic";
export const AI_PROMPT_VERSION = "synas-intel-v1";

export const leadAnalysisSchema = z.object({
  fitScore: z.number().int().min(0).max(100),
  intentScore: z.number().int().min(0).max(100),
  valueScore: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  niche: z.string().min(1),
  likelyNeed: z.string().min(1),
  painPoints: z.array(z.string()).max(8),
  recommendedAction: z.string().min(1),
  reasoning: z.string().min(1),
});

export const callPreparationSchema = z.object({
  leadSummary: z.string(),
  buyerSellerContext: z.string(),
  previousInteractions: z.array(z.string()).max(12),
  whatsappSummary: z.string(),
  propertyInformation: z.string(),
  knownNeeds: z.array(z.string()).max(8),
  painPoints: z.array(z.string()).max(8),
  questions: z.array(z.string()).max(10),
  objections: z.array(z.string()).max(8),
  recommendedNextStep: z.string(),
  propertyMatchIds: z.array(z.string()).max(8),
});

export const siteVisitPreparationSchema = callPreparationSchema.extend({
  visitLogistics: z.string(),
  onSiteTalkingPoints: z.array(z.string()).max(8),
});

export const followUpDraftSchema = z.object({
  channel: z.enum(["WHATSAPP", "EMAIL", "LINKEDIN"]),
  language: z.enum(["EN", "UR_EN"]),
  subject: z.string().nullable(),
  body: z.string().min(1),
  rationale: z.string(),
  requiresApproval: z.literal(true),
});

export const opportunitySummarySchema = z.object({
  summary: z.string(),
  valueNarrative: z.string(),
  stageRisk: z.string(),
  recommendedAction: z.string(),
  blockers: z.array(z.string()).max(8),
});

export const lostDealAnalysisSchema = z.object({
  likelyReason: z.string(),
  contributingFactors: z.array(z.string()).max(8),
  recoverable: z.boolean(),
  recommendedRecovery: z.string(),
  lessons: z.array(z.string()).max(6),
});

export const propertyMatchExplainSchema = z.object({
  propertyId: z.string(),
  matchScore: z.number().int().min(0).max(100),
  why: z.array(
    z.object({
      factor: z.string(),
      detail: z.string(),
    }),
  ),
  caution: z.string().nullable(),
});

export const propertyMatchBundleSchema = z.object({
  matches: z.array(propertyMatchExplainSchema).max(8),
  summary: z.string(),
});

export const proposalSummarySchema = z.object({
  summary: z.string(),
  highlights: z.array(z.string()).max(8),
  followUp: z.string(),
});

/**
 * Structured output contract for AI-assisted WhatsApp requirement extraction
 * (src/lib/whatsapp/conversation-intelligence.ts). Only used when the
 * deterministic extractor (extract-requirement.ts) finds nothing in an
 * ambiguous message. The model may only ever populate requirement fields —
 * never property facts (price, availability, owner, etc.) — those stay
 * grounded in the database.
 */
export const conversationAssistSchema = z.object({
  intent: z.enum([
    "GREETING",
    "PROPERTY_REQUIREMENT",
    "PROPERTY_PRICE",
    "PROPERTY_LOCATION",
    "PROPERTY_PHOTOS",
    "PROPERTY_AVAILABILITY",
    "CONFIRMATION",
    "UNKNOWN",
  ]),
  extractedRequirements: z
    .object({
      propertyPurpose: z.enum(["SALE", "RENT"]).nullable().optional(),
      propertyTypePref: z.enum(["PLOT", "HOUSE", "APARTMENT", "COMMERCIAL", "AGRICULTURAL"]).nullable().optional(),
      preferredArea: z.string().max(80).nullable().optional(),
      budgetMin: z.number().nonnegative().nullable().optional(),
      budgetMax: z.number().nonnegative().nullable().optional(),
      sizePrefMin: z.number().nonnegative().nullable().optional(),
      sizePrefMax: z.number().nonnegative().nullable().optional(),
      sizeUnitPref: z.enum(["MARLA", "KANAL", "SQFT", "OTHER"]).nullable().optional(),
      bedroomPref: z.number().int().nonnegative().nullable().optional(),
    })
    .partial(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
});

export type ConversationAssistOutput = z.infer<typeof conversationAssistSchema>;

export type LeadAnalysis = z.infer<typeof leadAnalysisSchema>;
export type CallPreparation = z.infer<typeof callPreparationSchema>;
export type SiteVisitPreparation = z.infer<typeof siteVisitPreparationSchema>;
export type FollowUpDraft = z.infer<typeof followUpDraftSchema>;
export type OpportunitySummary = z.infer<typeof opportunitySummarySchema>;
export type LostDealAnalysis = z.infer<typeof lostDealAnalysisSchema>;
export type PropertyMatchBundle = z.infer<typeof propertyMatchBundleSchema>;
export type ProposalSummary = z.infer<typeof proposalSummarySchema>;

export function parseAiOutput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "AI output failed validation";
    throw new Error(message);
  }
  return result.data;
}
