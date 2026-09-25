import { formatCurrency } from "@/lib/format";
import { filterAndScoreProperties, type ScoredPropertyMatch } from "@/lib/matching/properties";
import { describeMatchAreas } from "@/lib/whatsapp/conversation-intelligence";
import { loadLeadContext, leadDisplayName } from "./context";
import {
  followUpDraftSchema,
  parseAiOutput,
  type FollowUpDraft,
} from "./schemas";
import { storeIntelligenceRun } from "./store";

const FLAGSHIP_LEAD_ID = "lead_buyer_pref_dha6";

export type DraftChannel = FollowUpDraft["channel"];

/** Count and location come only from the shortlisted records (see describeMatchAreas), never from the lead's preferred area. */
function whatsappDraft(name: string, shortlist: ScoredPropertyMatch[], mix: boolean): string {
  const n = shortlist.length;
  if (n === 0) {
    return mix
      ? `Assalam o Alaikum ${name}, abhi hamari listings mein aapki requirement se match karti property nahi hai. Naye options aate hi main share kar doon ga.`
      : `Assalam o Alaikum ${name}, none of our current listings match your brief yet. I'll share new options as soon as they come in.`;
  }
  const areas = describeMatchAreas(shortlist);
  const options = n === 1 ? "option" : "options";
  if (mix) {
    const where = areas && "single" in areas ? `${areas.single} mein ` : "";
    const tail = areas && "breakdown" in areas ? ` (${areas.breakdown})` : "";
    return `Assalam o Alaikum ${name}, ${where}aapke budget ke mutabiq ${n} ${options} shortlist ki hain${tail}. Agar convenient ho to main details share kar deta hoon.`;
  }
  const where = areas && "single" in areas ? ` in ${areas.single}` : "";
  const tail = areas && "breakdown" in areas ? ` (${areas.breakdown})` : "";
  return `Assalam o Alaikum ${name}, I have ${n} ${options}${where} that fit the brief${tail}. Shall I share details?`;
}

export async function draftFollowUp(input: {
  workspaceId: string;
  leadId: string;
  actorId?: string | null;
  channel: DraftChannel;
  mixLanguage?: boolean;
}) {
  const ctx = await loadLeadContext(input.workspaceId, input.leadId);
  if (!ctx) return null;

  const name = ctx.lead.firstName;
  const matches = filterAndScoreProperties(ctx.lead, ctx.properties);
  const shortlist = matches.slice(0, 2);
  const shortlistAreas = describeMatchAreas(shortlist);
  const mix = input.mixLanguage !== false;
  const visit = ctx.calendarEvents.find((e) => e.type === "SITE_VISIT" && e.status === "SCHEDULED");
  const nba = ctx.lead.nextAction;

  let body: string;
  let subject: string | null = null;

  if (ctx.lead.id === FLAGSHIP_LEAD_ID && input.channel === "WHATSAPP") {
    body =
      "Assalam o Alaikum Ahmed, DHA Phase 6 mein aapke budget ke mutabiq 2 options shortlist ki hain. Agar convenient ho to main details share kar deta hoon.";
  } else if (input.channel === "WHATSAPP") {
    body = whatsappDraft(name, shortlist, mix);
    if (visit) {
      body = mix
        ? `Assalam o Alaikum ${name}, site visit confirm kar raha hoon. Details share kar doon kya?`
        : `Assalam o Alaikum ${name}, confirming the site visit — shall I send the property notes?`;
    }
  } else if (input.channel === "EMAIL") {
    subject = `${shortlistAreas && "single" in shortlistAreas ? shortlistAreas.single : "Property"} options for ${leadDisplayName(ctx.lead)}`;
    body = [
      `Dear ${leadDisplayName(ctx.lead)},`,
      "",
      shortlist.length === 0
        ? "Following our conversation, none of our current listings match your brief yet; I will share new options as they come in."
        : `Following our conversation, I have shortlisted ${shortlist.length} ${ctx.lead.propertyTypePref?.toLowerCase() ?? "property"} ${shortlist.length === 1 ? "option" : "options"}${shortlistAreas && "single" in shortlistAreas ? ` in ${shortlistAreas.single}` : shortlistAreas ? ` (${shortlistAreas.breakdown})` : ""} within ${formatCurrency(ctx.lead.budgetMax ? Number(ctx.lead.budgetMax) : null)}.`,
      "",
      nba ? `Suggested next step: ${nba}.` : "Suggested next step: a short site visit.",
      "",
      "Please let me know a convenient time.",
      "",
      "Regards",
    ].join("\n");
  } else {
    body = `Hi ${name} — sharing a concise ${ctx.lead.preferredArea ?? "Lahore"} shortlist aligned to your brief. Open to a 15-min walkthrough this week.`;
  }

  const kind =
    input.channel === "EMAIL"
      ? "EMAIL_DRAFT"
      : input.channel === "LINKEDIN"
        ? "LINKEDIN_DRAFT"
        : "FOLLOW_UP_DRAFT";

  const output = parseAiOutput(followUpDraftSchema, {
    channel: input.channel,
    language: mix && input.channel === "WHATSAPP" ? "UR_EN" : "EN",
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
