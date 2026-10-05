import bcrypt from "bcryptjs";
import type { Prisma, WorkspaceRole } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { isDemoMode } from "../src/lib/demo-mode";
import { writeAudit } from "../src/lib/audit";
import { DEFAULT_AUTOMATIONS } from "../src/lib/automation/engine";
import { createLead } from "../src/lib/leads/create-lead";
import { convertLeadOnOpportunityWon } from "../src/lib/leads/convert-on-won";
import { takeOverLead } from "../src/lib/leads/take-over";
import { getWhatsAppProvider } from "../src/lib/providers/whatsapp";
import { scoreLead } from "../src/lib/scoring";
import { storeInboundMessage } from "../src/lib/webhooks/whatsapp";
import { clearWorkspaceData, getDemoSeedPassword } from "./seed-data";

/**
 * "Synas UX Audit Demo": an isolated, fully synthetic workspace for an
 * external UI/UX designer. WhatsApp conversations are driven through the real
 * inbound pipeline (storeInboundMessage → lead creation, requirement
 * extraction, property matching, handoff detection, auto-reply via the Demo
 * provider), so the states the designer sees are the engine's own output.
 * Historical CRM records (deals, proposals, visits, tasks) are written
 * directly, as prisma/seed-data.ts does.
 *
 * Idempotent: every run wipes and rebuilds only this workspace (by fixed slug,
 * and only if it is flagged isDemo). Other workspaces are never read or written.
 */

export const UX_AUDIT_SLUG = "synas-ux-audit-demo";
export const UX_AUDIT_WORKSPACE_ID = "ws_ux_audit_demo";

export const UX_AUDIT_USERS = [
  { id: "user_ux_owner", email: "ux-owner@demo.synaslabs.com", name: "UX Audit Owner", role: "OWNER" },
  { id: "user_ux_manager", email: "ux-manager@demo.synaslabs.com", name: "UX Audit Manager", role: "MANAGER" },
  { id: "user_ux_agent", email: "ux-agent@demo.synaslabs.com", name: "UX Audit Agent", role: "AGENT" },
] as const satisfies ReadonlyArray<{ id: string; email: string; name: string; role: WorkspaceRole }>;

const WS = UX_AUDIT_WORKSPACE_ID;
const OWNER = "user_ux_owner";
const MANAGER = "user_ux_manager";
const AGENT = "user_ux_agent";

