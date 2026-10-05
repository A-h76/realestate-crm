import type { IntentType, PropertyPurpose } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import type { propertyTypeEnum, sizeUnitEnum } from "@/lib/validations/common";

/**
 * Typed against the *application* enums (src/lib/validations/common.ts), not Prisma's.
 */
export type ExtractedRequirement = {
  propertyPurpose?: PropertyPurpose;
  propertyTypePref?: z.infer<typeof propertyTypeEnum>;
  intentType?: IntentType;
  preferredArea?: string;
  budgetMin?: number;
  budgetMax?: number;
  sizePrefMin?: number;
  sizePrefMax?: number;
  sizeUnitPref?: z.infer<typeof sizeUnitEnum>;
  bedroomPref?: number;
};

/** Fields extraction can fill, in the shape a Lead row (or a partial select of one) carries them. */
export const REQUIREMENT_FIELDS = [
  "propertyPurpose",
  "propertyTypePref",
  "intentType",
  "preferredArea",
  "budgetMin",
  "budgetMax",
  "sizePrefMin",
  "sizePrefMax",
  "sizeUnitPref",
  "bedroomPref",
] as const;

export type RequirementSnapshot = Record<(typeof REQUIREMENT_FIELDS)[number], unknown>;

function isBlank(field: (typeof REQUIREMENT_FIELDS)[number], value: unknown) {
  return field === "intentType" ? value === "UNKNOWN" : value == null;
}

/**
 * Fills only currently-blank requirement fields on a Lead from a new
 * extraction — confirmed fields are never overwritten. Shared by every
 * inbound-message entry point (real Meta webhook, conversation orchestrator)
 * so "fill blank fields only" has exactly one implementation.
 */
export async function applyRequirementUpdate(
  workspaceId: string,
  leadId: string,
  current: RequirementSnapshot,
  extracted: ExtractedRequirement,
): Promise<void> {
  const fill: Partial<ExtractedRequirement> = {};
  for (const field of REQUIREMENT_FIELDS) {
    const value = extracted[field];
    if (value != null && isBlank(field, current[field])) {
      (fill as Record<string, unknown>)[field] = value;
    }
  }
  if (Object.keys(fill).length === 0) return;

  await prisma.lead.updateMany({ where: { id: leadId, workspaceId }, data: fill });
  await writeAudit({
    workspaceId,
    action: "LEAD_UPDATED",
    entity: "Lead",
    entityId: leadId,
    metadata: { fields: Object.keys(fill), source: "whatsapp_extraction" },
  });
}

/**
 * Converts a US money shorthand to dollars: "400k", "1.2m" or "$1,250,000".
 */
function toAmount(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === "k" || u === "thousand") return value * 1_000;
  if (u === "m" || u === "mm" || u === "million") return value * 1_000_000;
  return value;
}

/**
 * Deterministic keyword extraction for inbound customer text, e.g.
 * "looking for a 3 bed townhouse in Lincoln Park to rent, up to $3,200/mo".
 *
 * Neighborhood/city is taken from the message's own words rather than matched against a
 * fixed list: every workspace serves different metros. A free-text capture after a
 * locational preposition is market-independent, and the matcher scores area as a fuzzy
 * string anyway.
 *
 * ponytail: naive regex/keyword matching, not full NLU — will miss unusual phrasing and
 * can't resolve ambiguity an LLM would catch. The AI assist path in
 * conversation-intelligence.ts already covers the UNKNOWN-intent fallback; upgrade this to
 * LLM-first extraction only if a pilot shows a real false-negative rate.
 */
/**
 * Words that a one-word reply could be but that are never a place: property types, purposes,
 * confirmations and greetings. Without this guard, answering the type question with
 * "Townhouse" would be stored as the customer's preferred neighborhood.
 */
const NON_PLACE_ANSWER =
  /^(?:single[\s-]?family|house|home|condo|condominium|townhouse|townhome|rowhouse|multi[\s-]?family|duplex|triplex|land|lot|commercial|retail|office|warehouse|buy|buying|sell|selling|rent|rental|renting|lease|yes|yeah|yep|no|nope|ok|okay|sure|thanks|thank\s+you|hi|hello|hey|good\s+(?:morning|afternoon|evening)|maybe|both|either|any|none)$/i;

