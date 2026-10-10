/**
 * The three sellable packages. One source of truth for the code (`can()`, seat limit, nav) AND for the sales
 * sheet (`npm run sales:sheet`), so what sales promises cannot drift from what the system does.
 * Pure data: no server imports, safe in client components.
 */
export const PACKAGE_IDS = ["starter", "growth", "advanced"] as const;
export type PackageId = (typeof PACKAGE_IDS)[number];

export type Capability =
  | "externalCrmSync"
  | "websiteForm"
  | "metaLeadAds"
  | "emailIntake"
  | "teamAlerts"
  | "instantReply"
  | "aiSummary"
  | "hotWarmCold"
  | "leadRanking"
  | "autoFollowUp"
  | "chatAssistant"
  | "reports"
  | "aiAgents"
  | "customWorkflows";

/** What the code can honestly do today. Sales sheet prints this; flip it when the feature ships. */
export const CAPABILITY_STATUS: Record<Capability, { label: string; status: "built" | "partial" | "planned"; note?: string }> = {
  externalCrmSync: { label: "Saves each enquiry into the client's own CRM", status: "partial", note: "HubSpot and Google Sheets built; Zoho not yet (planned)" },
  websiteForm: { label: "Website enquiry form", status: "built", note: "embed snippet from `npm run intake -- add-form`" },
  metaLeadAds: { label: "Facebook / Instagram lead ads", status: "built", note: "client's Meta app needs leads_retrieval approved by Meta before live leads flow" },
  emailIntake: { label: "Enquiries and replies by email", status: "built", note: "needs a Resend receiving address; replies become notes, not a threaded inbox" },
  teamAlerts: { label: "Team alerted of new and waiting enquiries", status: "partial", note: "email (Resend) built; WhatsApp alerts planned. Recipients need no login or seat; the client says how many at agreement" },
  instantReply: { label: "Instant automatic reply", status: "partial", note: "email reply to form, Meta and email enquiries is built; WhatsApp reply needs AUTO mode" },
  aiSummary: { label: "AI summary of each enquiry", status: "built", note: "deterministic, no LLM yet" },
  hotWarmCold: { label: "Hot / warm / cold tag", status: "built" },
  leadRanking: { label: "AI ranks who to call first", status: "built" },
  autoFollowUp: { label: "Automatic WhatsApp and email follow-up", status: "partial", note: "WhatsApp only, no email provider yet" },
  chatAssistant: { label: "Chat assistant on one channel", status: "planned" },
  reports: { label: "Conversion, response-time and team reports", status: "built" },
  aiAgents: { label: "AI agents that chat, qualify and book", status: "planned" },
  customWorkflows: { label: "Custom workflows and approvals", status: "planned", note: "built per client" },
};

export type Package = {
  id: PackageId;
  name: string;
  tagline: string;
  setupUsd: number;
  supportUsd: number;
  readyIn: string;
  /** Enquiry channels included. null = as agreed in the written scope. */
  channels: number | null;
  /** Team members included. null = no package limit. */
  seats: number | null;
  training: string;
  helpDays: number;
  revisions: string;
  capabilities: readonly Capability[];
  /** Selling rules that are not a feature, printed on the sales sheet. */
  notes?: readonly string[];
  /** The card's bullet list, as sold. */
  includes: readonly string[];
};

const STARTER_CAPS: Capability[] = ["externalCrmSync", "websiteForm", "metaLeadAds", "emailIntake", "teamAlerts", "instantReply", "aiSummary", "hotWarmCold"];
const GROWTH_CAPS: Capability[] = [...STARTER_CAPS, "leadRanking", "autoFollowUp", "chatAssistant", "reports"];

export const PACKAGES: Record<PackageId, Package> = {
  starter: {
    id: "starter",
    name: "Starter",
    tagline: "Never miss an enquiry",
    setupUsd: 650,
    supportUsd: 75,
    readyIn: "About 1 week",
    channels: 1,
    seats: 3,
    training: "1 call",
    helpDays: 14,
    revisions: "1 round",
    capabilities: STARTER_CAPS,
    notes: [
      "Enquiries are saved into the client's own CRM account. We do not host their CRM.",
      "If the client has no CRM, a basic Starter-level CRM can be built for them as a separate add-on, quoted separately and not included in the Starter price.",
    ],
    includes: [
      "Every enquiry saved in one CRM, on your own account",
      "One channel connected (website, WhatsApp or ads)",
      "Instant automatic reply to every customer",
      "AI summary and hot, warm or cold tag on each enquiry",
      "Your team alerted by WhatsApp or email, plus a simple dashboard",
    ],
  },
  growth: {
    id: "growth",
    name: "Growth",
    tagline: "Follow up on every enquiry, automatically",
    setupUsd: 1650,
    supportUsd: 225,
    readyIn: "2 to 3 weeks",
    channels: 4,
    seats: 5,
    training: "2 sessions",
    helpDays: 30,
    revisions: "2 rounds",
    capabilities: GROWTH_CAPS,
    includes: [
      "CRM built around your process",
      "Website, WhatsApp and ads in one place",
      "AI ranks enquiries so your team calls the best ones first",
      "Automatic WhatsApp and email follow-up",
      "See what works: conversions, response time, team performance",
    ],
  },
  advanced: {
    id: "advanced",
    name: "Advanced",
    tagline: "A system built around how you work",
    setupUsd: 3650,
    supportUsd: 700,
    readyIn: "4 to 8 weeks, depending on the plan",
    channels: null,
    seats: null,
    training: "Handover training and a manual",
    helpDays: 90,
    revisions: "Reviewed at each stage",
    capabilities: [...GROWTH_CAPS, "aiAgents", "customWorkflows"],
    includes: [
      "CRM built from scratch for your teams",
      "AI agents that chat, qualify and book",
      "Dashboards for owners and managers",
      "Workflows and approvals across teams",
      "Custom rules for your business",
    ],
  },
};

/** Paid extras that are not in any package price. */
export const ADDONS = {
  starterCrm: {
    name: "Starter CRM build",
    forPackage: "starter" as PackageId,
    // Price deliberately unset: quoted per client until you decide a number.
    priceUsd: null as number | null,
    summary: "A basic CRM (enquiries, inbox, calendar, tasks, simple dashboard) for a Starter client who has no CRM of their own. The system's Starter view is exactly this.",
  },
};

/** Sidebar modules that only exist from some capability up. Starter stays a simple inbox + dashboard. */
export const NAV_NEEDS: Record<string, Capability> = {
  "/automations": "autoFollowUp",
  "/reports": "reports",
  "/team-health": "reports",
  "/insights": "reports",
};

export function packageOf(id: string): Package {
  // Unknown value = least privilege, never the most.
  return Object.hasOwn(PACKAGES, id) ? PACKAGES[id as PackageId] : PACKAGES.starter;
}

export function can(pkg: Package, capability: Capability): boolean {
  return pkg.capabilities.includes(capability);
}
