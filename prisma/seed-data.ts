import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { isDemoMode } from "../src/lib/demo-mode";

export const WORKSPACE_SLUG = "synas-realty-demo";

export function getDemoSeedPassword(envVar = "DEMO_SEED_PASSWORD"): string {
  const password = process.env[envVar];
  if (!password || password.length < 8) {
    throw new Error(
      `${envVar} must be set to a value at least 8 characters long before seeding demo data.`,
    );
  }
  return password;
}

const FIXED = {
  workspaceId: "ws_synas_realty_demo",
  brandingId: "brand_synas_realty",
  users: {
    ahmed: "user_ahmed_khan",
    sara: "user_sara_malik",
    bilal: "user_bilal_hussain",
  },
  stages: {
    NEW: "stage_new",
    QUALIFIED: "stage_qualified",
    DISCOVERY: "stage_discovery",
    SOLUTION: "stage_solution",
    PROPOSAL: "stage_proposal",
    NEGOTIATION: "stage_negotiation",
    WON: "stage_won",
    LOST: "stage_lost",
  },
} as const;

const AREAS = [
  "DHA Phase 6",
  "DHA Phase 8",
  "Bahria Town",
  "Gulberg",
  "Model Town",
  "Johar Town",
  "Cantt",
  "Wapda Town",
];

const FIRST = [
  "Ali", "Hassan", "Fatima", "Ayesha", "Usman", "Zainab", "Omar", "Maryam",
  "Hamza", "Sana", "Imran", "Nadia", "Tariq", "Hira", "Kamran", "Mehwish",
  "Fahad", "Rabia", "Shahid", "Iqra", "Asad", "Noor", "Waleed", "Saima",
  "Junaid", "Amna", "Rizwan", "Bushra", "Saad", "Mahnoor",
];

const LAST = [
  "Khan", "Ahmed", "Malik", "Hussain", "Raza", "Sheikh", "Butt", "Qureshi",
  "Chaudhry", "Syed", "Mirza", "Dar", "Awan", "Bajwa", "Gill", "Hashmi",
];

const SOURCES = [
  "ZAMEEN",
  "FACEBOOK_ADS",
  "REFERRAL",
  "WALK_IN",
  "SIGNBOARD",
  "WHATSAPP_INBOUND",
  "COLD_CALL",
  "EXISTING_CLIENT",
] as const;

const PROPERTY_TYPES = ["PLOT", "HOUSE", "APARTMENT", "COMMERCIAL", "AGRICULTURAL"] as const;

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000);
}

function daysFromNow(n: number) {
  return new Date(Date.now() + n * 86400000);
}

/** Deletes all workspace-scoped rows in FK-safe order (keeps User rows). */
export async function clearWorkspaceData(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<void> {
  await prisma.automationExecution.deleteMany({ where: { workspaceId } });
  await prisma.automation.deleteMany({ where: { workspaceId } });
  await prisma.webhookEvent.deleteMany({ where: { workspaceId } });
  await prisma.whatsAppIntegration.deleteMany({ where: { workspaceId } });
  await prisma.scoreHistory.deleteMany({ where: { workspaceId } });
  await prisma.intelligenceRun.deleteMany({ where: { workspaceId } });
  await prisma.attachment.deleteMany({ where: { workspaceId } });
  await prisma.notification.deleteMany({ where: { workspaceId } });
  await prisma.auditLog.deleteMany({ where: { workspaceId } });
  await prisma.note.deleteMany({ where: { workspaceId } });
  await prisma.task.deleteMany({ where: { workspaceId } });
  await prisma.whatsAppMessage.deleteMany({ where: { workspaceId } });
  await prisma.activity.deleteMany({ where: { workspaceId } });
  await prisma.calendarEvent.deleteMany({ where: { workspaceId } });
  await prisma.proposal.deleteMany({ where: { workspaceId } });
  await prisma.opportunity.deleteMany({ where: { workspaceId } });
  await prisma.lead.deleteMany({ where: { workspaceId } });
  await prisma.property.deleteMany({ where: { workspaceId } });
  await prisma.contact.deleteMany({ where: { workspaceId } });
  await prisma.account.deleteMany({ where: { workspaceId } });
  await prisma.pipelineStage.deleteMany({ where: { workspaceId } });
  await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
  await prisma.workspaceBranding.deleteMany({ where: { workspaceId } });
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
}

/** @deprecated Prefer clearWorkspaceData */
export async function wipeWorkspace(prisma: PrismaClient, workspaceId: string) {
  await clearWorkspaceData(prisma, workspaceId);
}

/** Full DB wipe for `prisma/seed.ts` (users + workspaces). */
export async function clearEntireDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.automationExecution.deleteMany();
  await prisma.automation.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.whatsAppIntegration.deleteMany();
  await prisma.rateLimitBucket.deleteMany();
  await prisma.scoreHistory.deleteMany();
  await prisma.intelligenceRun.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.note.deleteMany();
  await prisma.task.deleteMany();
  await prisma.whatsAppMessage.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.calendarEvent.deleteMany();
  await prisma.proposal.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.property.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.account.deleteMany();
  await prisma.pipelineStage.deleteMany();
  await prisma.workspaceMember.deleteMany();
  await prisma.workspaceBranding.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
}

