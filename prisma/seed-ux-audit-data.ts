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
 * Synthetic numbers in the +92 399 range, which is not an allocated
 * Pakistani mobile prefix, so no seeded number belongs to a real subscriber.
 */
const phone = (n: number) => `+9239900001${String(n).padStart(2, "0")}`;

// ---------------------------------------------------------------- properties

type PropertySeed = {
  id: string;
  title: string;
  area: string;
  type: "PLOT" | "HOUSE" | "APARTMENT" | "COMMERCIAL" | "AGRICULTURAL";
  purpose: "SALE" | "RENT";
  size: number;
  unit: "MARLA" | "KANAL" | "SQFT";
  beds?: number;
  price: number;
  status: "AVAILABLE" | "RESERVED" | "SOLD" | "RENTED" | "WITHDRAWN";
  agent: string;
  owner?: string;
};

// Deliberately no COMMERCIAL + RENT listing: that is the Flow 4 "no grounded match" scenario.
const PROPERTIES: PropertySeed[] = [
  { id: "uxp_dha2_5m_rent_q", title: "5 Marla House, DHA Phase 2 Block Q", area: "DHA Phase 2", type: "HOUSE", purpose: "RENT", size: 5, unit: "MARLA", beds: 3, price: 48_000, status: "AVAILABLE", agent: AGENT, owner: "uxc_landlord_a" },
  { id: "uxp_dha2_5m_rent_t", title: "5 Marla House, DHA Phase 2 Block T", area: "DHA Phase 2", type: "HOUSE", purpose: "RENT", size: 5, unit: "MARLA", beds: 3, price: 52_000, status: "AVAILABLE", agent: AGENT, owner: "uxc_landlord_b" },
  { id: "uxp_dha2_5m_rent_s", title: "5 Marla House, DHA Phase 2 Block S", area: "DHA Phase 2", type: "HOUSE", purpose: "RENT", size: 5, unit: "MARLA", beds: 3, price: 50_000, status: "RENTED", agent: MANAGER, owner: "uxc_landlord_a" },
  { id: "uxp_dha5_10m_rent", title: "10 Marla House, DHA Phase 5", area: "DHA Phase 5", type: "HOUSE", purpose: "RENT", size: 10, unit: "MARLA", beds: 4, price: 120_000, status: "AVAILABLE", agent: MANAGER },
  { id: "uxp_dha6_1k_sale", title: "1 Kanal House, DHA Phase 6", area: "DHA Phase 6", type: "HOUSE", purpose: "SALE", size: 1, unit: "KANAL", beds: 5, price: 95_000_000, status: "SOLD", agent: OWNER, owner: "uxc_seller_dha6" },
  { id: "uxp_dha6_10m_sale", title: "10 Marla House, DHA Phase 6", area: "DHA Phase 6", type: "HOUSE", purpose: "SALE", size: 10, unit: "MARLA", beds: 4, price: 42_000_000, status: "AVAILABLE", agent: AGENT },
  { id: "uxp_bahria_8m_sale", title: "8 Marla House, Bahria Town Sector C", area: "Bahria Town", type: "HOUSE", purpose: "SALE", size: 8, unit: "MARLA", beds: 3, price: 21_500_000, status: "AVAILABLE", agent: AGENT },
  { id: "uxp_johar_5m_sale", title: "5 Marla House, Johar Town", area: "Johar Town", type: "HOUSE", purpose: "SALE", size: 5, unit: "MARLA", beds: 3, price: 16_500_000, status: "RESERVED", agent: AGENT },
  { id: "uxp_model_1k_sale", title: "1 Kanal House, Model Town", area: "Model Town", type: "HOUSE", purpose: "SALE", size: 1, unit: "KANAL", beds: 6, price: 120_000_000, status: "SOLD", agent: MANAGER },
  { id: "uxp_valencia_10m_sale", title: "10 Marla House, Valencia", area: "Valencia", type: "HOUSE", purpose: "SALE", size: 10, unit: "MARLA", beds: 4, price: 32_000_000, status: "AVAILABLE", agent: MANAGER },
  { id: "uxp_cantt_10m_sale", title: "10 Marla House, Cantt (seller listing)", area: "Cantt", type: "HOUSE", purpose: "SALE", size: 10, unit: "MARLA", beds: 4, price: 45_000_000, status: "AVAILABLE", agent: AGENT, owner: "uxc_tariq" },
  { id: "uxp_dha9_1k_plot", title: "1 Kanal Plot, DHA Phase 9 Prism", area: "DHA Phase 9", type: "PLOT", purpose: "SALE", size: 1, unit: "KANAL", price: 38_000_000, status: "AVAILABLE", agent: AGENT },
  { id: "uxp_bahria_5m_plot", title: "5 Marla Plot, Bahria Town Jasmine Block", area: "Bahria Town", type: "PLOT", purpose: "SALE", size: 5, unit: "MARLA", price: 7_800_000, status: "AVAILABLE", agent: MANAGER },
  { id: "uxp_dha7_10m_plot", title: "10 Marla Plot, DHA Phase 7", area: "DHA Phase 7", type: "PLOT", purpose: "SALE", size: 10, unit: "MARLA", price: 18_500_000, status: "WITHDRAWN", agent: AGENT },
  { id: "uxp_gulberg_apt_rent", title: "2 Bed Apartment, Gulberg III", area: "Gulberg", type: "APARTMENT", purpose: "RENT", size: 1100, unit: "SQFT", beds: 2, price: 85_000, status: "AVAILABLE", agent: AGENT },
  { id: "uxp_gulberg_apt_sale", title: "3 Bed Apartment, Gulberg II", area: "Gulberg", type: "APARTMENT", purpose: "SALE", size: 1650, unit: "SQFT", beds: 3, price: 36_000_000, status: "AVAILABLE", agent: MANAGER },
  { id: "uxp_bahria_apt_rent", title: "1 Bed Apartment, Bahria Town", area: "Bahria Town", type: "APARTMENT", purpose: "RENT", size: 650, unit: "SQFT", beds: 1, price: 45_000, status: "RENTED", agent: AGENT },
  { id: "uxp_gulberg_shop_sale", title: "Ground-floor Shop, Gulberg MM Alam Road", area: "Gulberg", type: "COMMERCIAL", purpose: "SALE", size: 450, unit: "SQFT", price: 55_000_000, status: "AVAILABLE", agent: MANAGER },
  { id: "uxp_dha5_office_sale", title: "Office Floor, DHA Phase 5 CCA", area: "DHA Phase 5", type: "COMMERCIAL", purpose: "SALE", size: 3200, unit: "SQFT", price: 140_000_000, status: "RESERVED", agent: OWNER },
  { id: "uxp_bedian_farm", title: "4 Kanal Farmhouse Plot, Bedian Road", area: "Bedian Road", type: "AGRICULTURAL", purpose: "SALE", size: 4, unit: "KANAL", price: 60_000_000, status: "AVAILABLE", agent: OWNER },
];

