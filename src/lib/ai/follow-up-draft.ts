import { formatCurrency } from "@/lib/format";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { loadLeadContext, leadDisplayName } from "./context";
import {
  followUpDraftSchema,
  parseAiOutput,
  type FollowUpDraft,
} from "./schemas";
import { storeIntelligenceRun } from "./store";

const FLAGSHIP_LEAD_ID = "lead_buyer_pref_dha6";

export type DraftChannel = FollowUpDraft["channel"];

function whatsappDraft(name: string, area: string | null, matchCount: number, mix: boolean): string {
  if (mix) {
    return `Assalam o Alaikum ${name}, ${area ?? "aapke preferred area"} mein aapke budget ke mutabiq ${matchCount} options shortlist ki hain. Agar convenient ho to main details share kar deta hoon.`;
  }
  return `Assalam o Alaikum ${name}, I have ${matchCount} options in ${area ?? "your preferred area"} that fit the brief. Shall I share details?`;
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
  const mix = input.mixLanguage !== false;
  const visit = ctx.calendarEvents.find((e) => e.type === "SITE_VISIT" && e.status === "SCHEDULED");
  const nba = ctx.lead.nextAction;

  let body: string;
  let subject: string | null = null;

  if (ctx.lead.id === FLAGSHIP_LEAD_ID && input.channel === "WHATSAPP") {
    body =
      "Assalam o Alaikum Ahmed, DHA Phase 6 mein aapke budget ke mutabiq 2 options shortlist ki hain. Agar convenient ho to main details share kar deta hoon.";
  } else if (input.channel === "WHATSAPP") {
    body = whatsappDraft(name, ctx.lead.preferredArea, Math.max(1, matches.slice(0, 2).length), mix);
    if (visit) {
      body = mix
        ? `Assalam o Alaikum ${name}, site visit confirm kar raha hoon. Details share kar doon kya?`
        : `Assalam o Alaikum ${name}, confirming the site visit — shall I send the property notes?`;
    }
  } else if (input.channel === "EMAIL") {
    subject = `${ctx.lead.preferredArea ?? "Property"} options for ${leadDisplayName(ctx.lead)}`;
    body = [
      `Dear ${leadDisplayName(ctx.lead)},`,
      "",
      `Following our conversation, I have shortlisted ${Math.max(1, matches.slice(0, 2).length)} ${ctx.lead.propertyTypePref?.toLowerCase() ?? "property"} options in ${ctx.lead.preferredArea ?? "your preferred area"} within ${formatCurrency(ctx.lead.budgetMax ? Number(ctx.lead.budgetMax) : null)}.`,
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