export function extractRequirement(text: string): ExtractedRequirement {
  const t = text.toLowerCase();
  const out: ExtractedRequirement = {};

  // "in Lincoln Park", "around Austin", "near Buckhead" — stop at a clause boundary or at a
  // word that starts a different part of the requirement, so we don't swallow the budget.
  const areaMatch = text.match(
    /\b(?:in|around|near|close to|within)\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})/,
  );
  if (areaMatch) {
    const candidate = areaMatch[1].trim().replace(/\s+(?:for|under|up|to|with|and)$/i, "");
    if (candidate.length > 1) out.preferredArea = candidate;
  } else {
    // A bare place name, which is how people answer "which neighborhood are you looking in?".
    // Only accepted when the whole message is one to three capitalized words carrying no other
    // requirement signal, so an answer like "Townhouse" or "Rent" is never stored as a location.
    const bare = text.trim().replace(/[.!?,]+$/, "");
    const isBarePlace =
      /^[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2}$/.test(bare) &&
      !/\d/.test(bare) &&
      !NON_PLACE_ANSWER.test(bare);
    if (isBarePlace) out.preferredArea = bare;
  }

  if (/\bmulti[\s-]?family\b|\bduplex\b|\btriplex\b|\bfourplex\b|\b\d\s*unit\b/.test(t)) out.propertyTypePref = "MULTI_FAMILY";
  else if (/\bcondos?\b|\bcondominiums?\b/.test(t)) out.propertyTypePref = "CONDO";
  else if (/\btown\s?(house|home)s?\b|\browhouses?\b/.test(t)) out.propertyTypePref = "TOWNHOUSE";
  else if (/\b(vacant\s+)?land\b|\blots?\b|\bacreage\b/.test(t)) out.propertyTypePref = "LAND";
  else if (/\bcommercial\b|\bretail\b|\bstorefront\b|\boffice\s+space\b|\bwarehouse\b/.test(t)) out.propertyTypePref = "COMMERCIAL";
  else if (/\bsingle[\s-]?family\b|\bhouses?\b|\bhomes?\b|\bsfh\b|\bdetached\b/.test(t)) out.propertyTypePref = "SINGLE_FAMILY";

  const isRent = /\brent(?:al|ing)?\b|\blease\b|\bleasing\b|\bper\s+month\b|\/mo\b/.test(t);
  const isSell = /\bsell(?:ing)?\b|\blist(?:ing)?\s+my\b|\bput\s+my\s+(house|home|condo)\b/.test(t);
  const isBuy = /\bbuy(?:ing)?\b|\bpurchas(?:e|ing)\b|\bpre[\s-]?approved\b|\bclosing\b/.test(t);
  if (isRent) {
    out.propertyPurpose = "RENT";
    out.intentType = "RENT";
  } else if (isSell) {
    out.propertyPurpose = "SALE";
    out.intentType = "SELL";
  } else if (isBuy) {
    out.propertyPurpose = "SALE";
    out.intentType = "BUY";
  }

  // Square feet, or acres for land. Commas are allowed: "2,400 sq ft".
  const sqftMatch = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s?(?:ft|feet)|sqft|square\s?(?:ft|feet))/);
  const acreMatch = t.match(/(\d+(?:\.\d+)?)\s*acres?\b/);
  if (sqftMatch) {
    const value = Number(sqftMatch[1].replace(/,/g, ""));
    out.sizeUnitPref = "SQFT";
    out.sizePrefMin = value;
    out.sizePrefMax = value;
  } else if (acreMatch) {
    const value = Number(acreMatch[1]);
    out.sizeUnitPref = "ACRE";
    out.sizePrefMin = value;
    out.sizePrefMax = value;
  }

  const bedMatch = t.match(/(\d+)\s*(?:bed(?:room)?s?|br|bd)\b/);
  if (bedMatch) out.bedroomPref = Number(bedMatch[1]);

  // Figures that are sizes or room counts are stripped before any money parsing, so
  // "around 1,600 sq ft" and "3 bedrooms" can never be read as a budget — the word "around"
  // on its own was otherwise enough to turn a square-footage figure into a price.
  const moneyText = t
    .replace(/\d[\d,]*(?:\.\d+)?\s*(?:sq\.?\s?(?:ft|feet)|sqft|square\s?(?:ft|feet)|acres?)/g, " ")
    .replace(/\d+\s*(?:bed(?:room)?s?|bath(?:room)?s?|br|bd|ba)\b/g, " ");

  // "400k", "1.2m", "$1.5 million", then bare dollar amounts, then a figure introduced by a
  // budget word. Each tier only runs when the previous one found nothing.
  const moneyMatches = [...moneyText.matchAll(/\$?\s*(\d+(?:\.\d+)?)\s*(million|thousand|mm|m|k)\b/g)].map((m) =>
    toAmount(Number(m[1]), m[2]),
  );
  if (moneyMatches.length === 0) {
    for (const m of moneyText.matchAll(/\$\s*(\d[\d,]*(?:\.\d+)?)/g)) {
      moneyMatches.push(Number(m[1].replace(/,/g, "")));
    }
  }
  if (moneyMatches.length === 0) {
    const contextMatch =
      moneyText.match(/(?:budget|price\s+range|around|up\s+to|under|max(?:imum)?)\s*(?:of|is|:|-)?\s*\$?\s*(\d[\d,]*)/) ??
      moneyText.match(/(\d[\d,]*)\s*(?:or\s+(?:less|under)|max)\b/);
    if (contextMatch) moneyMatches.push(Number(contextMatch[1].replace(/,/g, "")));
  }
  if (moneyMatches.length === 1) {
    out.budgetMax = moneyMatches[0];
  } else if (moneyMatches.length > 1) {
    out.budgetMin = Math.min(...moneyMatches);
    out.budgetMax = Math.max(...moneyMatches);
  }

  return out;
}