// ------------------------------------------------------------------ contacts

const CONTACTS: Array<{ id: string; firstName: string; lastName: string; title: string; phoneNo: number; accountId?: string }> = [
  { id: "uxc_landlord_a", firstName: "Naveed", lastName: "Akhtar", title: "Landlord", phoneNo: 51 },
  { id: "uxc_landlord_b", firstName: "Samina", lastName: "Riaz", title: "Landlord", phoneNo: 52 },
  { id: "uxc_seller_dha6", firstName: "Khalid", lastName: "Mansoor", title: "Seller", phoneNo: 53 },
  { id: "uxc_tariq", firstName: "Tariq", lastName: "Mahmood", title: "Seller", phoneNo: 14 },
  { id: "uxc_ayesha", firstName: "Ayesha", lastName: "Rafiq", title: "Buyer", phoneNo: 11 },
  { id: "uxc_omar", firstName: "Omar", lastName: "Siddiqui", title: "Director", phoneNo: 12, accountId: "uxa_siddiqui" },
  { id: "uxc_mehwish", firstName: "Mehwish", lastName: "Kiani", title: "HR Manager", phoneNo: 13, accountId: "uxa_kiani" },
  { id: "uxc_shazia", firstName: "Shazia", lastName: "Noor", title: "Investor", phoneNo: 15, accountId: "uxa_noor" },
  { id: "uxc_fatima", firstName: "Fatima", lastName: "Zahid", title: "Buyer", phoneNo: 17 },
  { id: "uxc_hassan", firstName: "Hassan", lastName: "Raza", title: "Buyer", phoneNo: 18 },
  { id: "uxc_junaid", firstName: "Junaid", lastName: "Akram", title: "Buyer", phoneNo: 20 },
  { id: "uxc_saad", firstName: "Saad", lastName: "Iqbal", title: "Tenant", phoneNo: 21 },
  // Pre-existing contacts for WhatsApp leads, so their inbound messages link to a contact.
  { id: "uxc_adeel", firstName: "Adeel", lastName: "Anwar", title: "Buyer", phoneNo: 7 },
  { id: "uxc_zara", firstName: "Zara", lastName: "Hussain", title: "Buyer", phoneNo: 8 },
];

