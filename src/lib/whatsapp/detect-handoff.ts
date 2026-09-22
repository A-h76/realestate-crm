export type HandoffReason =
  | "HUMAN_REQUESTED"
  | "SITE_VISIT_REQUESTED"
  | "NEGOTIATION_REQUESTED"
  | "HUMAN_REQUIRED_FOR_PROPERTY_DETAILS"
  | "INFORMATION_UNAVAILABLE"
  | "HIGH_INTENT"
  | "LOW_CONFIDENCE_OR_FAILED_ASSISTANCE"
  | "NO_GROUNDED_INVENTORY_MATCH"
  | "CONFLICTING_OR_UNCERTAIN_INVENTORY"
  | "UNSUPPORTED_OR_AMBIGUOUS_REQUEST";

export type HandoffConfidence = "HIGH" | "MEDIUM" | "LOW";

export type SuggestedAction =
  | "CONTACT_LEAD"
  | "SCHEDULE_SITE_VISIT"
  | "HUMAN_NEGOTIATION"
  | "AGENT_REVIEW"
  | "REVIEW_ALTERNATIVES";

export type HandoffDetection =
  | { shouldHandoff: true; reason: HandoffReason; confidence: HandoffConfidence; suggestedAction: SuggestedAction }
  | { shouldHandoff: false };

export type HandoffContext = {
  /** Most recent prior inbound message from the same lead, if any. */
  previousMessage?: string | null;
};

export const HANDOFF_REASON_LABELS: Record<HandoffReason, string> = {
  HUMAN_REQUESTED: "Customer requested a human agent",
  SITE_VISIT_REQUESTED: "Site visit requested",
  NEGOTIATION_REQUESTED: "Price negotiation requested",
  HUMAN_REQUIRED_FOR_PROPERTY_DETAILS: "Owner / document / legal question",
  INFORMATION_UNAVAILABLE: "Requested information is not available in the CRM",
  HIGH_INTENT: "High buying/renting intent",
  LOW_CONFIDENCE_OR_FAILED_ASSISTANCE: "Conversation needs human attention",
  NO_GROUNDED_INVENTORY_MATCH: "No grounded inventory match for the stated requirement",
  CONFLICTING_OR_UNCERTAIN_INVENTORY: "Property status is uncertain — needs confirmation before answering",
  UNSUPPORTED_OR_AMBIGUOUS_REQUEST: "Request is ambiguous, unsupported, or needs business judgment",
};

export const SUGGESTED_ACTION_LABELS: Record<SuggestedAction, string> = {
  CONTACT_LEAD: "Contact lead",
  SCHEDULE_SITE_VISIT: "Schedule site visit",
  HUMAN_NEGOTIATION: "Human negotiation",
  AGENT_REVIEW: "Agent review",
  REVIEW_ALTERNATIVES: "Suggest suitable alternatives or confirm availability with the customer/owner",
};