export async function seedDemoWorkspace(prisma: PrismaClient) {
  if (!isDemoMode()) {
    throw new Error("Demo seed is blocked unless DEMO_MODE=true.");
  }
  const passwordHash = await bcrypt.hash(getDemoSeedPassword(), 10);

  // Ensure users exist (global)
  const users = [
    { id: FIXED.users.ahmed, email: "ahmed@synaslabs.demo", name: "Ahmed Khan" },
    { id: FIXED.users.sara, email: "sara@synaslabs.demo", name: "Sara Malik" },
    { id: FIXED.users.bilal, email: "bilal@synaslabs.demo", name: "Bilal Hussain" },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
        passwordHash,
        phone: u.id === FIXED.users.ahmed ? "+923001112233" : u.id === FIXED.users.sara ? "+923004445566" : "+923007778899",
      },
      update: {
        name: u.name,
        passwordHash,
        deletedAt: null,
      },
    });
  }

  // Wipe existing demo workspace data if present (idempotent re-seed / reset)
  const existing = await prisma.workspace.findUnique({ where: { slug: WORKSPACE_SLUG } });
  if (existing) {
    await clearWorkspaceData(prisma, existing.id);
  }

  const workspace = await prisma.workspace.create({
    data: {
      id: FIXED.workspaceId,
      name: "Synas Realty Demo",
      slug: WORKSPACE_SLUG,
      timezone: "Asia/Karachi",
      currency: "PKR",
      isDemo: true,
      branding: {
        create: {
          id: FIXED.brandingId,
          companyName: "Synas Realty",
          displayName: "Synas Labs · Lead-to-Sale",
          accentColor: "#0D9488",
          logoUrl: null,
        },
      },
      members: {
        create: [
          { userId: FIXED.users.ahmed, role: "OWNER" },
          { userId: FIXED.users.sara, role: "ADMIN" },
          { userId: FIXED.users.bilal, role: "AGENT" },
        ],
      },
    },
  });

  const stageDefs = [
    { id: FIXED.stages.NEW, name: "New", slug: "new", order: 1, probability: 10, accentColor: "#94A3B8" },
    { id: FIXED.stages.QUALIFIED, name: "Qualified", slug: "qualified", order: 2, probability: 20, accentColor: "#0D9488" },
    { id: FIXED.stages.DISCOVERY, name: "Discovery", slug: "discovery", order: 3, probability: 35, accentColor: "#0891B2" },
    { id: FIXED.stages.SOLUTION, name: "Solution", slug: "solution", order: 4, probability: 50, accentColor: "#2563EB" },
    { id: FIXED.stages.PROPOSAL, name: "Proposal", slug: "proposal", order: 5, probability: 65, accentColor: "#7C3AED" },
    { id: FIXED.stages.NEGOTIATION, name: "Negotiation", slug: "negotiation", order: 6, probability: 80, accentColor: "#D97706" },
    { id: FIXED.stages.WON, name: "Won", slug: "won", order: 7, probability: 100, accentColor: "#059669", isWon: true },
    { id: FIXED.stages.LOST, name: "Lost", slug: "lost", order: 8, probability: 0, accentColor: "#DC2626", isLost: true },
  ];

  for (const s of stageDefs) {
    await prisma.pipelineStage.create({
      data: {
        id: s.id,
        workspaceId: workspace.id,
        name: s.name,
        slug: s.slug,
        order: s.order,
        probability: s.probability,
        active: true,
        isWon: s.isWon ?? false,
        isLost: s.isLost ?? false,
        accentColor: s.accentColor,
      },
    });
  }

  const ownerIds = [FIXED.users.ahmed, FIXED.users.sara, FIXED.users.bilal];

  // Accounts (30)
  const accounts = [];
  for (let i = 0; i < 30; i++) {
    const company = `${LAST[i % LAST.length]} ${["Holdings", "Developers", "Investments", "Properties", "Group"][i % 5]}`;
    const account = await prisma.account.create({
      data: {
        id: `acc_demo_${String(i + 1).padStart(2, "0")}`,
        workspaceId: workspace.id,
        company,
        website: `https://example-${i + 1}.demo.pk`,
        industry: ["Real Estate", "Construction", "Investment", "Retail"][i % 4],
        companySize: ["1-10", "11-50", "51-200", "200+"][i % 4],
        locationArea: AREAS[i % AREAS.length],
        city: "Lahore",
        revenueRange: ["₨ 5–20M", "₨ 20–50M", "₨ 50–100M", "₨ 100M+"][i % 4],
        ownerId: ownerIds[i % ownerIds.length],
        notes: "Fictional demo account for Synas Labs demos.",
      },
    });
    accounts.push(account);
  }

  // Contacts (50)
  const contacts = [];
  for (let i = 0; i < 50; i++) {
    const firstName = FIRST[i % FIRST.length];
    const lastName = LAST[(i * 3) % LAST.length];
    const contact = await prisma.contact.create({
      data: {
        id: `ct_demo_${String(i + 1).padStart(2, "0")}`,
        workspaceId: workspace.id,
        accountId: accounts[i % accounts.length].id,
        firstName,
        lastName,
        title: ["Director", "Buyer", "Seller", "Investor", "Manager"][i % 5],
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@demo.pk`.replace(/\s/g, ""),
        phone: `+92300${String(1000000 + i).slice(0, 7)}`,
        whatsappNumber: `+92300${String(1000000 + i).slice(0, 7)}`,
        notes: "Fictional contact.",
      },
    });
    contacts.push(contact);
  }

  // Properties (22) — include DHA Phase 6 1 Kanal for matching
  const properties = [];
  const propertySeeds: Array<{
    id: string;
    title: string;
    area: string;
    type: (typeof PROPERTY_TYPES)[number];
    purpose: "SALE" | "RENT";
    size: number;
    unit: "MARLA" | "KANAL" | "SQFT";
    bedrooms?: number;
    price: number;
    status: "AVAILABLE" | "RESERVED" | "SOLD" | "RENTED";
  }> = [
    {
      id: "prop_dha6_1kanal",
      title: "DHA Phase 6 — 1 Kanal House",
      area: "DHA Phase 6",
      type: "HOUSE",
      purpose: "SALE",
      size: 1,
      unit: "KANAL",
      bedrooms: 5,
      price: 95000000,
      status: "AVAILABLE",
    },
    {
      id: "prop_dha6_92m",
      title: "1 Kanal House",
      area: "DHA Phase 6",
      type: "HOUSE",
      purpose: "SALE",
      size: 1,
      unit: "KANAL",
      bedrooms: 4,
      price: 92000000,
      status: "AVAILABLE",
    },
    {
      id: "prop_dha5_88m",
      title: "1 Kanal House",
      area: "DHA Phase 5",
      type: "HOUSE",
      purpose: "SALE",
      size: 1,
      unit: "KANAL",
      bedrooms: 4,
      price: 88000000,
      status: "AVAILABLE",
    },
  ];

  for (let i = 0; i < 21; i++) {
    const area = AREAS[i % AREAS.length];
    const type = PROPERTY_TYPES[i % PROPERTY_TYPES.length];
    propertySeeds.push({
      id: `prop_demo_${String(i + 1).padStart(2, "0")}`,
      title: `${area} ${type.charAt(0) + type.slice(1).toLowerCase()} ${i + 1}`,
      area,
      type,
      purpose: i % 5 === 0 ? "RENT" : "SALE",
      size: type === "PLOT" ? [5, 10, 1][i % 3] : [5, 10, 1, 2][i % 4],
      unit: type === "APARTMENT" ? "SQFT" : i % 3 === 0 ? "KANAL" : "MARLA",
      bedrooms: type === "HOUSE" || type === "APARTMENT" ? 2 + (i % 4) : undefined,
      price: 4500000 + i * 2750000,
      status: (["AVAILABLE", "AVAILABLE", "RESERVED", "SOLD", "RENTED"] as const)[i % 5],
    });
  }

  for (let i = 0; i < propertySeeds.length; i++) {
    const p = propertySeeds[i];
    const property = await prisma.property.create({
      data: {
        id: p.id,
        workspaceId: workspace.id,
        title: p.title,
        description: `Fictional listing in ${p.area} for demo purposes.`,
        address: `Street ${(i % 20) + 1}, ${p.area}`,
        area: p.area,
        city: "Lahore",
        propertyType: p.type,
        purpose: p.purpose,
        size: p.size,
        sizeUnit: p.unit,
        bedrooms: p.bedrooms,
        bathrooms: p.id === "prop_dha6_92m" ? 5 : p.id === "prop_dha5_88m" ? 4 : p.bedrooms ? Math.max(1, p.bedrooms - 1) : null,
        furnishedStatus: p.type === "APARTMENT" ? "Semi-furnished" : "Unfurnished",
        price: p.price,
        currency: "PKR",
        status: p.status,
        listingType: i % 3 === 0 ? "EXCLUSIVE" : "OPEN",
        ownerContactId: contacts[i % contacts.length].id,
        assignedAgentId: ownerIds[i % ownerIds.length],
        listingSource: SOURCES[i % SOURCES.length],
        verificationStatus: i % 4 === 0 ? "VERIFIED" : "PENDING",
        dateListed: daysAgo(30 - (i % 25)),
        lastPriceUpdate: daysAgo(i % 10),
      },
    });
    properties.push(property);
  }

  // Leads (50+) including required scenarios
  const leads = [];

  const noFollowUp = await prisma.lead.create({
    data: {
      id: "lead_no_followup_demo",
      workspaceId: workspace.id,
      firstName: "No Followup",
      lastName: "Demo",
      company: "Walk-in Prospect",
      email: "no.followup.demo@synaslabs.demo",
      phone: "+923211110001",
      whatsappNumber: "+923211110001",
      industry: "Real Estate",
      source: "WALK_IN",
      stage: "NEW",
      intentType: "BUY",
      preferredArea: "Gulberg",
      budgetMin: 40000000,
      budgetMax: 100000000,
      propertyPurpose: "SALE",
      propertyTypePref: "HOUSE",
      sizeUnitPref: "KANAL",
      bedroomPref: 5,
      timeline: "30 days",
      followUpDue: null,
      estimatedValue: 85000000,
      ownerId: FIXED.users.bilal,
      accountId: accounts[0].id,
      contactId: contacts[0].id,
      leadScore: 62,
      fitScore: 70,
      intentScore: 55,
      valueScore: 80,
      nextAction: null,
      lastActivityAt: daysAgo(2),
      notes: "REQUIRED DEMO: followUpDue null, stage NEW",
    },
  });
  leads.push(noFollowUp);

  const buyerPrefLead = await prisma.lead.create({
    data: {
      id: "lead_buyer_pref_dha6",
      workspaceId: workspace.id,
      firstName: "Ahmed",
      lastName: "Raza",
      email: "buyer.pref.dha@synaslabs.demo",
      phone: "+923211110099",
      whatsappNumber: "+923211110099",
      source: "WHATSAPP_INBOUND",
      stage: "QUALIFIED",
      intentType: "BUY",
      preferredArea: "DHA Phase 6",
      budgetMin: 70000000,
      budgetMax: 100000000,
      propertyPurpose: "SALE",
      propertyTypePref: "HOUSE",
      sizePrefMin: 1,
      sizePrefMax: 1,
      sizeUnitPref: "KANAL",
      bedroomPref: 4,
      bathroomPref: 5,
      furnishedPref: "Unfurnished",
      timeline: "45 days",
      followUpDue: daysFromNow(3),
      estimatedValue: 90000000,
      ownerId: FIXED.users.sara,
      accountId: accounts[2].id,
      contactId: contacts[2].id,
      leadScore: 84,
      fitScore: 87,
      intentScore: 72,
      valueScore: 81,
      nextAction: "Schedule site visit",
      lastActivityAt: daysAgo(1),
      notes: "FLAGSHIP DEMO: high-value DHA Phase 6 buyer. 1 Kanal brief, WhatsApp-active.",
    },
  });
  leads.push(buyerPrefLead);

  // Matching leads for DHA Phase 6 1 Kanal
  for (let m = 0; m < 3; m++) {
    const lead = await prisma.lead.create({
      data: {
        id: `lead_match_dha6_${m + 1}`,
        workspaceId: workspace.id,
        firstName: FIRST[m + 5],
        lastName: LAST[m + 2],
        email: `dha6.buyer${m + 1}@demo.pk`,
        phone: `+92321112000${m}`,
        whatsappNumber: `+92321112000${m}`,
        source: SOURCES[m % SOURCES.length],
        stage: "QUALIFIED",
        intentType: "BUY",
        preferredArea: "DHA Phase 6",
        budgetMin: 70000000,
        budgetMax: 120000000,
        propertyPurpose: "SALE",
        propertyTypePref: "HOUSE",
        sizePrefMin: 1,
        sizeUnitPref: "KANAL",
        bedroomPref: 5,
        timeline: "60 days",
        followUpDue: daysFromNow(2 + m),
        estimatedValue: 90000000 + m * 2000000,
        ownerId: ownerIds[m % ownerIds.length],
        accountId: accounts[(m + 1) % accounts.length].id,
        contactId: contacts[(m + 1) % contacts.length].id,
        leadScore: 75 + m,
        fitScore: 88,
        intentScore: 80,
        valueScore: 90,
        nextAction: "Share DHA Phase 6 shortlist",
        lastActivityAt: daysAgo(1),
      },
    });
    leads.push(lead);
  }

  for (let i = 0; i < 45; i++) {
    const firstName = FIRST[(i + 7) % FIRST.length];
    const lastName = LAST[(i + 4) % LAST.length];
    const area = AREAS[i % AREAS.length];
    const lead = await prisma.lead.create({
      data: {
        id: `lead_demo_${String(i + 1).padStart(2, "0")}`,
        workspaceId: workspace.id,
        firstName,
        lastName,
        company: i % 3 === 0 ? accounts[i % accounts.length].company : null,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.l${i}@demo.pk`,
        phone: `+92322${String(2000000 + i).slice(0, 7)}`,
        whatsappNumber: `+92322${String(2000000 + i).slice(0, 7)}`,
        industry: ["Real Estate", "Retail", "Tech", "Healthcare"][i % 4],
        source: SOURCES[i % SOURCES.length],
        stage: (["NEW", "CONTACTED", "QUALIFIED", "NURTURING", "CONVERTED"] as const)[i % 5],
        intentType: (["BUY", "SELL", "RENT", "INVEST", "UNKNOWN"] as const)[i % 5],
        preferredArea: area,
        budgetMin: 5000000 + i * 500000,
        budgetMax: 15000000 + i * 1000000,
        propertyPurpose: i % 4 === 0 ? "RENT" : "SALE",
        propertyTypePref: PROPERTY_TYPES[i % PROPERTY_TYPES.length],
        sizeUnitPref: "MARLA",
        bedroomPref: 2 + (i % 4),
        timeline: ["Immediate", "30 days", "60 days", "90 days"][i % 4],
        followUpDue: i % 7 === 0 ? daysAgo(2) : daysFromNow((i % 10) + 1),
        estimatedValue: 8000000 + i * 1500000,
        ownerId: ownerIds[i % ownerIds.length],
        accountId: accounts[i % accounts.length].id,
        contactId: contacts[i % contacts.length].id,
        leadScore: 40 + (i % 50),
        fitScore: 35 + (i % 55),
        intentScore: 30 + (i % 60),
        valueScore: 45 + (i % 50),
        nextAction: ["Call", "WhatsApp follow-up", "Send inventory", "Confirm visit"][i % 4],
        lastActivityAt: daysAgo(i % 12),
        createdAt: daysAgo(40 - (i % 35)),
      },
    });
    leads.push(lead);
  }

  // Opportunities (25+) including stalled high value + buyer + seller
  const opportunities = [];

  const stalled = await prisma.opportunity.create({
    data: {
      id: "opp_stalled_high_value",
      workspaceId: workspace.id,
      name: "Stalled High Value DHA",
      accountId: accounts[1].id,
      primaryContactId: contacts[1].id,
      leadId: leads[1].id,
      linkedPropertyId: "prop_dha6_1kanal",
      dealSide: "BUYER",
      value: 95000000,
      currency: "PKR",
      probability: 80,
      stageId: FIXED.stages.NEGOTIATION,
      ownerId: FIXED.users.ahmed,
      expectedCloseDate: daysFromNow(10),
      source: "ZAMEEN",
      description: "High-value DHA Phase 6 buyer — stalled in negotiation.",
      stageEnteredAt: daysAgo(21),
      createdAt: daysAgo(45),
    },
  });
  opportunities.push(stalled);

  const buyerOpp = await prisma.opportunity.create({
    data: {
      id: "opp_buyer_demo",
      workspaceId: workspace.id,
      name: "Ahmed Raza — DHA Phase 6 Kanal",
      accountId: accounts[2].id,
      primaryContactId: contacts[2].id,
      leadId: buyerPrefLead.id,
      linkedPropertyId: "prop_dha6_1kanal",
      dealSide: "BUYER",
      value: 92000000,
      currency: "PKR",
      probability: 35,
      stageId: FIXED.stages.DISCOVERY,
      ownerId: FIXED.users.sara,
      expectedCloseDate: daysFromNow(40),
      source: "WHATSAPP_INBOUND",
      description: "Buyer opportunity linked to property-preference lead.",
      notes: "REQUIRED DEMO: BUYER opp linked to preference lead",
      stageEnteredAt: daysAgo(5),
    },
  });
  opportunities.push(buyerOpp);

  const sellerOpp = await prisma.opportunity.create({
    data: {
      id: "opp_seller_demo",
      workspaceId: workspace.id,
      name: "Seller Listing — Gulberg Commercial",
      accountId: accounts[3].id,
      primaryContactId: contacts[3].id,
      leadId: leads[5].id,
      linkedPropertyId: properties[4].id,
      dealSide: "SELLER",
      value: 185000000,
      currency: "PKR",
      probability: 50,
      stageId: FIXED.stages.SOLUTION,
      ownerId: FIXED.users.bilal,
      expectedCloseDate: daysFromNow(25),
      source: "REFERRAL",
      description: "Seller listing opportunity for commercial asset.",
      notes: "REQUIRED DEMO: dealSide SELLER",
      stageEnteredAt: daysAgo(8),
    },
  });
  opportunities.push(sellerOpp);

  const openStageIds = [
    FIXED.stages.NEW,
    FIXED.stages.QUALIFIED,
    FIXED.stages.DISCOVERY,
    FIXED.stages.SOLUTION,
    FIXED.stages.PROPOSAL,
    FIXED.stages.NEGOTIATION,
    FIXED.stages.WON,
    FIXED.stages.LOST,
  ];

  for (let i = 0; i < 22; i++) {
    const stageId = openStageIds[i % openStageIds.length];
    const stageProb = stageDefs.find((s) => s.id === stageId)?.probability ?? 20;
    const opp = await prisma.opportunity.create({
      data: {
        id: `opp_demo_${String(i + 1).padStart(2, "0")}`,
        workspaceId: workspace.id,
        name: `${i % 2 === 0 ? "Buyer" : "Seller"} Deal ${AREAS[i % AREAS.length]} #${i + 1}`,
        accountId: accounts[i % accounts.length].id,
        primaryContactId: contacts[i % contacts.length].id,
        leadId: leads[(i + 4) % leads.length].id,
        linkedPropertyId: properties[i % properties.length].id,
        dealSide: i % 2 === 0 ? "BUYER" : "SELLER",
        value: 12000000 + i * 3500000,
        currency: "PKR",
        probability: stageProb,
        stageId,
        ownerId: ownerIds[i % ownerIds.length],
        expectedCloseDate: daysFromNow(7 + (i % 40)),
        source: SOURCES[i % SOURCES.length],
        description: "Demo opportunity.",
        stageEnteredAt: daysAgo(i % 15),
        createdAt: daysAgo(30 - (i % 25)),
      },
    });
    opportunities.push(opp);
  }

  // Proposals (15) including multi-viewed
  const proposals = [];
  const viewed = await prisma.proposal.create({
    data: {
      id: "prop_viewed_001",
      workspaceId: workspace.id,
      proposalNumber: "PROP-VIEWED-001",
      leadId: stalled.leadId,
      opportunityId: stalled.id,
      linkedPropertyId: stalled.linkedPropertyId,
      value: 95000000,
      currency: "PKR",
      status: "VIEWED",
      sentAt: daysAgo(5),
      viewedAt: daysAgo(1),
      viewCount: 4,
      expiryAt: daysFromNow(10),
      notes: "Viewed multiple times — demo scenario.",
      ownerId: FIXED.users.ahmed,
    },
  });
  proposals.push(viewed);

  for (let i = 0; i < 14; i++) {
    const opp = opportunities[(i + 3) % opportunities.length];
    const status = (["DRAFT", "SENT", "VIEWED", "NEGOTIATION", "ACCEPTED", "REJECTED", "EXPIRED"] as const)[i % 7];
    const proposal = await prisma.proposal.create({
      data: {
        id: `proposal_demo_${String(i + 1).padStart(2, "0")}`,
        workspaceId: workspace.id,
        proposalNumber: `PROP-DEMO-${String(i + 1).padStart(3, "0")}`,
        leadId: opp.leadId,
        opportunityId: opp.id,
        linkedPropertyId: opp.linkedPropertyId,
        value: Number(opp.value),
        currency: "PKR",
        status,
        sentAt: status === "DRAFT" ? null : daysAgo(3 + (i % 5)),
        viewedAt: ["VIEWED", "NEGOTIATION", "ACCEPTED"].includes(status) ? daysAgo(1) : null,
        viewCount: status === "VIEWED" ? 2 : status === "DRAFT" ? 0 : 1,
        expiryAt: daysFromNow(14),
        notes: "Demo proposal record.",
        ownerId: ownerIds[i % ownerIds.length],
      },
    });
    proposals.push(proposal);
  }

  // Calendar — upcoming site visit tomorrow (relative to seed run)
  const tomorrowStart = daysFromNow(1);
  tomorrowStart.setHours(11, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart.getTime() + 2 * 3600000);

  const siteVisit = await prisma.calendarEvent.create({
    data: {
      id: "cal_site_visit_tomorrow",
      workspaceId: workspace.id,
      title: "Demo Site Visit — DHA Phase 6",
      type: "SITE_VISIT",
      status: "SCHEDULED",
      startAt: tomorrowStart,
      endAt: tomorrowEnd,
      location: "DHA Phase 6 — 1 Kanal House, Lahore",
      notes: "REQUIRED DEMO: SITE_VISIT starting tomorrow",
      ownerId: FIXED.users.sara,
      leadId: buyerPrefLead.id,
      opportunityId: buyerOpp.id,
      contactId: contacts[2].id,
      provider: "demo",
      externalEventId: "demo-cal-site-visit-dha6",
      metadata: { demoNotice: "Demo Calendar event generated." },
    },
  });

  for (let i = 0; i < 12; i++) {
    await prisma.calendarEvent.create({
      data: {
        id: `cal_demo_${String(i + 1).padStart(2, "0")}`,
        workspaceId: workspace.id,
        title: i % 3 === 0 ? `Site Visit — ${AREAS[i % AREAS.length]}` : `Meeting — ${FIRST[i]}`,
        type: i % 3 === 0 ? "SITE_VISIT" : i % 3 === 1 ? "MEETING" : "FOLLOW_UP",
        status: "SCHEDULED",
        startAt: daysFromNow(i + 2),
        endAt: new Date(daysFromNow(i + 2).getTime() + 2 * 3600000),
        location: AREAS[i % AREAS.length],
        notes: "Demo calendar event.",
        ownerId: ownerIds[i % ownerIds.length],
        leadId: leads[i % leads.length].id,
        opportunityId: opportunities[i % opportunities.length].id,
        provider: "demo",
        externalEventId: `demo-cal-${i + 1}`,
      },
    });
  }

  // WhatsApp conversations (5+) — skip Ahmed (custom thread below)
  const waLeads = [noFollowUp, leads[2], leads[3], leads[4], leads[8]];
  for (let i = 0; i < waLeads.length; i++) {
    const lead = waLeads[i];
    const conversationId = `lead:${lead.id}`;
    const msgs: Prisma.WhatsAppMessageCreateManyInput[] = [
      {
        id: `wa_${i}_1`,
        workspaceId: workspace.id,
        conversationId,
        direction: "INBOUND",
        body: `Assalam o Alaikum — interested in property in ${lead.preferredArea ?? "Lahore"}.`,
        status: "READ",
        leadId: lead.id,
        provider: "demo",
        sentAt: daysAgo(3),
      },
      {
        id: `wa_${i}_2`,
        workspaceId: workspace.id,
        conversationId,
        direction: "OUTBOUND",
        body: "JazakAllah — sharing a shortlist shortly. When can we schedule a site visit?",
        status: "READ",
        leadId: lead.id,
        senderId: ownerIds[i % ownerIds.length],
        provider: "demo",
        sentAt: daysAgo(2),
        metadata: { demoNotice: "Demo WhatsApp message generated." },
      },
      {
        id: `wa_${i}_3`,
        workspaceId: workspace.id,
        conversationId,
        direction: "INBOUND",
        body: "Weekend works for me. Please confirm timing.",
        status: "DELIVERED",
        leadId: lead.id,
        provider: "demo",
        sentAt: daysAgo(1),
      },
    ];
    await prisma.whatsAppMessage.createMany({ data: msgs });
  }

  await prisma.whatsAppMessage.createMany({
    data: [
      {
        id: "wa_ahmed_1",
        workspaceId: workspace.id,
        conversationId: `lead:${buyerPrefLead.id}`,
        direction: "INBOUND",
        body: "Assalam o Alaikum, DHA Phase 6 mein 1 Kanal house dekhna hai, budget 9 crore ke around.",
        status: "READ",
        leadId: buyerPrefLead.id,
        opportunityId: buyerOpp.id,
        provider: "demo",
        sentAt: daysAgo(3),
      },
      {
        id: "wa_ahmed_2",
        workspaceId: workspace.id,
        conversationId: `lead:${buyerPrefLead.id}`,
        direction: "OUTBOUND",
        body: "Walaikum Assalam Ahmed. Phase 6 1 Kanal brief note kar liya. Shortlist bhejta hoon.",
        status: "READ",
        leadId: buyerPrefLead.id,
        opportunityId: buyerOpp.id,
        senderId: FIXED.users.sara,
        provider: "demo",
        sentAt: daysAgo(2),
      },
      {
        id: "wa_ahmed_3",
        workspaceId: workspace.id,
        conversationId: `lead:${buyerPrefLead.id}`,
        direction: "INBOUND",
        body: "Jee please. Weekend visit bhi possible hai.",
        status: "DELIVERED",
        leadId: buyerPrefLead.id,
        opportunityId: buyerOpp.id,
        provider: "demo",
        sentAt: daysAgo(1),
      },
    ],
  });

  // Tasks (30+)
  for (let i = 0; i < 30; i++) {
    const status = (["TODO", "IN_PROGRESS", "DONE", "CANCELLED"] as const)[i % 4];
    await prisma.task.create({
      data: {
        id: `task_demo_${String(i + 1).padStart(2, "0")}`,
        workspaceId: workspace.id,
        title: [
          "Follow up on WhatsApp",
          "Prepare proposal pack",
          "Confirm site visit",
          "Collect CNIC copy",
          "Negotiate final offer",
        ][i % 5],
        description: "Demo task",
        status,
        priority: (["LOW", "MEDIUM", "HIGH", "URGENT"] as const)[i % 4],
        dueAt: i % 5 === 0 ? daysAgo(1) : daysFromNow(i % 8),
        completedAt: status === "DONE" ? daysAgo(1) : null,
        ownerId: ownerIds[i % ownerIds.length],
        leadId: leads[i % leads.length].id,
        opportunityId: opportunities[i % opportunities.length].id,
        proposalId: i % 4 === 0 ? proposals[i % proposals.length].id : null,
        siteVisitId: i === 1 ? siteVisit.id : null,
      },
    });
  }

  // Activities (100+)
  const activityTypes = [
    "CALL",
    "WHATSAPP_MESSAGE",
    "EMAIL",
    "SITE_VISIT",
    "MEETING",
    "NOTE",
    "TASK",
    "FOLLOW_UP",
    "STAGE_CHANGE",
    "SYSTEM",
  ] as const;

  const activityRows: Prisma.ActivityCreateManyInput[] = [];
  for (let i = 0; i < 110; i++) {
    const type = activityTypes[i % activityTypes.length];
    activityRows.push({
      id: `act_demo_${String(i + 1).padStart(3, "0")}`,
      workspaceId: workspace.id,
      type,
      leadId: leads[i % leads.length].id,
      opportunityId: i % 2 === 0 ? opportunities[i % opportunities.length].id : null,
      accountId: accounts[i % accounts.length].id,
      contactId: contacts[i % contacts.length].id,
      ownerId: ownerIds[i % ownerIds.length],
      date: daysAgo(i % 40),
      status: type === "SITE_VISIT" && i % 7 === 0 ? "PLANNED" : "COMPLETED",
      title:
        type === "SITE_VISIT"
          ? `Site visit — ${AREAS[i % AREAS.length]}`
          : type === "WHATSAPP_MESSAGE"
            ? "WhatsApp message logged"
            : `${type.replace(/_/g, " ")} logged`,
      notes: "Demo activity timeline entry.",
      metadata: type === "SITE_VISIT" ? { badge: "SITE_VISIT" } : undefined,
    });
  }
  await prisma.activity.createMany({ data: activityRows });

  // Notes
  for (let i = 0; i < 20; i++) {
    await prisma.note.create({
      data: {
        id: `note_demo_${String(i + 1).padStart(2, "0")}`,
        workspaceId: workspace.id,
        body: `Demo note ${i + 1}: client prefers ${AREAS[i % AREAS.length]}.`,
        authorId: ownerIds[i % ownerIds.length],
        leadId: leads[i % leads.length].id,
        opportunityId: i % 2 === 0 ? opportunities[i % opportunities.length].id : null,
      },
    });
  }

  // Seed audit trail samples
  await prisma.auditLog.createMany({
    data: [
      {
        workspaceId: workspace.id,
        actorId: FIXED.users.ahmed,
        action: "LEAD_CREATED",
        entity: "Lead",
        entityId: noFollowUp.id,
        metadata: { scenario: "no_followup" },
      },
      {
        workspaceId: workspace.id,
        actorId: FIXED.users.ahmed,
        action: "OPPORTUNITY_CREATED",
        entity: "Opportunity",
        entityId: stalled.id,
        metadata: { scenario: "stalled_high_value" },
      },
      {
        workspaceId: workspace.id,
        actorId: FIXED.users.sara,
        action: "PROPOSAL_VIEWED",
        entity: "Proposal",
        entityId: viewed.id,
        metadata: { viewCount: 4 },
      },
      {
        workspaceId: workspace.id,
        actorId: FIXED.users.sara,
        action: "CALENDAR_EVENT_CREATED",
        entity: "CalendarEvent",
        entityId: siteVisit.id,
        metadata: { demo: true },
      },
    ],
  });

  const whatsappConversations = await prisma.whatsAppMessage.groupBy({
    by: ["conversationId"],
    where: { workspaceId: workspace.id },
  });

  await prisma.automation.createMany({
    data: [
      {
        id: "auto_lead_created",
        workspaceId: workspace.id,
        name: "Lead created → create task",
        trigger: "LEAD_CREATED",
        enabled: true,
        paused: false,
        actions: [{ type: "CREATE_TASK", title: "Contact new lead", priority: "HIGH", dueInDays: 1 }],
      },
      {
        id: "auto_lead_qualified",
        workspaceId: workspace.id,
        name: "Lead qualified → AI analysis",
        trigger: "LEAD_QUALIFIED",
        enabled: true,
        paused: false,
        actions: [{ type: "RUN_AI_ANALYSIS" }, { type: "RUN_SCORING" }, { type: "RUN_PROPERTY_MATCH" }],
      },
      {
        id: "auto_lead_scored_high",
        workspaceId: workspace.id,
        name: "Lead scored highly → priority action",
        trigger: "LEAD_SCORED_HIGH",
        enabled: true,
        paused: false,
        conditions: { minScore: 80 },
        actions: [{ type: "NOTIFY", title: "High-value lead", notifyType: "HIGH_VALUE_LEAD" }],
      },
      {
        id: "auto_strong_match",
        workspaceId: workspace.id,
        name: "Strong property match → outreach",
        trigger: "STRONG_PROPERTY_MATCH",
        enabled: true,
        paused: false,
        conditions: { minMatch: 80 },
        actions: [{ type: "CREATE_TASK", title: "Send property options", priority: "HIGH", dueInDays: 1 }],
      },
      {
        id: "auto_stage_changed",
        workspaceId: workspace.id,
        name: "Stage changed → follow-up",
        trigger: "STAGE_CHANGED",
        enabled: true,
        paused: false,
        actions: [{ type: "CREATE_TASK", title: "Follow up after stage change", priority: "HIGH", dueInDays: 2 }],
      },
      {
        id: "auto_proposal_sent",
        workspaceId: workspace.id,
        name: "Proposal sent → schedule follow-up",
        trigger: "PROPOSAL_SENT",
        enabled: true,
        paused: false,
        actions: [{ type: "CREATE_TASK", title: "Follow up on proposal", priority: "HIGH", dueInDays: 3 }],
      },
      {
        id: "auto_site_visit_done",
        workspaceId: workspace.id,
        name: "Site visit completed → next-step task",
        trigger: "SITE_VISIT_COMPLETED",
        enabled: true,
        paused: false,
        actions: [{ type: "CREATE_TASK", title: "Log visit notes and next step", priority: "HIGH", dueInDays: 1 }],
      },
      {
        id: "auto_lead_inactive",
        workspaceId: workspace.id,
        name: "Lead inactive → WhatsApp re-engagement",
        trigger: "LEAD_INACTIVE",
        enabled: true,
        paused: false,
        actions: [{ type: "CREATE_TASK", title: "Re-engage via WhatsApp", priority: "MEDIUM", dueInDays: 1 }],
      },
      {
        id: "auto_proposal_viewed",
        workspaceId: workspace.id,
        name: "Proposal viewed → notify owner",
        trigger: "PROPOSAL_VIEWED",
        enabled: true,
        paused: false,
        actions: [{ type: "NOTIFY", title: "Proposal viewed", notifyType: "PROPOSAL_VIEWED" }],
      },
    ],
  });

  await prisma.intelligenceRun.create({
    data: {
      id: "intel_ahmed_analysis",
      workspaceId: workspace.id,
      kind: "LEAD_ANALYSIS",
      model: "synas-demo-deterministic",
      promptVersion: "synas-intel-v1",
      entityType: "Lead",
      entityId: buyerPrefLead.id,
      leadId: buyerPrefLead.id,
      confidence: 94,
      status: "COMPLETED",
      output: {
        fitScore: 87,
        intentScore: 72,
        valueScore: 81,
        confidence: 94,
        niche: "DHA Phase 6 · 1 Kanal house · buyer",
        likelyNeed: "1 Kanal family house in DHA Phase 6 within ₨70–100M",
        painPoints: ["Wants DHA Phase 6 specifically", "Budget ceiling around ₨100,000,000", "45-day decision window"],
        recommendedAction: "Schedule site visit",
        reasoning:
          "Ahmed Raza is a qualified WhatsApp inbound buyer with a stated DHA Phase 6 / 1 Kanal brief and a ₨70–100M budget. Highest-leverage next step is a site visit against the 94% and 87% matches.",
      },
    },
  });

  await prisma.scoreHistory.create({
    data: {
      workspaceId: workspace.id,
      leadId: buyerPrefLead.id,
      previousScore: 72,
      newScore: 84,
      fitScore: 87,
      intentScore: 72,
      valueScore: 81,
      reason: "Lead scheduled a site visit and responded to WhatsApp follow-up.",
      createdAt: daysAgo(1),
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        workspaceId: workspace.id,
        userId: FIXED.users.sara,
        type: "HIGH_VALUE_LEAD",
        title: "High-value DHA Phase 6 buyer",
        body: "Ahmed Raza · ₨90,000,000 · 84 score",
        href: `/leads/${buyerPrefLead.id}`,
        entityType: "Lead",
        entityId: buyerPrefLead.id,
      },
      {
        workspaceId: workspace.id,
        userId: FIXED.users.sara,
        type: "SITE_VISIT_TOMORROW",
        title: "Site visit tomorrow",
        body: "DHA Phase 6 — 1 Kanal House at 11:00",
        href: "/calendar",
        entityType: "CalendarEvent",
        entityId: siteVisit.id,
      },
      {
        workspaceId: workspace.id,
        userId: FIXED.users.ahmed,
        type: "OPPORTUNITY_STALLED",
        title: "High-value opportunity stalled",
        body: "DHA negotiation idle 21 days",
        href: "/opportunities/opp_stalled_high_value",
        entityType: "Opportunity",
        entityId: stalled.id,
      },
      {
        workspaceId: workspace.id,
        userId: FIXED.users.ahmed,
        type: "PROPOSAL_VIEWED",
        title: "Proposal viewed 4 times",
        body: "PROP-VIEWED-001",
        href: "/proposals",
        entityType: "Proposal",
        entityId: viewed.id,
      },
    ],
  });

  return {
    workspaceId: workspace.id,
    userIds: {
      ahmed: FIXED.users.ahmed,
      sara: FIXED.users.sara,
      bilal: FIXED.users.bilal,
    },
    counts: {
      users: 3,
      workspaces: 1,
      pipelineStages: 8,
      leads: await prisma.lead.count({ where: { workspaceId: workspace.id } }),
      accounts: await prisma.account.count({ where: { workspaceId: workspace.id } }),
      contacts: await prisma.contact.count({ where: { workspaceId: workspace.id } }),
      properties: await prisma.property.count({ where: { workspaceId: workspace.id } }),
      opportunities: await prisma.opportunity.count({ where: { workspaceId: workspace.id } }),
      activities: await prisma.activity.count({ where: { workspaceId: workspace.id } }),
      tasks: await prisma.task.count({ where: { workspaceId: workspace.id } }),
      proposals: await prisma.proposal.count({ where: { workspaceId: workspace.id } }),
      whatsappMessages: await prisma.whatsAppMessage.count({
        where: { workspaceId: workspace.id },
      }),
      whatsappConversations: whatsappConversations.length,
      calendarEvents: await prisma.calendarEvent.count({
        where: { workspaceId: workspace.id },
      }),
      notes: await prisma.note.count({ where: { workspaceId: workspace.id } }),
    },
  };
}

export type SeedResult = Awaited<ReturnType<typeof seedDemoWorkspace>>;
export { FIXED };
