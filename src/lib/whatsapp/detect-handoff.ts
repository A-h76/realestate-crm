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
  SITE_VISIT_REQUESTED: "Showing requested",
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
  SCHEDULE_SITE_VISIT: "Schedule showing",
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
      /\b(?:talk|speak|chat)\s*(?:to|with)\s*(?:an?\s*)?(?:agent|realtor|someone|a\s*human|human|person|representative|rep)\b|\bconnect\s*me\s*(?:to|with)\b|\bcall\s*me\b|\bhave\s*(?:an?\s*)?(?:agent|realtor|someone)\s*call\b|\breal\s*person\b/i,
  },
  {
    reason: "HUMAN_REQUIRED_FOR_PROPERTY_DETAILS",
    suggestedAction: "AGENT_REVIEW",
    confidence: "HIGH",
    pattern:
      /\b(?:seller|owner|landlord)\b|\bdocuments?\b|\bdisclosures?\b|\bdeed\b|\btitle\b|\bsurvey\b|\binspection\b|\bappraisal\b|\bescrow\b|\bhoa\b|\bcontingenc\w*\b|\blegal\b|\bverif\w*\b|\bloan\b|\bmortgage\b|\bfinancing\b|\bpre[\s-]?approv\w*\b|\bclosing\s*costs?\b|\bproperty\s*tax\w*\b/i,
  },
  {
    reason: "SITE_VISIT_REQUESTED",
    suggestedAction: "SCHEDULE_SITE_VISIT",
    confidence: "HIGH",
    pattern:
      /\bshowing\b|\btour\b|\bwalk[\s-]?through\b|\bviewing\b|\bvisit\b|\bopen\s*house\b|\bsee\s*(?:it|the\s*(?:place|house|home|unit|condo|property|listing))\b|\bcome\s*(?:by|see|look)\b|\btake\s*a\s*look\s*(?:at|in\s*person)\b/i,
  },
  {
    reason: "INFORMATION_UNAVAILABLE",
    suggestedAction: "AGENT_REVIEW",
    confidence: "MEDIUM",
    pattern: /\blatest\s*availability\b|\bconfirm\s*availability\b|\bexact\s*(?:square\s*footage|size|address|documents?|lot\s*size)\b|\bhow\s*negotiable\b/i,
  },
  {
    reason: "NEGOTIATION_REQUESTED",
    suggestedAction: "HUMAN_NEGOTIATION",
    confidence: "HIGH",
    pattern:
      /\bfinal\s*price\b|\bbest\s*(?:price|offer)\b|\bnegotiable\b|\bcome\s*down\b|\blower\s*(?:the\s*)?price\b|\bdiscount\b|\bmake\s*an?\s*offer\b|\bcounter(?:offer)?\b|\bbelow\s*asking\b|\broom\s*(?:to\s*(?:move|negotiate)|on\s*(?:the\s*)?price)\b|\bseller\s*credit\b/i,
  },
  {
    // Business-judgment requests the AI must not decide on its own: recommending
    // an alternative area/best-fit, or an ambiguous cancel/withdraw request whose
    // target (viewing, offer, reservation, inquiry) is unclear.
    reason: "UNSUPPORTED_OR_AMBIGUOUS_REQUEST",
    suggestedAction: "AGENT_REVIEW",
    confidence: "MEDIUM",
    pattern:
      /\bcancel\b|\bwithdraw\b|\bback\s*out\b|\bbest\s*(?:area|neighborhood|school\s*district)\b|\bwhich\s*(?:area|neighborhood)\b|\balternative\s*(?:area|neighborhood)\b|\bsomewhere\s*else\b|\bany(?:where)?\s*other\s*(?:area|neighborhood)\b/i,
  },
  {
    reason: "HIGH_INTENT",
    suggestedAction: "AGENT_REVIEW",
    confidence: "MEDIUM",
    pattern: /\bwrite\s*(?:an?\s*)?offer\b|\bput\s*in\s*an?\s*offer\b|\bearnest\s*money\b|\bdeposit\b|\bpurchase\s*agreement\b|\blease\s*agreement\b|\bsign\s*(?:the\s*)?(?:contract|lease|paperwork)\b|\bready\s*to\s*(?:buy|move\s*forward|sign)\b|\bapplication\b/i,
  },
];

// ponytail: a handful of short, exact continuation tokens — enough to cover a bare
// "tomorrow?" following a showing request without building real conversation memory.
const CONTINUATION_RE =
  /^(tomorrow|today|tonight|when|what\s*time|ok|okay|sure|yes|yeah|confirm|confirmed|done|sounds\s*good)\??\.?$/i;

const FRUSTRATION_RE =
  /\bconfus(?:ed|ing)\b|\bdon'?t\s*understand\b|\bnot\s*(?:making\s*sense|helpful)\b|\bno\s*(?:one|body)\s*(?:has\s*)?(?:answered|replied|got(?:ten)?\s*back)\b|\bstill\s*waiting\b|\?{2,}|\b(?:3rd|third)\s*time\b|\bhow\s*many\s*times\b|\bthis\s*is\s*ridiculous\b/i;

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
 * US English keyword patterns, checked in priority order so the
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