const STAGES = [
  { slug: "new", name: "New", probability: 10, accentColor: "#94A3B8" },
  { slug: "qualified", name: "Qualified", probability: 20, accentColor: "#0D9488" },
  { slug: "discovery", name: "Discovery", probability: 35, accentColor: "#0891B2" },
  { slug: "solution", name: "Solution", probability: 50, accentColor: "#2563EB" },
  { slug: "proposal", name: "Proposal", probability: 65, accentColor: "#7C3AED" },
  { slug: "negotiation", name: "Negotiation", probability: 80, accentColor: "#D97706" },
  { slug: "won", name: "Won", probability: 100, accentColor: "#059669", isWon: true },
  { slug: "lost", name: "Lost", probability: 0, accentColor: "#DC2626", isLost: true },
] as const;
type StageSlug = (typeof STAGES)[number]["slug"];
const stageId = (slug: StageSlug) => `ux_stage_${slug}`;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
function daysFromNow(days: number, hour = 11) {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * Synthetic numbers in the 555-01xx line range, reserved by NANP for fictional use, so no
 * seeded number can belong to a real subscriber.
 */
const phone = (n: number) => `+1312555${String(100 + n).padStart(4, "0")}`;

// ---------------------------------------------------------------- properties

type PropertySeed = {
  id: string;
  title: string;
  area: string;
  type: "SINGLE_FAMILY" | "CONDO" | "TOWNHOUSE" | "MULTI_FAMILY" | "LAND" | "COMMERCIAL";
  purpose: "SALE" | "RENT";
  size: number;
  unit: "SQFT" | "ACRE";
  city: string;
  state: string;
  postalCode: string;
  beds?: number;
  price: number;
  status: "AVAILABLE" | "RESERVED" | "SOLD" | "RENTED" | "WITHDRAWN";
  agent: string;
  owner?: string;
};

// Deliberately no COMMERCIAL + RENT listing: that is the Flow 4 "no grounded match" scenario.
const PROPERTIES: PropertySeed[] = [
  { id: "uxp_logan_th_rent_a", title: "2418 N Sawyer Ave — 3 Bed Townhouse", area: "Logan Square", city: "Chicago", state: "IL", postalCode: "60647", type: "TOWNHOUSE", purpose: "RENT", size: 1650, unit: "SQFT", beds: 3, price: 2_800, status: "AVAILABLE", agent: AGENT, owner: "uxc_landlord_a" },
  { id: "uxp_logan_th_rent_b", title: "2731 N Spaulding Ave — 3 Bed Townhouse", area: "Logan Square", city: "Chicago", state: "IL", postalCode: "60647", type: "TOWNHOUSE", purpose: "RENT", size: 1720, unit: "SQFT", beds: 3, price: 3_100, status: "AVAILABLE", agent: AGENT, owner: "uxc_landlord_b" },
  { id: "uxp_logan_th_rented", title: "3015 W Wrightwood Ave — 3 Bed Townhouse", area: "Logan Square", city: "Chicago", state: "IL", postalCode: "60647", type: "TOWNHOUSE", purpose: "RENT", size: 1600, unit: "SQFT", beds: 3, price: 2_950, status: "RENTED", agent: MANAGER, owner: "uxc_landlord_a" },
  { id: "uxp_oakpark_sfh_rent", title: "812 S Scoville Ave — 4 Bed Rental Home", area: "Oak Park", city: "Oak Park", state: "IL", postalCode: "60302", type: "SINGLE_FAMILY", purpose: "RENT", size: 2450, unit: "SQFT", beds: 4, price: 4_200, status: "AVAILABLE", agent: MANAGER },
  { id: "uxp_lincoln_sfh_sold", title: "2214 N Cleveland Ave — Renovated Greystone", area: "Lincoln Park", city: "Chicago", state: "IL", postalCode: "60614", type: "SINGLE_FAMILY", purpose: "SALE", size: 3850, unit: "SQFT", beds: 5, price: 1_875_000, status: "SOLD", agent: OWNER, owner: "uxc_seller_lincoln" },
  { id: "uxp_lincoln_sfh_avail", title: "1740 N Burling St — Classic Row House", area: "Lincoln Park", city: "Chicago", state: "IL", postalCode: "60614", type: "SINGLE_FAMILY", purpose: "SALE", size: 3100, unit: "SQFT", beds: 4, price: 1_450_000, status: "AVAILABLE", agent: AGENT },
  { id: "uxp_naperville_sfh", title: "1204 Brookdale Rd — Colonial", area: "Naperville", city: "Naperville", state: "IL", postalCode: "60540", type: "SINGLE_FAMILY", purpose: "SALE", size: 2600, unit: "SQFT", beds: 3, price: 585_000, status: "AVAILABLE", agent: AGENT },
  { id: "uxp_hydepark_sfh_res", title: "5431 S Blackstone Ave — Brick Bungalow", area: "Hyde Park", city: "Chicago", state: "IL", postalCode: "60615", type: "SINGLE_FAMILY", purpose: "SALE", size: 1850, unit: "SQFT", beds: 3, price: 425_000, status: "RESERVED", agent: AGENT },
  { id: "uxp_evanston_sfh_sold", title: "1123 Michigan Ave — Lakefront Victorian", area: "Evanston", city: "Evanston", state: "IL", postalCode: "60201", type: "SINGLE_FAMILY", purpose: "SALE", size: 3900, unit: "SQFT", beds: 6, price: 1_250_000, status: "SOLD", agent: MANAGER },
  { id: "uxp_arlington_sfh", title: "617 N Dryden Pl — Split Level", area: "Arlington Heights", city: "Arlington Heights", state: "IL", postalCode: "60004", type: "SINGLE_FAMILY", purpose: "SALE", size: 2300, unit: "SQFT", beds: 4, price: 695_000, status: "AVAILABLE", agent: MANAGER },
  { id: "uxp_wicker_sfh_seller", title: "1455 N Hoyne Ave — Four Square (seller listing)", area: "Wicker Park", city: "Chicago", state: "IL", postalCode: "60622", type: "SINGLE_FAMILY", purpose: "SALE", size: 2700, unit: "SQFT", beds: 4, price: 845_000, status: "AVAILABLE", agent: AGENT, owner: "uxc_tomlin" },
  { id: "uxp_naperville_lot_a", title: "0 Hobson Rd — Buildable Lot", area: "Naperville", city: "Naperville", state: "IL", postalCode: "60540", type: "LAND", purpose: "SALE", size: 0.34, unit: "ACRE", price: 310_000, status: "AVAILABLE", agent: AGENT },
  { id: "uxp_naperville_lot_b", title: "0 Raymond Dr — Infill Lot", area: "Naperville", city: "Naperville", state: "IL", postalCode: "60540", type: "LAND", purpose: "SALE", size: 0.17, unit: "ACRE", price: 165_000, status: "AVAILABLE", agent: MANAGER },
  { id: "uxp_arlington_lot_wd", title: "0 Kennicott Ave — Teardown Lot", area: "Arlington Heights", city: "Arlington Heights", state: "IL", postalCode: "60004", type: "LAND", purpose: "SALE", size: 0.25, unit: "ACRE", price: 240_000, status: "WITHDRAWN", agent: AGENT },
  { id: "uxp_wicker_condo_rent", title: "1850 W Division St #3B — 2 Bed Condo", area: "Wicker Park", city: "Chicago", state: "IL", postalCode: "60622", type: "CONDO", purpose: "RENT", size: 1100, unit: "SQFT", beds: 2, price: 2_650, status: "AVAILABLE", agent: AGENT },
  { id: "uxp_wicker_condo_sale", title: "1620 N Damen Ave #4S — 3 Bed Condo", area: "Wicker Park", city: "Chicago", state: "IL", postalCode: "60622", type: "CONDO", purpose: "SALE", size: 1650, unit: "SQFT", beds: 3, price: 615_000, status: "AVAILABLE", agent: MANAGER },
  { id: "uxp_logan_condo_rented", title: "2200 N Milwaukee Ave #2A — 1 Bed Condo", area: "Logan Square", city: "Chicago", state: "IL", postalCode: "60647", type: "CONDO", purpose: "RENT", size: 650, unit: "SQFT", beds: 1, price: 1_750, status: "RENTED", agent: AGENT },
  { id: "uxp_wicker_retail_sale", title: "1533 N Milwaukee Ave — Ground-floor Retail", area: "Wicker Park", city: "Chicago", state: "IL", postalCode: "60622", type: "COMMERCIAL", purpose: "SALE", size: 450, unit: "SQFT", price: 485_000, status: "AVAILABLE", agent: MANAGER },
  { id: "uxp_loop_office_res", title: "120 N LaSalle St #1400 — Office Floor", area: "Hyde Park", city: "Chicago", state: "IL", postalCode: "60615", type: "COMMERCIAL", purpose: "SALE", size: 3200, unit: "SQFT", price: 1_350_000, status: "RESERVED", agent: OWNER },
  { id: "uxp_logan_two_flat", title: "2644 N Kedzie Ave — Legal Two-Flat", area: "Logan Square", city: "Chicago", state: "IL", postalCode: "60647", type: "MULTI_FAMILY", purpose: "SALE", size: 3000, unit: "SQFT", beds: 6, price: 720_000, status: "AVAILABLE", agent: OWNER },
];

// ------------------------------------------------------------------ contacts

const CONTACTS: Array<{ id: string; firstName: string; lastName: string; title: string; phoneNo: number; accountId?: string }> = [
  { id: "uxc_landlord_a", firstName: "Nicole", lastName: "Abbott", title: "Landlord", phoneNo: 51 },
  { id: "uxc_landlord_b", firstName: "Samuel", lastName: "Reyes", title: "Landlord", phoneNo: 52 },
  { id: "uxc_seller_lincoln", firstName: "Kathryn", lastName: "Mansfield", title: "Seller", phoneNo: 53 },
  { id: "uxc_tomlin", firstName: "Trevor", lastName: "Tomlin", title: "Seller", phoneNo: 14 },
  { id: "uxc_ayesha", firstName: "Alexis", lastName: "Rafferty", title: "Buyer", phoneNo: 11 },
  { id: "uxc_omar", firstName: "Owen", lastName: "Sandoval", title: "Director", phoneNo: 12, accountId: "uxa_siddiqui" },
  { id: "uxc_mehwish", firstName: "Megan", lastName: "Kiernan", title: "HR Manager", phoneNo: 13, accountId: "uxa_kiani" },
  { id: "uxc_shazia", firstName: "Simone", lastName: "Nordstrom", title: "Investor", phoneNo: 15, accountId: "uxa_noor" },
  { id: "uxc_fatima", firstName: "Felicia", lastName: "Zane", title: "Buyer", phoneNo: 17 },
  { id: "uxc_hassan", firstName: "Harrison", lastName: "Reed", title: "Buyer", phoneNo: 18 },
  { id: "uxc_junaid", firstName: "Jonah", lastName: "Ackerman", title: "Buyer", phoneNo: 20 },
  { id: "uxc_saad", firstName: "Sydney", lastName: "Ingram", title: "Tenant", phoneNo: 21 },
  // Pre-existing contacts for WhatsApp leads, so their inbound messages link to a contact.
  { id: "uxc_adeel", firstName: "Andre", lastName: "Alvarez", title: "Buyer", phoneNo: 7 },
  { id: "uxc_zara", firstName: "Zoe", lastName: "Hartman", title: "Buyer", phoneNo: 8 },
];

const ACCOUNTS = [
  { id: "uxa_siddiqui", company: "Sandoval Holdings (Demo)", industry: "Investment", city: "Chicago" },
  { id: "uxa_kiani", company: "Kiernan Logistics (Demo)", industry: "Manufacturing", city: "Chicago" },
  { id: "uxa_noor", company: "Nordstrom Retail Group (Demo)", industry: "Retail", city: "Evanston" },
];

// ------------------------------------------------------ WhatsApp conversations

type Step =
  | { in: string }
  | { takeOver: string }
  | { send: string; by: string }
  | { set: Prisma.LeadUpdateInput };

type Conversation = {
  key: string;
  scenario: string;
  phoneNo: number;
  profileName: string | null;
  startHoursAgo: number;
  steps: Step[];
};

/**
 * Each step goes through the same code the Meta webhook runs. Replies,
 * extraction, matches and handoffs below are whatever the engine decides
 * for that text; tests/unit/ux-audit-demo.test.ts pins the expected outcomes.
 */
const CONVERSATIONS: Conversation[] = [
  {
    key: "flow1_new_lead",
    scenario: "Flow 1: new WhatsApp lead, requirement extracted, matching in progress",
    phoneNo: 1,
    profileName: "Tyler Brennan",
    startHoursAgo: 0.5,
    steps: [{ in: "Hi" }, { in: "Looking to rent a 3 bedroom townhouse in Logan Square, about 1,650 sq ft, budget around $2,900/mo." }, { in: "Townhouse" }],
  },
  {
    key: "flow2_incomplete",
    scenario: "Flow 2: incomplete requirement (type + area known; purpose, budget and size missing)",
    phoneNo: 2,
    profileName: "Hannah Caldwell",
    startHoursAgo: 3,
    steps: [{ in: "Hello" }, { in: "I need a house" }, { in: "Lincoln Park" }],
  },
  {
    key: "flow3_grounded_match",
    scenario: "Flow 3 + 6: fully qualified, grounded Logan Square rental matches; ready to become an opportunity",
    phoneNo: 3,
    profileName: "Kevin Mathis",
    startHoursAgo: 26,
    steps: [
      { in: "Hi, I'm looking to rent a 3 bedroom townhouse in Logan Square, about 1,650 sq ft, up to $2,900 a month" },
      { in: "Yes please" },
      { in: "Where is the first one?" },
      { set: { stage: "QUALIFIED", owner: { connect: { id: AGENT } }, timeline: "30 days", nextAction: "Create opportunity and book a showing" } },
    ],
  },
  {
    key: "flow4_no_match",
    scenario: "Flow 4: full requirement but no grounded inventory match, human handoff (AI still replying)",
    phoneNo: 4,
    profileName: "Natalie Ferraro",
    startHoursAgo: 5,
    steps: [{ in: "Hello" }, { in: "I need to lease office space in Wicker Park, about 2,000 sq ft, budget $6,500/mo" }],
  },
  {
    key: "flow5_handoff_pending",
    scenario: "Flow 5: owner/documents question triggered a handoff, waiting for an agent to take over",
    phoneNo: 5,
    profileName: "Felix Mendoza",
    startHoursAgo: 2,
    steps: [
      { in: "I want to buy a single-family home in Lincoln Park, budget $1.4m to $1.5m" },
      { in: "Yes" },
      { in: "Can I talk to the seller directly? Is the title clear?" },
    ],
  },
  {
    key: "takeover_done",
    scenario: "Agent takeover: customer asked for a human, agent took over and is replying manually",
    phoneNo: 6,
    profileName: "Renee Sorensen",
    startHoursAgo: 30,
    steps: [
      { in: "Hi" },
      { in: "I want to buy a single-family home in Naperville, up to $600k" },
      { in: "Can I speak to an agent please" },
      { takeOver: AGENT },
      { send: "Hi Renee, this is the UX Audit Agent. The Brookdale Rd colonial is still available. When is a good time for a call?", by: AGENT },
      { in: "That works — can you call me at 5pm?" },
    ],
  },
  {
    key: "flow7_site_visit",
    scenario: "Flow 7: qualified buyer asked for a viewing; showing scheduled for tomorrow",
    phoneNo: 7,
    profileName: "Andre Alvarez",
    startHoursAgo: 50,
    steps: [
      { in: "I want to buy a single-family home in Lincoln Park, budget $1.4m to $1.5m" },
      { in: "Yes" },
      { set: { stage: "QUALIFIED", owner: { connect: { id: AGENT } }, timeline: "45 days" } },
      { in: "Could we see it tomorrow?" },
    ],
  },
  {
    key: "flow9_negotiation",
    scenario: "Flow 8 + 9: proposal viewed, buyer asking for a better price (negotiation handoff)",
    phoneNo: 8,
    profileName: "Zoe Hartman",
    startHoursAgo: 20,
    steps: [
      { in: "I'd like to buy a single-family home in Arlington Heights, budget $650k to $720k" },
      { set: { stage: "QUALIFIED", owner: { connect: { id: MANAGER } }, timeline: "30 days" } },
      { in: "I reviewed the proposal. What's the final price? Is there any room to come down?" },
    ],
  },
  {
    key: "greeting_only",
    scenario: "Simple greeting from an unknown number (no WhatsApp profile name)",
    phoneNo: 9,
    profileName: null,
    startHoursAgo: 0.2,
    steps: [{ in: "Hello" }],
  },
  {
    key: "follow_up",
    scenario: "Follow-up conversation: manager took over and is following up manually",
    phoneNo: 10,
    profileName: "Ian Prescott",
    startHoursAgo: 72,
    steps: [
      { in: "Looking to buy vacant land in Naperville, budget $150k to $175k" },
      { takeOver: MANAGER },
      { send: "Ian, I've sent over the plat and the builder quotes for the Raymond Dr lot. Shall I call you tomorrow?", by: MANAGER },
      { in: "Sounds good, noon tomorrow works" },
    ],
  },
];

async function agentSend(leadId: string, userId: string, body: string) {
  // Same writes as POST /api/whatsapp/messages (demo provider: nothing leaves the CRM).
  const provider = getWhatsAppProvider();
  const message = await provider.sendMessage(WS, { conversationId: `lead:${leadId}`, body, leadId, senderId: userId });
  await prisma.activity.create({
    data: {
      workspaceId: WS,
      type: "WHATSAPP_MESSAGE",
      leadId,
      ownerId: userId,
      date: message.sentAt,
      status: "COMPLETED",
      title: "WhatsApp message logged",
      notes: body,
      metadata: { messageId: message.id, direction: "OUTBOUND", demo: provider.isDemo },
    },
  });
  await writeAudit({
    workspaceId: WS,
    actorId: userId,
    action: "WHATSAPP_MESSAGE_LOGGED",
    entity: "WhatsAppMessage",
    entityId: message.id,
    metadata: { direction: "OUTBOUND", demo: provider.isDemo },
  });
}

/** Spreads a freshly-played conversation back in time so the inbox reads like real traffic. */
async function backdateConversation(leadId: string, startHoursAgo: number, playedFrom: Date) {
  const messages = await prisma.whatsAppMessage.findMany({
    where: { workspaceId: WS, leadId },
    orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, direction: true, senderId: true },
  });
  let t = Date.now() - startHoursAgo * HOUR;
  for (const [i, m] of messages.entries()) {
    // Auto-replies land a few seconds after the customer; people take minutes.
    if (i > 0) t += m.direction === "OUTBOUND" && !m.senderId ? 20_000 : 6 * 60_000;
    await prisma.whatsAppMessage.update({ where: { id: m.id }, data: { sentAt: new Date(t) } });
  }
  const first = new Date(Date.now() - startHoursAgo * HOUR);
  const last = new Date(t);
  await prisma.activity.updateMany({ where: { workspaceId: WS, leadId, date: { gte: playedFrom } }, data: { date: last } });
  await prisma.lead.updateMany({ where: { workspaceId: WS, id: leadId }, data: { createdAt: first, lastActivityAt: last } });
}