const ACCOUNTS = [
  { id: "uxa_siddiqui", company: "Siddiqui Holdings (Demo)", industry: "Investment", city: "Lahore" },
  { id: "uxa_kiani", company: "Kiani Textiles (Demo)", industry: "Manufacturing", city: "Lahore" },
  { id: "uxa_noor", company: "Noor Retail Group (Demo)", industry: "Retail", city: "Lahore" },
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
    profileName: "Usman Tariq",
    startHoursAgo: 0.5,
    steps: [{ in: "AoA" }, { in: "5 marla DHA Phase 2 rent pe chahiye, budget 50k." }, { in: "House" }],
  },
  {
    key: "flow2_incomplete",
    scenario: "Flow 2: incomplete requirement (type + area known; purpose, budget and size missing)",
    phoneNo: 2,
    profileName: "Hira Aslam",
    startHoursAgo: 3,
    steps: [{ in: "AoA" }, { in: "House chahiye" }, { in: "DHA" }],
  },
  {
    key: "flow3_grounded_match",
    scenario: "Flow 3 + 6: fully qualified, grounded DHA Phase 2 rent matches; ready to become an opportunity",
    phoneNo: 3,
    profileName: "Kamran Ashraf",
    startHoursAgo: 26,
    steps: [
      { in: "Assalam o Alaikum, 5 marla house DHA Phase 2 mein rent pe chahiye, 50k tak budget hai" },
      { in: "Ji" },
      { in: "Pehli wali kahan hai?" },
      { set: { stage: "QUALIFIED", owner: { connect: { id: AGENT } }, timeline: "30 days", nextAction: "Create opportunity and book a viewing" } },
    ],
  },
  {
    key: "flow4_no_match",
    scenario: "Flow 4: full requirement but no grounded inventory match, human handoff (AI still replying)",
    phoneNo: 4,
    profileName: "Nadia Farooq",
    startHoursAgo: 5,
    steps: [{ in: "AoA" }, { in: "Gulberg mein office rent pe chahiye, 2000 sqft, budget 5 lakh" }],
  },
  {
    key: "flow5_handoff_pending",
    scenario: "Flow 5: owner/documents question triggered a handoff, waiting for an agent to take over",
    phoneNo: 5,
    profileName: "Faisal Mehmood",
    startHoursAgo: 2,
    steps: [
      { in: "DHA Phase 6 mein 10 marla house khareedna hai, budget 4 crore se 4.5 crore" },
      { in: "Ji" },
      { in: "Owner se direct baat ho sakti hai? Documents clear hain?" },
    ],
  },
  {
    key: "takeover_done",
    scenario: "Agent takeover: customer asked for a human, agent took over and is replying manually",
    phoneNo: 6,
    profileName: "Rabia Saleem",
    startHoursAgo: 30,
    steps: [
      { in: "AoA" },
      { in: "Bahria Town mein 8 marla house purchase karna hai, 2 crore tak" },
      { in: "Kisi agent se baat karni hai please" },
      { takeOver: AGENT },
      { send: "Walaikum Assalam Rabia, main UX Audit Agent. Sector C wala 8 marla house abhi available hai. Aap kab call pe baat kar sakti hain?", by: AGENT },
      { in: "Ji theek hai, shaam 5 baje call kar lein" },
    ],
  },
  {
    key: "flow7_site_visit",
    scenario: "Flow 7: qualified buyer asked for a viewing; site visit scheduled for tomorrow",
    phoneNo: 7,
    profileName: "Adeel Anwar",
    startHoursAgo: 50,
    steps: [
      { in: "DHA Phase 6 mein 10 marla house khareedna hai, budget 4 crore se 4.5 crore" },
      { in: "Ji" },
      { set: { stage: "QUALIFIED", owner: { connect: { id: AGENT } }, timeline: "45 days" } },
      { in: "Kal visit ho sakti hai?" },
    ],
  },
  {
    key: "flow9_negotiation",
    scenario: "Flow 8 + 9: proposal viewed, buyer asking for a better price (negotiation handoff)",
    phoneNo: 8,
    profileName: "Zara Hussain",
    startHoursAgo: 20,
    steps: [
      { in: "Valencia mein 10 marla house chahiye purchase ke liye, budget 3 crore se 3.5 crore" },
      { set: { stage: "QUALIFIED", owner: { connect: { id: MANAGER } }, timeline: "30 days" } },
      { in: "Proposal dekh liya. Final price kya hogi? Thora kam ho sakta hai?" },
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
    profileName: "Imran Qadir",
    startHoursAgo: 72,
    steps: [
      { in: "Bahria Town mein 5 marla plot chahiye purchase, budget 75 lakh se 80 lakh" },
      { takeOver: MANAGER },
      { send: "Imran sahib, Jasmine Block plot ka map aur payment plan bhej diya hai. Kal call kar loon?", by: MANAGER },
      { in: "Ji theek hai, kal 12 baje" },
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
      await takeOverLead(WS, leadId, step.takeOver);
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
      timezone: "Asia/Karachi",
      currency: "PKR",
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
      address: `Street ${i + 3}, ${p.area}, Lahore`,
      area: p.area,
      city: "Lahore",
      propertyType: p.type,
      purpose: p.purpose,
      size: p.size,
      sizeUnit: p.unit,
      bedrooms: p.beds ?? null,
      bathrooms: p.beds ? Math.max(1, p.beds - 1) : null,
      furnishedStatus: p.type === "APARTMENT" ? "Semi-furnished" : "Unfurnished",
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
    const created = await createLead(WS, body.ownerId ?? null, { ...body, contactId, notes: `UX scenario: ${body.notes}` });
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
    ayesha: await lead("uxc_ayesha", 40, { ...person("uxc_ayesha"), source: "REFERRAL", stage: "QUALIFIED", intentType: "BUY", preferredArea: "DHA Phase 6", propertyPurpose: "SALE", propertyTypePref: "HOUSE", sizePrefMin: 1, sizePrefMax: 1, sizeUnitPref: "KANAL", bedroomPref: 5, budgetMin: 90_000_000, budgetMax: 100_000_000, estimatedValue: 95_000_000, timeline: "30 days", ownerId: OWNER, notes: "Won deal (Flow 9 reference): 1 Kanal DHA Phase 6, high value" }),
    omar: await lead("uxc_omar", 21, { ...person("uxc_omar"), company: "Siddiqui Holdings (Demo)", accountId: "uxa_siddiqui", source: "ZAMEEN", stage: "QUALIFIED", intentType: "INVEST", preferredArea: "DHA Phase 9", propertyPurpose: "SALE", propertyTypePref: "PLOT", sizePrefMin: 1, sizePrefMax: 1, sizeUnitPref: "KANAL", budgetMin: 35_000_000, budgetMax: 40_000_000, estimatedValue: 38_000_000, timeline: "60 days", ownerId: AGENT, followUpDue: daysFromNow(3), notes: "Flow 8: proposal sent, waiting for the client to view it" }),
    mehwish: await lead("uxc_mehwish", 9, { ...person("uxc_mehwish"), company: "Kiani Textiles (Demo)", accountId: "uxa_kiani", source: "FACEBOOK_ADS", stage: "QUALIFIED", intentType: "RENT", preferredArea: "Gulberg", propertyPurpose: "RENT", propertyTypePref: "APARTMENT", bedroomPref: 2, budgetMin: 80_000, budgetMax: 90_000, estimatedValue: 1_020_000, timeline: "Immediate", ownerId: AGENT, followUpDue: daysFromNow(2), notes: "Corporate lease, proposal still in draft" }),
    tariq: await lead("uxc_tariq", 15, { ...person("uxc_tariq"), source: "SIGNBOARD", stage: "QUALIFIED", intentType: "SELL", preferredArea: "Cantt", propertyPurpose: "SALE", propertyTypePref: "HOUSE", sizePrefMin: 10, sizePrefMax: 10, sizeUnitPref: "MARLA", estimatedValue: 45_000_000, ownerId: AGENT, followUpDue: daysFromNow(-1), notes: "Seller-side opportunity (listing mandate)" }),
    shazia: await lead("uxc_shazia", 30, { ...person("uxc_shazia"), company: "Noor Retail Group (Demo)", accountId: "uxa_noor", source: "WALK_IN", stage: "LOST", intentType: "INVEST", preferredArea: "Gulberg", propertyPurpose: "SALE", propertyTypePref: "COMMERCIAL", budgetMin: 40_000_000, budgetMax: 50_000_000, estimatedValue: 55_000_000, ownerId: MANAGER, notes: "Lost deal: chose a larger unit elsewhere" }),
    fatima: await lead("uxc_fatima", 6, { ...person("uxc_fatima"), source: "ZAMEEN", stage: "CONTACTED", intentType: "BUY", preferredArea: "Johar Town", propertyPurpose: "SALE", propertyTypePref: "HOUSE", sizePrefMin: 5, sizePrefMax: 5, sizeUnitPref: "MARLA", budgetMin: 15_000_000, budgetMax: 17_000_000, estimatedValue: 16_500_000, timeline: "60 days", ownerId: AGENT, followUpDue: daysFromNow(-2), notes: "Contacted; matching listing is RESERVED (early-stage opportunity)" }),
    hassan: await lead("uxc_hassan", 18, { ...person("uxc_hassan"), source: "EXISTING_CLIENT", stage: "QUALIFIED", intentType: "BUY", preferredArea: "Bahria Town", propertyPurpose: "SALE", propertyTypePref: "HOUSE", sizePrefMin: 8, sizePrefMax: 8, sizeUnitPref: "MARLA", budgetMin: 20_000_000, budgetMax: 22_000_000, estimatedValue: 21_500_000, timeline: "45 days", ownerId: AGENT, followUpDue: daysFromNow(1), notes: "Site visit history: one no-show, then completed" }),
    junaid: await lead("uxc_junaid", 25, { ...person("uxc_junaid"), source: "REFERRAL", stage: "QUALIFIED", intentType: "BUY", preferredArea: "Gulberg", propertyPurpose: "SALE", propertyTypePref: "APARTMENT", bedroomPref: 3, budgetMin: 34_000_000, budgetMax: 37_000_000, estimatedValue: 36_000_000, timeline: "30 days", ownerId: MANAGER, notes: "Late-stage negotiation; site visit was rescheduled" }),
    saad: await lead("uxc_saad", 35, { ...person("uxc_saad"), source: "WHATSAPP_INBOUND", stage: "QUALIFIED", intentType: "RENT", preferredArea: "Bahria Town", propertyPurpose: "RENT", propertyTypePref: "APARTMENT", bedroomPref: 1, budgetMin: 40_000, budgetMax: 50_000, estimatedValue: 540_000, ownerId: AGENT, notes: "Won rental (12-month lease signed)" }),
    bilal: await lead(null, 45, { firstName: "Bilal", lastName: "Chaudhry", phone: phone(16), source: "COLD_CALL", stage: "NURTURING", intentType: "UNKNOWN", ownerId: AGENT, followUpDue: daysFromNow(-4), notes: "Low priority: no budget or area given yet" }),
    maryam: await lead(null, 50, { firstName: "Maryam", lastName: "Khalid", phone: phone(19), email: "maryam.khalid@example.com", source: "FACEBOOK_ADS", stage: "LOST", intentType: "BUY", preferredArea: "Model Town", propertyPurpose: "SALE", propertyTypePref: "HOUSE", budgetMax: 60_000_000, ownerId: MANAGER, notes: "Lost at lead stage: bought through another agency" }),
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

  await opp("uxo_ayesha_won", { name: "Ayesha Rafiq: 1 Kanal DHA Phase 6", leadId: L.ayesha, primaryContactId: "uxc_ayesha", linkedPropertyId: "uxp_dha6_1k_sale", dealSide: "BUYER", value: 95_000_000, stage: "won", daysInStage: 3, ownerId: OWNER, expectedCloseDate: daysFromNow(-3), source: "REFERRAL", createdAt: new Date(Date.now() - 38 * DAY), description: "Closed. Token paid, transfer paperwork in progress." });
  await opp("uxo_saad_won", { name: "Saad Iqbal: Bahria Town apartment lease", leadId: L.saad, primaryContactId: "uxc_saad", linkedPropertyId: "uxp_bahria_apt_rent", dealSide: "BUYER", value: 540_000, stage: "won", daysInStage: 12, ownerId: AGENT, expectedCloseDate: daysFromNow(-12), createdAt: new Date(Date.now() - 33 * DAY), description: "12-month lease at PKR 45,000/month." });
  await opp("uxo_omar_proposal", { name: "Omar Siddiqui: 1 Kanal plot DHA Phase 9", leadId: L.omar, accountId: "uxa_siddiqui", primaryContactId: "uxc_omar", linkedPropertyId: "uxp_dha9_1k_plot", dealSide: "BUYER", value: 38_000_000, stage: "proposal", daysInStage: 2, ownerId: AGENT, expectedCloseDate: daysFromNow(20), source: "ZAMEEN", createdAt: new Date(Date.now() - 18 * DAY) });
  await opp("uxo_zara_proposal", { name: "Zara Hussain: 10 Marla Valencia", leadId: conv.flow9_negotiation, primaryContactId: "uxc_zara", linkedPropertyId: "uxp_valencia_10m_sale", dealSide: "BUYER", value: 32_000_000, stage: "proposal", daysInStage: 4, ownerId: MANAGER, expectedCloseDate: daysFromNow(10), createdAt: new Date(Date.now() - 9 * DAY), description: "Near close. Client viewed the proposal and wants to negotiate." });
  await opp("uxo_junaid_negotiation", { name: "Junaid Akram: 3 Bed Gulberg II", leadId: L.junaid, primaryContactId: "uxc_junaid", linkedPropertyId: "uxp_gulberg_apt_sale", dealSide: "BUYER", value: 36_000_000, stage: "negotiation", daysInStage: 6, ownerId: MANAGER, expectedCloseDate: daysFromNow(12), source: "REFERRAL", createdAt: new Date(Date.now() - 22 * DAY) });
  await opp("uxo_mehwish_qualified", { name: "Kiani Textiles: Gulberg III corporate lease", leadId: L.mehwish, accountId: "uxa_kiani", primaryContactId: "uxc_mehwish", linkedPropertyId: "uxp_gulberg_apt_rent", dealSide: "BUYER", value: 1_020_000, stage: "qualified", daysInStage: 3, ownerId: AGENT, expectedCloseDate: daysFromNow(14), source: "FACEBOOK_ADS", createdAt: new Date(Date.now() - 7 * DAY), description: "12-month lease at PKR 85,000/month." });
  await opp("uxo_adeel_discovery", { name: "Adeel Anwar: 10 Marla DHA Phase 6", leadId: conv.flow7_site_visit, primaryContactId: "uxc_adeel", linkedPropertyId: "uxp_dha6_10m_sale", dealSide: "BUYER", value: 42_000_000, stage: "discovery", daysInStage: 1, ownerId: AGENT, expectedCloseDate: daysFromNow(35), createdAt: new Date(Date.now() - 2 * DAY) });
  await opp("uxo_hassan_discovery", { name: "Hassan Raza: 8 Marla Bahria Town", leadId: L.hassan, primaryContactId: "uxc_hassan", linkedPropertyId: "uxp_bahria_8m_sale", dealSide: "BUYER", value: 21_500_000, stage: "discovery", daysInStage: 8, ownerId: AGENT, expectedCloseDate: daysFromNow(30), source: "EXISTING_CLIENT", createdAt: new Date(Date.now() - 16 * DAY) });
  await opp("uxo_tariq_seller", { name: "Tariq Mahmood: Cantt listing mandate", leadId: L.tariq, primaryContactId: "uxc_tariq", linkedPropertyId: "uxp_cantt_10m_sale", dealSide: "SELLER", value: 45_000_000, stage: "solution", daysInStage: 5, ownerId: AGENT, expectedCloseDate: daysFromNow(45), source: "SIGNBOARD", createdAt: new Date(Date.now() - 14 * DAY) });
  await opp("uxo_fatima_new", { name: "Fatima Zahid: 5 Marla Johar Town", leadId: L.fatima, primaryContactId: "uxc_fatima", linkedPropertyId: "uxp_johar_5m_sale", dealSide: "BUYER", value: 16_500_000, stage: "new", daysInStage: 2, ownerId: AGENT, expectedCloseDate: daysFromNow(60), source: "ZAMEEN", createdAt: new Date(Date.now() - 2 * DAY), description: "Listing is RESERVED; confirm with owner before pitching." });
  await opp("uxo_shazia_lost", { name: "Noor Retail: MM Alam Road shop", leadId: L.shazia, accountId: "uxa_noor", primaryContactId: "uxc_shazia", linkedPropertyId: "uxp_gulberg_shop_sale", dealSide: "BUYER", value: 55_000_000, stage: "lost", daysInStage: 5, ownerId: MANAGER, source: "WALK_IN", createdAt: new Date(Date.now() - 28 * DAY), lostReason: "Chose a larger unit through another agency" });

  for (const [leadId, oppId, actor] of [[L.ayesha, "uxo_ayesha_won", OWNER], [L.saad, "uxo_saad_won", AGENT]] as const) {
    await convertLeadOnOpportunityWon({ workspaceId: WS, actorId: actor, leadId, opportunityId: oppId });
  }

  // Proposals: one per supported status the demo flows need.
  const proposals: Array<Omit<Prisma.ProposalCreateManyInput, "workspaceId">> = [
    { id: "uxpr_mehwish_draft", proposalNumber: "UX-PROP-001", leadId: L.mehwish, opportunityId: "uxo_mehwish_qualified", linkedPropertyId: "uxp_gulberg_apt_rent", value: 1_020_000, status: "DRAFT", ownerId: AGENT, expiryAt: daysFromNow(21), notes: "Draft: 12-month lease terms." },
    { id: "uxpr_omar_sent", proposalNumber: "UX-PROP-002", leadId: L.omar, opportunityId: "uxo_omar_proposal", linkedPropertyId: "uxp_dha9_1k_plot", value: 38_000_000, status: "SENT", sentAt: new Date(Date.now() - 2 * DAY), ownerId: AGENT, expiryAt: daysFromNow(12) },
    { id: "uxpr_zara_viewed", proposalNumber: "UX-PROP-003", leadId: conv.flow9_negotiation, opportunityId: "uxo_zara_proposal", linkedPropertyId: "uxp_valencia_10m_sale", value: 32_000_000, status: "VIEWED", sentAt: new Date(Date.now() - 3 * DAY), viewedAt: new Date(Date.now() - 1 * DAY), viewCount: 3, ownerId: MANAGER, expiryAt: daysFromNow(9) },
    { id: "uxpr_junaid_negotiation", proposalNumber: "UX-PROP-004", leadId: L.junaid, opportunityId: "uxo_junaid_negotiation", linkedPropertyId: "uxp_gulberg_apt_sale", value: 35_000_000, status: "NEGOTIATION", sentAt: new Date(Date.now() - 8 * DAY), viewedAt: new Date(Date.now() - 7 * DAY), viewCount: 2, ownerId: MANAGER, expiryAt: daysFromNow(5), notes: "Client countered at PKR 35M." },
    { id: "uxpr_ayesha_accepted", proposalNumber: "UX-PROP-005", leadId: L.ayesha, opportunityId: "uxo_ayesha_won", linkedPropertyId: "uxp_dha6_1k_sale", value: 95_000_000, status: "ACCEPTED", sentAt: new Date(Date.now() - 10 * DAY), viewedAt: new Date(Date.now() - 9 * DAY), viewCount: 4, ownerId: OWNER },
    { id: "uxpr_shazia_rejected", proposalNumber: "UX-PROP-006", leadId: L.shazia, opportunityId: "uxo_shazia_lost", linkedPropertyId: "uxp_gulberg_shop_sale", value: 55_000_000, status: "REJECTED", sentAt: new Date(Date.now() - 12 * DAY), viewedAt: new Date(Date.now() - 11 * DAY), viewCount: 1, ownerId: MANAGER },
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
  await visit("uxv_adeel_upcoming", { title: "Site visit: 10 Marla DHA Phase 6", startAt: daysFromNow(1, 11), status: "SCHEDULED", location: "10 Marla House, DHA Phase 6", ownerId: AGENT, leadId: conv.flow7_site_visit, opportunityId: "uxo_adeel_discovery", contactId: "uxc_adeel", notes: "Customer asked on WhatsApp for a viewing." });
  await visit("uxv_hassan_noshow", { title: "Site visit: 8 Marla Bahria Town", startAt: daysFromNow(-9, 16), status: "NO_SHOW", location: "Bahria Town Sector C", ownerId: AGENT, leadId: L.hassan, opportunityId: "uxo_hassan_discovery", contactId: "uxc_hassan", notes: "Client did not arrive; phone off." });
  await visit("uxv_hassan_done", { title: "Site visit: 8 Marla Bahria Town (second attempt)", startAt: daysFromNow(-4, 12), status: "COMPLETED", location: "Bahria Town Sector C", ownerId: AGENT, leadId: L.hassan, opportunityId: "uxo_hassan_discovery", contactId: "uxc_hassan", notes: "Outcome: liked the layout, wants to discuss price with family." });
  await visit("uxv_shazia_cancelled", { title: "Site visit: MM Alam Road shop", startAt: daysFromNow(-6, 15), status: "CANCELLED", location: "Gulberg, MM Alam Road", ownerId: MANAGER, leadId: L.shazia, opportunityId: "uxo_shazia_lost", contactId: "uxc_shazia", notes: "Cancelled by client." });
  await visit("uxv_junaid_rescheduled", { title: "Site visit: 3 Bed Gulberg II (rescheduled)", startAt: daysFromNow(2, 17), status: "SCHEDULED", location: "Gulberg II", ownerId: MANAGER, leadId: L.junaid, opportunityId: "uxo_junaid_negotiation", contactId: "uxc_junaid", notes: "Moved from yesterday at the client's request.", metadata: { rescheduled: true, previousStartAt: daysFromNow(-1, 17).toISOString() } });
  await visit("uxv_ayesha_done", { title: "Site visit: 1 Kanal DHA Phase 6", startAt: daysFromNow(-12, 11), status: "COMPLETED", location: "DHA Phase 6", ownerId: OWNER, leadId: L.ayesha, opportunityId: "uxo_ayesha_won", contactId: "uxc_ayesha", notes: "Outcome: offer made on the spot." });
  await visit("uxv_omar_done", { title: "Site visit: DHA Phase 9 plot", startAt: daysFromNow(-7, 10), status: "COMPLETED", location: "DHA Phase 9 Prism", ownerId: AGENT, leadId: L.omar, opportunityId: "uxo_omar_proposal", contactId: "uxc_omar", notes: "Outcome: asked for a formal proposal." });
  await visit("uxv_pipeline_review", { type: "MEETING", title: "Weekly pipeline review", startAt: daysFromNow(3, 10), status: "SCHEDULED", location: "Office", ownerId: MANAGER });

  // Tasks (handoff tasks were already created by the engine above).
  const task = (data: Omit<Prisma.TaskCreateManyInput, "workspaceId">) => ({ ...data, workspaceId: WS });
  await prisma.task.createMany({
    data: [
      task({ title: "Call Fatima: Johar Town listing is reserved", priority: "HIGH", dueAt: daysFromNow(-2, 12), ownerId: AGENT, leadId: L.fatima, opportunityId: "uxo_fatima_new" }),
      task({ title: "Send Cantt valuation report to Tariq", priority: "MEDIUM", dueAt: daysFromNow(-1, 15), ownerId: MANAGER, leadId: L.tariq, opportunityId: "uxo_tariq_seller" }),
      task({ title: "Re-engage Bilal (cold lead)", priority: "LOW", dueAt: daysFromNow(-4, 11), ownerId: AGENT, leadId: L.bilal }),
      task({ title: "Confirm tomorrow's site visit time with Adeel", priority: "HIGH", dueAt: daysFromNow(0, 18), ownerId: AGENT, leadId: conv.flow7_site_visit, opportunityId: "uxo_adeel_discovery", siteVisitId: "uxv_adeel_upcoming" }),
      task({ title: "Prepare lease proposal for Kiani Textiles", priority: "MEDIUM", status: "IN_PROGRESS", dueAt: daysFromNow(2, 12), ownerId: AGENT, leadId: L.mehwish, opportunityId: "uxo_mehwish_qualified", proposalId: "uxpr_mehwish_draft" }),
      task({ title: "Follow up on proposal UX-PROP-002", priority: "HIGH", dueAt: daysFromNow(3, 12), ownerId: AGENT, leadId: L.omar, opportunityId: "uxo_omar_proposal", proposalId: "uxpr_omar_sent" }),
      task({ title: "Arrange transfer paperwork for Ayesha", priority: "MEDIUM", dueAt: daysFromNow(5, 12), ownerId: OWNER, leadId: L.ayesha, opportunityId: "uxo_ayesha_won" }),
      task({ title: "Prepare counter-offer for Junaid", priority: "URGENT", dueAt: daysFromNow(0, 16), ownerId: MANAGER, leadId: L.junaid, opportunityId: "uxo_junaid_negotiation", proposalId: "uxpr_junaid_negotiation" }),
      task({ title: "Weekly pipeline review prep", priority: "LOW", dueAt: daysFromNow(3, 9), ownerId: MANAGER }),
      task({ title: "Share DHA Phase 9 plot map with Omar", priority: "MEDIUM", status: "DONE", dueAt: daysFromNow(-8, 12), completedAt: daysFromNow(-8, 14), ownerId: AGENT, leadId: L.omar }),
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
