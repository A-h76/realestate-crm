import type { IntentType, PropertyPurpose, PropertyType, SizeUnit } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export type ExtractedRequirement = {
  propertyPurpose?: PropertyPurpose;
  propertyTypePref?: PropertyType;
  intentType?: IntentType;
  preferredArea?: string;
  budgetMin?: number;
  budgetMax?: number;
  sizePrefMin?: number;
  sizePrefMax?: number;
  sizeUnitPref?: SizeUnit;
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

const AREAS = [
  "DHA Phase 1", "DHA Phase 2", "DHA Phase 3", "DHA Phase 4", "DHA Phase 5",
  "DHA Phase 6", "DHA Phase 7", "DHA Phase 8", "DHA Phase 9", "DHA Phase 10",
  "DHA Phase 11", "DHA Phase 12", "Bahria Town", "Gulberg", "Johar Town",
  "Model Town", "Wapda Town", "Askari", "Valencia", "Faisal Town", "Cantt",
  "Garden Town", "Iqbal Town", "Township",
];

function toAmount(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === "k" || u === "thousand" || u.startsWith("hazar")) return value * 1_000;
  if (u === "lakh" || u === "lac") return value * 100_000;
  if (u === "crore" || u === "cr") return value * 10_000_000;
  if (u === "m" || u === "million") return value * 1_000_000;
  return value;
}

/**
 * Deterministic Roman Urdu / English keyword extraction for inbound WhatsApp
 * text, e.g. "5 marla house DHA 2 mein rent pe chahiye 80k tak".
 *
 * ponytail: naive regex/keyword matching, not full NLU — will miss unusual
 * phrasing and can't resolve ambiguity an LLM would catch. Upgrade to
 * LLM-assisted extraction only if a pilot shows a real false-negative rate;
 * don't add one speculatively before that.
 */
export function extractRequirement(text: string): ExtractedRequirement {
  const t = text.toLowerCase();
  const out: ExtractedRequirement = {};

  const dhaMatch = t.match(/\bdha\b\s*(?:phase\s*)?(\d{1,2})?/);
  if (dhaMatch) {
    out.preferredArea = dhaMatch[1] ? `DHA Phase ${dhaMatch[1]}` : "DHA";
  } else {
    const area = AREAS.find((a) => t.includes(a.toLowerCase()));
    if (area) out.preferredArea = area;
  }

  if (/\bfarm\s*house\b|\bagricultural\b|\bzarai\b/.test(t)) out.propertyTypePref = "AGRICULTURAL";
  else if (/\bapartment\b|\bflat\b/.test(t)) out.propertyTypePref = "APARTMENT";
  else if (/\bplot\b/.test(t)) out.propertyTypePref = "PLOT";
  else if (/\bcommercial\b|\bshop\b|\bdukan\b|\boffice\b/.test(t)) out.propertyTypePref = "COMMERCIAL";
  else if (/\bhouse\b|\bghar\b|\bmakan\b/.test(t)) out.propertyTypePref = "HOUSE";

  const isRent = /\brent(?:al)?\b|\bkiray/.test(t);
  const isSell = /\bsell(?:ing)?\b|\bbech/.test(t);
  const isBuy = /\bbuy\b|\bpurchase\b|\bkhareed/.test(t);
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

  const sizeMatch = t.match(/(\d+(?:\.\d+)?)\s*(marla|kanal|sq\s?ft|sqft|square\s?feet)/);
  if (sizeMatch) {
    const value = Number(sizeMatch[1]);
    const unit = sizeMatch[2].replace(/\s/g, "");
    out.sizeUnitPref = unit === "marla" ? "MARLA" : unit === "kanal" ? "KANAL" : "SQFT";
    out.sizePrefMin = value;
    out.sizePrefMax = value;
  }

  const bedMatch = t.match(/(\d+)\s*(?:bed(?:room)?s?|bhk)\b/);
  if (bedMatch) out.bedroomPref = Number(bedMatch[1]);

  const moneyMatches = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(lakh|lac|crore|cr|million|m|k|thousand|hazar\w*)\b/g)].map(
    (m) => toAmount(Number(m[1]), m[2]),
  );
  if (moneyMatches.length === 0) {
    const contextMatch =
      t.match(/(?:budget|rs\.?|pkr|₨)\s*[:\-]?\s*(\d[\d,]*)/) ?? t.match(/(\d[\d,]*)\s*(?:tak|tk)\b/);
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
