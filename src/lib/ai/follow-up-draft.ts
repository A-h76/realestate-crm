import { formatMoney } from "@/lib/format";
import { filterAndScoreProperties, type ScoredPropertyMatch } from "@/lib/matching/properties";
import { describeMatchAreas } from "@/lib/whatsapp/conversation-intelligence";
import { loadLeadContext, leadDisplayName } from "./context";
import {
  followUpDraftSchema,
  parseAiOutput,
  type FollowUpDraft,
} from "./schemas";
import { storeIntelligenceRun } from "./store";

export type DraftChannel = FollowUpDraft["channel"];

/** "2 single-family options", "1 condo option" — reads as an agent would write it. */
function propertyNoun(type: string | null | undefined, count: number): string {
  const label = type ? type.toLowerCase().replaceAll("_", "-") : "listing";
  return `${label} ${count === 1 ? "option" : "options"}`;
}

/** Count and location come only from the shortlisted records (see describeMatchAreas), never from the lead's preferred area. */
function textDraft(name: string, shortlist: ScoredPropertyMatch[]): string {
  const n = shortlist.length;
  if (n === 0) {
    return `Hi ${name}, none of our current listings match what you're looking for yet. I'll send new options as soon as they hit the market.`;
  }
  const areas = describeMatchAreas(shortlist);
  const options = n === 1 ? "option" : "options";
  const where = areas && "single" in areas ? ` in ${areas.single}` : "";
  const tail = areas && "breakdown" in areas ? ` (${areas.breakdown})` : "";
  return `Hi ${name}, I pulled ${n} ${options}${where} that fit what you described${tail}. Want me to send the details?`;
}

export async function draftFollowUp(input: {
  workspaceId: string;
  leadId: string;
  actorId?: string | null;
  channel: DraftChannel;
}) {
  const ctx = await loadLeadContext(input.workspaceId, input.leadId);
  if (!ctx) return null;

  const name = ctx.lead.firstName;
  const matches = filterAndScoreProperties(ctx.lead, ctx.properties);
  const shortlist = matches.slice(0, 2);
  const shortlistAreas = describeMatchAreas(shortlist);
  const visit = ctx.calendarEvents.find((e) => e.type === "SITE_VISIT" && e.status === "SCHEDULED");
  const nba = ctx.lead.nextAction;

  let body: string;
  let subject: string | null = null;

  if (input.channel === "WHATSAPP") {
    body = visit
      ? `Hi ${name}, confirming your showing — want me to send the listing notes ahead of it?`
      : textDraft(name, shortlist);
  } else if (input.channel === "EMAIL") {
    subject = `${shortlistAreas && "single" in shortlistAreas ? shortlistAreas.single : "Listing"} options for ${leadDisplayName(ctx.lead)}`;
    body = [
      `Hi ${leadDisplayName(ctx.lead)},`,
      "",
      shortlist.length === 0
        ? "Following up on our conversation — none of our current listings match your criteria yet, and I'll send new options as they come on the market."
        : `Following up on our conversation, I've shortlisted ${shortlist.length} ${propertyNoun(ctx.lead.propertyTypePref, shortlist.length)}${shortlistAreas && "single" in shortlistAreas ? ` in ${shortlistAreas.single}` : shortlistAreas ? ` (${shortlistAreas.breakdown})` : ""}${ctx.lead.budgetMax ? ` under ${formatMoney(Number(ctx.lead.budgetMax))}` : ""}.`,
      "",
      nba ? `Suggested next step: ${nba}.` : "Suggested next step: a quick showing.",
      "",
      "Let me know a time that works for you.",
      "",
      "Best regards",
    ].join("\n");
  } else {
    body = `Hi ${name} — sharing a short ${ctx.lead.preferredArea ?? "local"} shortlist matched to what you're looking for. Open to a 15-minute walkthrough this week?`;
  }

  const kind =
    input.channel === "EMAIL"
      ? "EMAIL_DRAFT"
      : input.channel === "LINKEDIN"
        ? "LINKEDIN_DRAFT"
        : "FOLLOW_UP_DRAFT";

  const output = parseAiOutput(followUpDraftSchema, {
    channel: input.channel,
    language: "EN",
    subject,
    body,
    rationale: "Drafted from CRM stage, property matches, and last conversation. Not sent.",
    requiresApproval: true,
  });

  const run = await storeIntelligenceRun({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    kind,
    entityType: "Lead",
    entityId: ctx.lead.id,
    leadId: ctx.lead.id,
    output,
    confidence: 80,
    status: "PENDING",
  });

  return { run, output, lead: ctx.lead };
}