const RULES: Array<{ reason: HandoffReason; suggestedAction: SuggestedAction; confidence: HandoffConfidence; pattern: RegExp }> = [
  {
    reason: "HUMAN_REQUESTED",
    suggestedAction: "CONTACT_LEAD",
    confidence: "HIGH",
    pattern:
      /\bagent\b.*\b(baat|bula)\b|\bcall\s*karwa\b|\b(talk|speak)\s*to\s*(?:an?\s*)?(?:agent|someone|human|representative)\b|\bkisi\s*(?:agent\s*)?se\s*baat\s*karni\b|\bconnect\s*me\s*(?:to|with)\s*(?:an?\s*)?agent\b/i,
  },
  {
    reason: "HUMAN_REQUIRED_FOR_PROPERTY_DETAILS",
    suggestedAction: "AGENT_REVIEW",
    confidence: "HIGH",
    pattern:
      /\bowner\b|\bdocuments?\b|\bregistry\b|\bownership\b|\blegal\b|\btitle\s*transfer\b|\bgenuine\b|\bverif\w*\b|\bloan\b|\bmortgage\b|\bfinancing\b/i,
  },
  {
    reason: "SITE_VISIT_REQUESTED",
    suggestedAction: "SCHEDULE_SITE_VISIT",
    confidence: "HIGH",
    pattern: /\bvisit\b|\bviewing\b|\bdekhni\b|\bdekhna\b|\bdekh\s*sakte\b/i,
  },
  {
    reason: "INFORMATION_UNAVAILABLE",
    suggestedAction: "AGENT_REVIEW",
    confidence: "MEDIUM",
    pattern: /\blatest\s*availability\b|\bavailability\s*confirm\b|\bnegotiable\s*kitna\b|\bexact\s*(?:size|address|documents?)\b/i,
  },
  {
    reason: "NEGOTIATION_REQUESTED",
    suggestedAction: "HUMAN_NEGOTIATION",
    confidence: "HIGH",
    pattern:
      /\bfinal\s*price\b|\blast\s*price\b|\bthora\s*kam\b|\bkam\s*ho\s*sakta\b|\bho\s*jayega\b|\bnegotiable\b|\bkarwa\s*do\b|\bkarwado\b|\bdiscount\b|\bkam\s*karo\b|\bkam\s*kar\s*den\b/i,
  },
  {
    // Business-judgment requests the AI must not decide on its own: recommending
    // an alternative area/best-fit, or an ambiguous cancel/withdraw request whose
    // target (viewing, offer, reservation, inquiry) is unclear.
    reason: "UNSUPPORTED_OR_AMBIGUOUS_REQUEST",
    suggestedAction: "AGENT_REVIEW",
    confidence: "MEDIUM",
    pattern:
      /\bcancel\b|\bwithdraw\b|\bbest\s*area\b|\bkonsa\s*area\b|\bkonsi\s*area\b|\balternative\s*area\b|\bdoosri\s*jagah\b|\bkoi\s*aur\s*(?:area|jagah)\b/i,
  },
  {
    reason: "HIGH_INTENT",
    suggestedAction: "AGENT_REVIEW",
    confidence: "MEDIUM",
    pattern: /\bbook(?:ing)?\b|\btoken\b|\bdeal\s*final\b|\bfinal\s*karna\b|\bagreement\b|\badvance\s*dena\b/i,
  },
];

// ponytail: a handful of short, exact continuation tokens — enough to cover
// "kal?" following a site-visit ask without building real conversation memory.
const CONTINUATION_RE = /^(kal|kab|kb|ok|okay|haan|ji|confirm|done|theek\s*hai)\??\.?$/i;

const FRUSTRATION_RE =
  /\bconfus(?:ed|ing)\b|\bsamajh\s*nahi\b|\bnahi\s*samajh\b|\bkoi\s*jawab\s*nahi\b|\?{2,}|\b(?:3rd|third)\s*time\b|\bkitni\s*dafa\b/i;

function matchDirect(message: string): HandoffDetection {
  for (const rule of RULES) {
    if (rule.pattern.test(message)) {
      return { shouldHandoff: true, reason: rule.reason, confidence: rule.confidence, suggestedAction: rule.suggestedAction };
    }
  }
  return { shouldHandoff: false };
}

/**
 * Deterministic, rule-based handoff trigger. No LLM: a fixed set of
 * Roman Urdu / English keyword patterns, checked in priority order so the
 * more specific/actionable category wins on overlap (e.g. "owner se baat
 * karwa dein" is a document/ownership question, not a generic negotiation).
 */
export function detectHandoff(message: string, context: HandoffContext = {}): HandoffDetection {
  const text = message.trim();
  if (!text) return { shouldHandoff: false };

  const direct = matchDirect(text);
  if (direct.shouldHandoff) return direct;

  const previous = context.previousMessage?.trim();
  if (previous) {
    if (CONTINUATION_RE.test(text)) {
      const carriedOver = matchDirect(previous);
      if (carriedOver.shouldHandoff) {
        return { ...carriedOver, confidence: "MEDIUM" };
      }
    }
    if (previous.toLowerCase() === text.toLowerCase()) {
      return {
        shouldHandoff: true,
        reason: "LOW_CONFIDENCE_OR_FAILED_ASSISTANCE",
        confidence: "LOW",
        suggestedAction: "AGENT_REVIEW",
      };
    }
  }

  if (FRUSTRATION_RE.test(text)) {
    return {
      shouldHandoff: true,
      reason: "LOW_CONFIDENCE_OR_FAILED_ASSISTANCE",
      confidence: "LOW",
      suggestedAction: "AGENT_REVIEW",
    };
  }

  return { shouldHandoff: false };
}