async function playConversation(c: Conversation): Promise<string> {
  const playedFrom = new Date();
  let leadId: string | null = null;
  let n = 0;
  for (const step of c.steps) {
    if ("in" in step) {
      n += 1;
      await storeInboundMessage({
        workspaceId: WS,
        phone: phone(c.phoneNo),
        body: step.in,
        externalId: `ux-audit-demo:${c.key}:${n}`,
        profileName: c.profileName,
        extractable: true,
      });
      leadId ??= (await prisma.lead.findFirstOrThrow({ where: { workspaceId: WS, whatsappNumber: phone(c.phoneNo) } })).id;
    } else if (!leadId) {
      throw new Error(`Conversation ${c.key} must start with an inbound message`);
    } else if ("takeOver" in step) {
      await takeOverLead(WS, leadId, step.takeOver, { canReassign: true }); // seed script: acts as a manager
    } else if ("send" in step) {
      await agentSend(leadId, step.by, step.send);
    } else {
      await prisma.lead.update({ where: { id: leadId }, data: step.set });
    }
  }
  await backdateConversation(leadId!, c.startHoursAgo, playedFrom);
  await prisma.lead.update({ where: { id: leadId! }, data: { notes: `UX scenario: ${c.scenario}` } });
  return leadId!;
}

// ----------------------------------------------------------------- the seed

export type UxAuditSeedResult = Awaited<ReturnType<typeof seedUxAuditWorkspace>>;

async function assertSafeToSeed() {
  if (!isDemoMode()) throw new Error("UX audit seed is blocked unless DEMO_MODE=true.");
  if (!getWhatsAppProvider().isDemo) {
    throw new Error("UX audit seed refuses to run with a live WhatsApp provider: auto-replies would be really sent.");
  }
  const existing = await prisma.workspace.findUnique({ where: { slug: UX_AUDIT_SLUG } });
  if (existing && (!existing.isDemo || existing.id !== WS)) {
    throw new Error(`Workspace '${UX_AUDIT_SLUG}' exists but is not the UX audit demo workspace; refusing to touch it.`);
  }
  const foreign = await prisma.workspaceMember.findFirst({
    where: { user: { email: { in: UX_AUDIT_USERS.map((u) => u.email) } }, workspaceId: { not: WS } },
    select: { user: { select: { email: true } } },
  });
  if (foreign) throw new Error(`${foreign.user.email} belongs to another workspace; refusing to reset its password.`);
  return existing;
}

export async function seedUxAuditWorkspace() {
  const existing = await assertSafeToSeed();
  // Optional separate password so the external designer's logins don't unlock the Synas Realty demo.
  const passwordHash = await bcrypt.hash(
    getDemoSeedPassword(process.env.UX_AUDIT_PASSWORD ? "UX_AUDIT_PASSWORD" : "DEMO_SEED_PASSWORD"),
    10,
  );

  if (existing) await clearWorkspaceData(prisma, existing.id);

  for (const u of UX_AUDIT_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: { id: u.id, email: u.email, name: u.name, passwordHash },
      update: { name: u.name, passwordHash, deletedAt: null },
    });
  }

  await prisma.workspace.create({
    data: {
      id: WS,
      name: "Synas UX Audit Demo",
      slug: UX_AUDIT_SLUG,
      timezone: "America/Chicago",
      currency: "USD",
      isDemo: true,
      branding: {
        create: {
          id: "brand_ux_audit_demo",
          companyName: "Synas UX Audit Demo",
          displayName: "UX Audit Demo (synthetic data)",
          accentColor: "#0D9488",
        },
      },
      members: { create: UX_AUDIT_USERS.map((u) => ({ userId: u.id, role: u.role })) },
      pipelineStages: {
        create: STAGES.map((s, i) => ({
          id: stageId(s.slug),
          name: s.name,
          slug: s.slug,
          order: i + 1,
          probability: s.probability,
          accentColor: s.accentColor,
          isWon: "isWon" in s,
          isLost: "isLost" in s,
        })),
      },
      accounts: {
        create: ACCOUNTS.map((a) => ({ ...a, ownerId: MANAGER, notes: "Synthetic demo account." })),
      },
    },
  });

  await prisma.contact.createMany({
    data: CONTACTS.map((c) => ({
      id: c.id,
      workspaceId: WS,
      accountId: c.accountId ?? null,
      firstName: c.firstName,
      lastName: c.lastName,
      title: c.title,
      email: `${c.firstName}.${c.lastName}@example.com`.toLowerCase(),
      phone: phone(c.phoneNo),
      whatsappNumber: phone(c.phoneNo),
      notes: "Synthetic demo contact.",
    })),
  });

  await prisma.property.createMany({
    data: PROPERTIES.map((p, i) => ({
      id: p.id,
      workspaceId: WS,
      title: p.title,
      description: `Synthetic demo listing in ${p.area}.`,
      address: p.title.split(" — ")[0],
      area: p.area,
      city: p.city,
      state: p.state,
      postalCode: p.postalCode,
      propertyType: p.type,
      purpose: p.purpose,
      size: p.size,
      sizeUnit: p.unit,
      bedrooms: p.beds ?? null,
      bathrooms: p.beds ? Math.max(1, p.beds - 1) : null,
      furnishedStatus: p.purpose === "RENT" ? "Unfurnished" : null,
      price: p.price,
      status: p.status,
      listingType: i % 3 === 0 ? "EXCLUSIVE" : "OPEN",
      ownerContactId: p.owner ?? null,
      assignedAgentId: p.agent,
      listingSource: "Synthetic demo inventory",
      verificationStatus: i % 4 === 0 ? "PENDING" : "VERIFIED",
      dateListed: new Date(Date.now() - (10 + i * 3) * DAY),
    })),
  });

  // WhatsApp conversations through the real inbound engine.
  const conv: Record<string, string> = {};
  for (const c of CONVERSATIONS) conv[c.key] = await playConversation(c);
  await prisma.lead.update({ where: { id: conv.flow7_site_visit }, data: { contact: { connect: { id: "uxc_adeel" } } } });
  await prisma.lead.update({ where: { id: conv.flow9_negotiation }, data: { contact: { connect: { id: "uxc_zara" } } } });

  // Non-WhatsApp leads through the normal lead-creation path.
  const lead = async (
    contactId: string | null,
    daysAgo: number,
    body: Parameters<typeof createLead>[2],
  ) => {
    const created = await createLead(WS, body.ownerId ?? null, { ...body, contactId, notes: `UX scenario: ${body.notes}` }, { allowDuplicate: true });
    await prisma.lead.update({
      where: { id: created.id },
      data: { createdAt: new Date(Date.now() - daysAgo * DAY), lastActivityAt: new Date(Date.now() - Math.max(0, daysAgo - 2) * DAY) },
    });
    return created.id;
  };
  const c = (id: string) => CONTACTS.find((x) => x.id === id)!;
  const person = (id: string) => ({
    firstName: c(id).firstName,
    lastName: c(id).lastName,
    phone: phone(c(id).phoneNo),
    whatsappNumber: phone(c(id).phoneNo),
    email: `${c(id).firstName}.${c(id).lastName}@example.com`.toLowerCase(),
  });

  const L = {
    ayesha: await lead("uxc_ayesha", 40, { ...person("uxc_ayesha"), source: "AGENT_REFERRAL", stage: "QUALIFIED", intentType: "BUY", preferredArea: "Lincoln Park", propertyPurpose: "SALE", propertyTypePref: "SINGLE_FAMILY", sizePrefMin: 3500, sizePrefMax: 4200, sizeUnitPref: "SQFT", bedroomPref: 5, budgetMin: 1_750_000, budgetMax: 1_950_000, estimatedValue: 1_875_000, timeline: "30 days", ownerId: OWNER, notes: "Won deal (Flow 9 reference): Lincoln Park greystone, high value" }),
    omar: await lead("uxc_omar", 21, { ...person("uxc_omar"), company: "Sandoval Holdings (Demo)", accountId: "uxa_siddiqui", source: "ZILLOW", stage: "QUALIFIED", intentType: "INVEST", preferredArea: "Naperville", propertyPurpose: "SALE", propertyTypePref: "LAND", sizePrefMin: 0.25, sizePrefMax: 0.4, sizeUnitPref: "ACRE", budgetMin: 290_000, budgetMax: 330_000, estimatedValue: 310_000, timeline: "60 days", ownerId: AGENT, followUpDue: daysFromNow(3), notes: "Flow 8: proposal sent, waiting for the client to view it" }),
    mehwish: await lead("uxc_mehwish", 9, { ...person("uxc_mehwish"), company: "Kiernan Logistics (Demo)", accountId: "uxa_kiani", source: "FACEBOOK_ADS", stage: "QUALIFIED", intentType: "RENT", preferredArea: "Wicker Park", propertyPurpose: "RENT", propertyTypePref: "CONDO", bedroomPref: 2, budgetMin: 2_500, budgetMax: 2_800, estimatedValue: 31_800, timeline: "Immediate", ownerId: AGENT, followUpDue: daysFromNow(2), notes: "Corporate lease, proposal still in draft" }),
    tariq: await lead("uxc_tomlin", 15, { ...person("uxc_tomlin"), source: "SIGN_CALL", stage: "QUALIFIED", intentType: "SELL", preferredArea: "Wicker Park", propertyPurpose: "SALE", propertyTypePref: "SINGLE_FAMILY", sizePrefMin: 2600, sizePrefMax: 2800, sizeUnitPref: "SQFT", estimatedValue: 845_000, ownerId: AGENT, followUpDue: daysFromNow(-1), notes: "Seller-side opportunity (listing mandate)" }),
    shazia: await lead("uxc_shazia", 30, { ...person("uxc_shazia"), company: "Nordstrom Retail Group (Demo)", accountId: "uxa_noor", source: "WALK_IN", stage: "LOST", intentType: "INVEST", preferredArea: "Wicker Park", propertyPurpose: "SALE", propertyTypePref: "COMMERCIAL", budgetMin: 420_000, budgetMax: 500_000, estimatedValue: 485_000, ownerId: MANAGER, notes: "Lost deal: chose a larger unit elsewhere" }),
    fatima: await lead("uxc_fatima", 6, { ...person("uxc_fatima"), source: "REALTOR_COM", stage: "CONTACTED", intentType: "BUY", preferredArea: "Hyde Park", propertyPurpose: "SALE", propertyTypePref: "SINGLE_FAMILY", sizePrefMin: 1700, sizePrefMax: 2000, sizeUnitPref: "SQFT", budgetMin: 400_000, budgetMax: 450_000, estimatedValue: 425_000, timeline: "60 days", ownerId: AGENT, followUpDue: daysFromNow(-2), notes: "Contacted; matching listing is RESERVED (early-stage opportunity)" }),
    hassan: await lead("uxc_hassan", 18, { ...person("uxc_hassan"), source: "EXISTING_CLIENT", stage: "QUALIFIED", intentType: "BUY", preferredArea: "Naperville", propertyPurpose: "SALE", propertyTypePref: "SINGLE_FAMILY", sizePrefMin: 2400, sizePrefMax: 2800, sizeUnitPref: "SQFT", budgetMin: 550_000, budgetMax: 610_000, estimatedValue: 585_000, timeline: "45 days", ownerId: AGENT, followUpDue: daysFromNow(1), notes: "Showing history: one no-show, then completed" }),
    junaid: await lead("uxc_junaid", 25, { ...person("uxc_junaid"), source: "REFERRAL", stage: "QUALIFIED", intentType: "BUY", preferredArea: "Wicker Park", propertyPurpose: "SALE", propertyTypePref: "CONDO", bedroomPref: 3, budgetMin: 580_000, budgetMax: 630_000, estimatedValue: 615_000, timeline: "30 days", ownerId: MANAGER, notes: "Late-stage negotiation; showing was rescheduled" }),
    saad: await lead("uxc_saad", 35, { ...person("uxc_saad"), source: "WHATSAPP_INBOUND", stage: "QUALIFIED", intentType: "RENT", preferredArea: "Logan Square", propertyPurpose: "RENT", propertyTypePref: "CONDO", bedroomPref: 1, budgetMin: 1_600, budgetMax: 1_850, estimatedValue: 21_000, ownerId: AGENT, notes: "Won rental (12-month lease signed)" }),
    bilal: await lead(null, 45, { firstName: "Brandon", lastName: "Kowalski", phone: phone(16), source: "COLD_CALL", stage: "NURTURING", intentType: "UNKNOWN", ownerId: AGENT, followUpDue: daysFromNow(-4), notes: "Low priority: no budget or area given yet" }),
    maryam: await lead(null, 50, { firstName: "Monica", lastName: "Hayes", phone: phone(19), email: "monica.hayes@demo.example", source: "FACEBOOK_ADS", stage: "LOST", intentType: "BUY", preferredArea: "Evanston", propertyPurpose: "SALE", propertyTypePref: "SINGLE_FAMILY", budgetMax: 1_300_000, ownerId: MANAGER, notes: "Lost at lead stage: bought through another agency" }),
  };

  // Opportunities (stage history is represented by stageEnteredAt).
  const opp = async (
    id: string,
    data: Omit<Prisma.OpportunityUncheckedCreateInput, "id" | "workspaceId" | "stageId" | "probability"> & { stage: StageSlug; daysInStage: number },
  ) => {
    const { stage, daysInStage, ...rest } = data;
    await prisma.opportunity.create({
      data: {
        ...rest,
        id,
        workspaceId: WS,
        stageId: stageId(stage),
        probability: STAGES.find((s) => s.slug === stage)!.probability,
        stageEnteredAt: new Date(Date.now() - daysInStage * DAY),
        source: rest.source ?? "WHATSAPP_INBOUND",
      },
    });
    return id;
  };

  await opp("uxo_ayesha_won", { name: "Alexis Rafferty: Lincoln Park greystone", leadId: L.ayesha, primaryContactId: "uxc_ayesha", linkedPropertyId: "uxp_lincoln_sfh_sold", dealSide: "BUYER", value: 1_875_000, stage: "won", daysInStage: 3, ownerId: OWNER, expectedCloseDate: daysFromNow(-3), source: "REFERRAL", createdAt: new Date(Date.now() - 38 * DAY), description: "Closed. Earnest money deposited, title work in progress." });
  await opp("uxo_saad_won", { name: "Sydney Ingram: Logan Square condo lease", leadId: L.saad, primaryContactId: "uxc_saad", linkedPropertyId: "uxp_logan_condo_rented", dealSide: "BUYER", value: 21_000, stage: "won", daysInStage: 12, ownerId: AGENT, expectedCloseDate: daysFromNow(-12), createdAt: new Date(Date.now() - 33 * DAY), description: "12-month lease at $1,750/month." });
  await opp("uxo_omar_proposal", { name: "Owen Sandoval: Naperville buildable lot", leadId: L.omar, accountId: "uxa_siddiqui", primaryContactId: "uxc_omar", linkedPropertyId: "uxp_naperville_lot_a", dealSide: "BUYER", value: 310_000, stage: "proposal", daysInStage: 2, ownerId: AGENT, expectedCloseDate: daysFromNow(20), source: "ZILLOW", createdAt: new Date(Date.now() - 18 * DAY) });
  await opp("uxo_zara_proposal", { name: "Zoe Hartman: Arlington Heights split level", leadId: conv.flow9_negotiation, primaryContactId: "uxc_zara", linkedPropertyId: "uxp_arlington_sfh", dealSide: "BUYER", value: 695_000, stage: "proposal", daysInStage: 4, ownerId: MANAGER, expectedCloseDate: daysFromNow(10), createdAt: new Date(Date.now() - 9 * DAY), description: "Near close. Client viewed the proposal and wants to negotiate." });
  await opp("uxo_junaid_negotiation", { name: "Jonah Ackerman: 3 bed Wicker Park condo", leadId: L.junaid, primaryContactId: "uxc_junaid", linkedPropertyId: "uxp_wicker_condo_sale", dealSide: "BUYER", value: 615_000, stage: "negotiation", daysInStage: 6, ownerId: MANAGER, expectedCloseDate: daysFromNow(12), source: "REFERRAL", createdAt: new Date(Date.now() - 22 * DAY) });
  await opp("uxo_mehwish_qualified", { name: "Kiernan Logistics: Wicker Park corporate lease", leadId: L.mehwish, accountId: "uxa_kiani", primaryContactId: "uxc_mehwish", linkedPropertyId: "uxp_wicker_condo_rent", dealSide: "BUYER", value: 31_800, stage: "qualified", daysInStage: 3, ownerId: AGENT, expectedCloseDate: daysFromNow(14), source: "FACEBOOK_ADS", createdAt: new Date(Date.now() - 7 * DAY), description: "12-month lease at $2,650/month." });
  await opp("uxo_adeel_discovery", { name: "Andre Alvarez: Lincoln Park row house", leadId: conv.flow7_site_visit, primaryContactId: "uxc_adeel", linkedPropertyId: "uxp_lincoln_sfh_avail", dealSide: "BUYER", value: 1_450_000, stage: "discovery", daysInStage: 1, ownerId: AGENT, expectedCloseDate: daysFromNow(35), createdAt: new Date(Date.now() - 2 * DAY) });
  await opp("uxo_hassan_discovery", { name: "Harrison Reed: Naperville colonial", leadId: L.hassan, primaryContactId: "uxc_hassan", linkedPropertyId: "uxp_naperville_sfh", dealSide: "BUYER", value: 585_000, stage: "discovery", daysInStage: 8, ownerId: AGENT, expectedCloseDate: daysFromNow(30), source: "EXISTING_CLIENT", createdAt: new Date(Date.now() - 16 * DAY) });
  await opp("uxo_tariq_seller", { name: "Trevor Tomlin: Wicker Park listing mandate", leadId: L.tariq, primaryContactId: "uxc_tomlin", linkedPropertyId: "uxp_wicker_sfh_seller", dealSide: "SELLER", value: 845_000, stage: "solution", daysInStage: 5, ownerId: AGENT, expectedCloseDate: daysFromNow(45), source: "SIGN_CALL", createdAt: new Date(Date.now() - 14 * DAY) });
  await opp("uxo_fatima_new", { name: "Felicia Zane: Hyde Park bungalow", leadId: L.fatima, primaryContactId: "uxc_fatima", linkedPropertyId: "uxp_hydepark_sfh_res", dealSide: "BUYER", value: 425_000, stage: "new", daysInStage: 2, ownerId: AGENT, expectedCloseDate: daysFromNow(60), source: "ZILLOW", createdAt: new Date(Date.now() - 2 * DAY), description: "Listing is RESERVED; confirm with the seller before pitching." });
  await opp("uxo_shazia_lost", { name: "Nordstrom Retail: Milwaukee Ave retail unit", leadId: L.shazia, accountId: "uxa_noor", primaryContactId: "uxc_shazia", linkedPropertyId: "uxp_wicker_retail_sale", dealSide: "BUYER", value: 485_000, stage: "lost", daysInStage: 5, ownerId: MANAGER, source: "WALK_IN", createdAt: new Date(Date.now() - 28 * DAY), lostReason: "Chose a larger unit through another agency" });

  for (const [leadId, oppId, actor] of [[L.ayesha, "uxo_ayesha_won", OWNER], [L.saad, "uxo_saad_won", AGENT]] as const) {
    await convertLeadOnOpportunityWon({ workspaceId: WS, actorId: actor, leadId, opportunityId: oppId });
  }

  // Proposals: one per supported status the demo flows need.
  const proposals: Array<Omit<Prisma.ProposalCreateManyInput, "workspaceId">> = [
    { id: "uxpr_mehwish_draft", proposalNumber: "UX-PROP-001", leadId: L.mehwish, opportunityId: "uxo_mehwish_qualified", linkedPropertyId: "uxp_wicker_condo_rent", value: 31_800, status: "DRAFT", ownerId: AGENT, expiryAt: daysFromNow(21), notes: "Draft: 12-month lease terms." },
    { id: "uxpr_omar_sent", proposalNumber: "UX-PROP-002", leadId: L.omar, opportunityId: "uxo_omar_proposal", linkedPropertyId: "uxp_naperville_lot_a", value: 310_000, status: "SENT", sentAt: new Date(Date.now() - 2 * DAY), ownerId: AGENT, expiryAt: daysFromNow(12) },
    { id: "uxpr_zara_viewed", proposalNumber: "UX-PROP-003", leadId: conv.flow9_negotiation, opportunityId: "uxo_zara_proposal", linkedPropertyId: "uxp_arlington_sfh", value: 695_000, status: "VIEWED", sentAt: new Date(Date.now() - 3 * DAY), viewedAt: new Date(Date.now() - 1 * DAY), viewCount: 3, ownerId: MANAGER, expiryAt: daysFromNow(9) },
    { id: "uxpr_junaid_negotiation", proposalNumber: "UX-PROP-004", leadId: L.junaid, opportunityId: "uxo_junaid_negotiation", linkedPropertyId: "uxp_wicker_condo_sale", value: 595_000, status: "NEGOTIATION", sentAt: new Date(Date.now() - 8 * DAY), viewedAt: new Date(Date.now() - 7 * DAY), viewCount: 2, ownerId: MANAGER, expiryAt: daysFromNow(5), notes: "Client countered at $595,000." },
    { id: "uxpr_ayesha_accepted", proposalNumber: "UX-PROP-005", leadId: L.ayesha, opportunityId: "uxo_ayesha_won", linkedPropertyId: "uxp_lincoln_sfh_sold", value: 1_875_000, status: "ACCEPTED", sentAt: new Date(Date.now() - 10 * DAY), viewedAt: new Date(Date.now() - 9 * DAY), viewCount: 4, ownerId: OWNER },
    { id: "uxpr_shazia_rejected", proposalNumber: "UX-PROP-006", leadId: L.shazia, opportunityId: "uxo_shazia_lost", linkedPropertyId: "uxp_wicker_retail_sale", value: 485_000, status: "REJECTED", sentAt: new Date(Date.now() - 12 * DAY), viewedAt: new Date(Date.now() - 11 * DAY), viewCount: 1, ownerId: MANAGER },
  ];
  await prisma.proposal.createMany({ data: proposals.map((p) => ({ ...p, workspaceId: WS })) });

  // Site visits (CalendarEventStatus has no RESCHEDULED; a reschedule keeps SCHEDULED and records the old slot).
  const visit = (
    id: string,
    data: Omit<Prisma.CalendarEventUncheckedCreateInput, "id" | "workspaceId" | "endAt" | "type"> & { type?: "SITE_VISIT" | "MEETING" },
  ) =>
    prisma.calendarEvent.create({
      data: {
        type: "SITE_VISIT",
        ...data,
        id,
        workspaceId: WS,
        endAt: new Date(new Date(data.startAt).getTime() + HOUR),
        provider: "demo",
        externalEventId: `ux-demo-${id}`,
      },
    });
  await visit("uxv_adeel_upcoming", { title: "Showing: 1740 N Burling St", startAt: daysFromNow(1, 11), status: "SCHEDULED", location: "1740 N Burling St, Chicago, IL 60614", ownerId: AGENT, leadId: conv.flow7_site_visit, opportunityId: "uxo_adeel_discovery", contactId: "uxc_adeel", notes: "Customer asked for a viewing by text." });
  await visit("uxv_hassan_noshow", { title: "Showing: 1204 Brookdale Rd", startAt: daysFromNow(-9, 16), status: "NO_SHOW", location: "1204 Brookdale Rd, Naperville, IL 60540", ownerId: AGENT, leadId: L.hassan, opportunityId: "uxo_hassan_discovery", contactId: "uxc_hassan", notes: "Client did not arrive; phone off." });
  await visit("uxv_hassan_done", { title: "Showing: 1204 Brookdale Rd (second attempt)", startAt: daysFromNow(-4, 12), status: "COMPLETED", location: "1204 Brookdale Rd, Naperville, IL 60540", ownerId: AGENT, leadId: L.hassan, opportunityId: "uxo_hassan_discovery", contactId: "uxc_hassan", notes: "Outcome: liked the layout, wants to discuss price with family." });
  await visit("uxv_shazia_cancelled", { title: "Showing: 1533 N Milwaukee Ave retail", startAt: daysFromNow(-6, 15), status: "CANCELLED", location: "1533 N Milwaukee Ave, Chicago, IL 60622", ownerId: MANAGER, leadId: L.shazia, opportunityId: "uxo_shazia_lost", contactId: "uxc_shazia", notes: "Cancelled by client." });
  await visit("uxv_junaid_rescheduled", { title: "Showing: 1620 N Damen Ave #4S (rescheduled)", startAt: daysFromNow(2, 17), status: "SCHEDULED", location: "1620 N Damen Ave #4S, Chicago, IL 60622", ownerId: MANAGER, leadId: L.junaid, opportunityId: "uxo_junaid_negotiation", contactId: "uxc_junaid", notes: "Moved from yesterday at the client's request.", metadata: { rescheduled: true, previousStartAt: daysFromNow(-1, 17).toISOString() } });
  await visit("uxv_ayesha_done", { title: "Showing: 2214 N Cleveland Ave", startAt: daysFromNow(-12, 11), status: "COMPLETED", location: "2214 N Cleveland Ave, Chicago, IL 60614", ownerId: OWNER, leadId: L.ayesha, opportunityId: "uxo_ayesha_won", contactId: "uxc_ayesha", notes: "Outcome: offer made on the spot." });
  await visit("uxv_omar_done", { title: "Showing: Hobson Rd lot", startAt: daysFromNow(-7, 10), status: "COMPLETED", location: "0 Hobson Rd, Naperville, IL 60540", ownerId: AGENT, leadId: L.omar, opportunityId: "uxo_omar_proposal", contactId: "uxc_omar", notes: "Outcome: asked for a formal proposal." });
  await visit("uxv_pipeline_review", { type: "MEETING", title: "Weekly pipeline review", startAt: daysFromNow(3, 10), status: "SCHEDULED", location: "Office", ownerId: MANAGER });

  // Tasks (handoff tasks were already created by the engine above).
  const task = (data: Omit<Prisma.TaskCreateManyInput, "workspaceId">) => ({ ...data, workspaceId: WS });
  await prisma.task.createMany({
    data: [
      task({ title: "Call Felicia: Hyde Park listing is reserved", priority: "HIGH", dueAt: daysFromNow(-2, 12), ownerId: AGENT, leadId: L.fatima, opportunityId: "uxo_fatima_new" }),
      task({ title: "Send Wicker Park valuation report to Trevor", priority: "MEDIUM", dueAt: daysFromNow(-1, 15), ownerId: MANAGER, leadId: L.tariq, opportunityId: "uxo_tariq_seller" }),
      task({ title: "Re-engage Bilal (cold lead)", priority: "LOW", dueAt: daysFromNow(-4, 11), ownerId: AGENT, leadId: L.bilal }),
      task({ title: "Confirm tomorrow's site visit time with Adeel", priority: "HIGH", dueAt: daysFromNow(0, 18), ownerId: AGENT, leadId: conv.flow7_site_visit, opportunityId: "uxo_adeel_discovery", siteVisitId: "uxv_adeel_upcoming" }),
      task({ title: "Prepare lease proposal for Kiani Textiles", priority: "MEDIUM", status: "IN_PROGRESS", dueAt: daysFromNow(2, 12), ownerId: AGENT, leadId: L.mehwish, opportunityId: "uxo_mehwish_qualified", proposalId: "uxpr_mehwish_draft" }),
      task({ title: "Follow up on proposal UX-PROP-002", priority: "HIGH", dueAt: daysFromNow(3, 12), ownerId: AGENT, leadId: L.omar, opportunityId: "uxo_omar_proposal", proposalId: "uxpr_omar_sent" }),
      task({ title: "Arrange transfer paperwork for Ayesha", priority: "MEDIUM", dueAt: daysFromNow(5, 12), ownerId: OWNER, leadId: L.ayesha, opportunityId: "uxo_ayesha_won" }),
      task({ title: "Prepare counter-offer for Junaid", priority: "URGENT", dueAt: daysFromNow(0, 16), ownerId: MANAGER, leadId: L.junaid, opportunityId: "uxo_junaid_negotiation", proposalId: "uxpr_junaid_negotiation" }),
      task({ title: "Weekly pipeline review prep", priority: "LOW", dueAt: daysFromNow(3, 9), ownerId: MANAGER }),
      task({ title: "Share Hobson Rd plat with Owen", priority: "MEDIUM", status: "DONE", dueAt: daysFromNow(-8, 12), completedAt: daysFromNow(-8, 14), ownerId: AGENT, leadId: L.omar }),
      task({ title: "Post-visit follow-up call with Hassan", priority: "HIGH", status: "DONE", dueAt: daysFromNow(-3, 12), completedAt: daysFromNow(-3, 13), ownerId: AGENT, leadId: L.hassan, siteVisitId: "uxv_hassan_done" }),
      task({ title: "Book second viewing for Shazia", priority: "MEDIUM", status: "CANCELLED", dueAt: daysFromNow(-5, 12), ownerId: MANAGER, leadId: L.shazia }),
    ],
  });

  // Real scores from the scoring engine (reads messages, visits, opportunities seeded above).
  const allLeads = await prisma.lead.findMany({ where: { workspaceId: WS }, select: { id: true } });
  for (const l of allLeads) await scoreLead({ workspaceId: WS, leadId: l.id });

  // Automations last, so seeding itself does not fire them; the designer's actions will.
  await prisma.automation.createMany({
    data: DEFAULT_AUTOMATIONS.map((a) => ({
      id: `ux_${a.id}`,
      workspaceId: WS,
      name: a.name,
      trigger: a.trigger,
      enabled: true,
      paused: false,
      conditions: a.conditions as Prisma.InputJsonValue | undefined,
      actions: a.actions as unknown as Prisma.InputJsonValue,
    })),
  });

  const where = { workspaceId: WS };
  const conversations = await prisma.whatsAppMessage.groupBy({ by: ["conversationId"], where });
  const leadsByNote = await prisma.lead.findMany({ where: { ...where, notes: { startsWith: "UX scenario:" } }, select: { id: true, firstName: true, lastName: true, notes: true } });

  return {
    workspaceId: WS,
    counts: {
      leads: await prisma.lead.count({ where }),
      contacts: await prisma.contact.count({ where }),
      accounts: await prisma.account.count({ where }),
      properties: await prisma.property.count({ where }),
      opportunities: await prisma.opportunity.count({ where }),
      proposals: await prisma.proposal.count({ where }),
      tasks: await prisma.task.count({ where }),
      calendarEvents: await prisma.calendarEvent.count({ where }),
      whatsappConversations: conversations.length,
      whatsappMessages: await prisma.whatsAppMessage.count({ where }),
    },
    conversationLeadIds: conv,
    scenarios: leadsByNote.map((l) => ({
      leadId: l.id,
      name: `${l.firstName} ${l.lastName ?? ""}`.trim(),
      scenario: l.notes!.replace("UX scenario: ", ""),
    })),
  };
}
