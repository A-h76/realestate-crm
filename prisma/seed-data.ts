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
    owner: "user_dana_whitfield",
    admin: "user_sofia_reyes",
    agent: "user_marcus_bell",
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

/** Chicago-metro neighborhoods and suburbs — the demo workspace's service area. */
const AREAS = [
  "Lincoln Park",
  "Logan Square",
  "Wicker Park",
  "Hyde Park",
  "Oak Park",
  "Evanston",
  "Naperville",
  "Arlington Heights",
];

/** City/state/ZIP for each area above, so demo listings carry a real US address shape. */
const AREA_ADDRESS: Record<string, { city: string; state: string; postalCode: string }> = {
  "Lincoln Park": { city: "Chicago", state: "IL", postalCode: "60614" },
  "Logan Square": { city: "Chicago", state: "IL", postalCode: "60647" },
  "Wicker Park": { city: "Chicago", state: "IL", postalCode: "60622" },
  "Hyde Park": { city: "Chicago", state: "IL", postalCode: "60615" },
  "Oak Park": { city: "Oak Park", state: "IL", postalCode: "60302" },
  Evanston: { city: "Evanston", state: "IL", postalCode: "60201" },
  Naperville: { city: "Naperville", state: "IL", postalCode: "60540" },
  "Arlington Heights": { city: "Arlington Heights", state: "IL", postalCode: "60004" },
};

const FIRST = [
  "James", "Olivia", "Ethan", "Sophia", "Liam", "Ava", "Noah", "Isabella",
  "Mason", "Mia", "Lucas", "Charlotte", "Henry", "Amelia", "Owen", "Harper",
  "Caleb", "Evelyn", "Nathan", "Abigail", "Jordan", "Nora", "Elijah", "Lily",
  "Marcus", "Grace", "Andre", "Ruby", "Devin", "Camila",
];

const LAST = [
  "Whitfield", "Reyes", "Bell", "Okonkwo", "Donovan", "Hayes", "Caldwell", "Nguyen",
  "Brennan", "Delgado", "Sorensen", "Mathis", "Kowalski", "Ferraro", "Abbott", "Prescott",
];

const SOURCES = [
  "ZILLOW",
  "REALTOR_COM",
  "WEB_FORM",
  "OPEN_HOUSE",
  "SIGN_CALL",
  "AGENT_REFERRAL",
  "REFERRAL",
  "WHATSAPP_INBOUND",
] as const;

const PROPERTY_TYPES = ["SINGLE_FAMILY", "CONDO", "TOWNHOUSE", "MULTI_FAMILY", "LAND"] as const;

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
    { id: FIXED.users.owner, email: "dana@synaslabs.demo", name: "Dana Whitfield" },
    { id: FIXED.users.admin, email: "sofia@synaslabs.demo", name: "Sofia Reyes" },
    { id: FIXED.users.agent, email: "marcus@synaslabs.demo", name: "Marcus Bell" },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
        passwordHash,
        phone: u.id === FIXED.users.owner ? "+13125550101" : u.id === FIXED.users.admin ? "+13125550102" : "+13125550103",
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
      timezone: "America/Chicago",
      currency: "USD",
      isDemo: true,
      package: "advanced", // the demo shows every module
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
          { userId: FIXED.users.owner, role: "OWNER" },
          { userId: FIXED.users.admin, role: "ADMIN" },
          { userId: FIXED.users.agent, role: "AGENT" },
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

  const ownerIds = [FIXED.users.owner, FIXED.users.admin, FIXED.users.agent];

  // Accounts (30)
  const accounts = [];
  for (let i = 0; i < 30; i++) {
    const company = `${LAST[i % LAST.length]} ${["Holdings", "Developers", "Investments", "Properties", "Group"][i % 5]}`;
    const account = await prisma.account.create({
      data: {
        id: `acc_demo_${String(i + 1).padStart(2, "0")}`,
        workspaceId: workspace.id,
        company,
        website: `https://example-${i + 1}.demo`,
        industry: ["Real Estate", "Construction", "Investment", "Retail"][i % 4],
        companySize: ["1-10", "11-50", "51-200", "200+"][i % 4],
        locationArea: AREAS[i % AREAS.length],
        city: AREA_ADDRESS[AREAS[i % AREAS.length]].city,
        revenueRange: ["$1–5M", "$5–20M", "$20–50M", "$50M+"][i % 4],
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
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@demo.example`.replace(/\s/g, ""),
        // 555-01xx is the reserved fictional US range: these can never dial a real person.
        phone: `+1312555${String(1100 + i).padStart(4, "0")}`,
        whatsappNumber: `+1312555${String(1100 + i).padStart(4, "0")}`,
        notes: "Fictional contact.",
      },
    });
    contacts.push(contact);
  }

  // Properties (24) — the Lincoln Park single-family listings exist so the demo lead has
  // strong, explainable matches to score against.
  const properties = [];
  const propertySeeds: Array<{
    id: string;
    title: string;
    area: string;
    type: (typeof PROPERTY_TYPES)[number];
    purpose: "SALE" | "RENT";
    size: number;
    unit: "SQFT" | "ACRE";
    bedrooms?: number;
    price: number;
    status: "AVAILABLE" | "RESERVED" | "SOLD" | "RENTED";
  }> = [
    {
      id: "prop_lincoln_park_sfh",
      title: "2214 N Cleveland Ave — Renovated Greystone",
      area: "Lincoln Park",
      type: "SINGLE_FAMILY",
      purpose: "SALE",
      size: 3850,
      unit: "SQFT",
      bedrooms: 5,
      price: 1_875_000,
      status: "AVAILABLE",
    },
    {
      id: "prop_lincoln_park_sfh_2",
      title: "1740 N Burling St — Classic Row House",
      area: "Lincoln Park",
      type: "SINGLE_FAMILY",
      purpose: "SALE",
      size: 3600,
      unit: "SQFT",
      bedrooms: 4,
      price: 1_725_000,
      status: "AVAILABLE",
    },
    {
      id: "prop_wicker_park_sfh",
      title: "1455 N Hoyne Ave — Updated Four Square",
      area: "Wicker Park",
      type: "SINGLE_FAMILY",
      purpose: "SALE",
      size: 3400,
      unit: "SQFT",
      bedrooms: 4,
      price: 1_595_000,
      status: "AVAILABLE",
    },
  ];

  const TYPE_LABEL: Record<(typeof PROPERTY_TYPES)[number], string> = {
    SINGLE_FAMILY: "Single-Family Home",
    CONDO: "Condo",
    TOWNHOUSE: "Townhouse",
    MULTI_FAMILY: "Two-Flat",
    LAND: "Vacant Lot",
  };

  for (let i = 0; i < 21; i++) {
    const area = AREAS[i % AREAS.length];
    const type = PROPERTY_TYPES[i % PROPERTY_TYPES.length];
    const isRent = i % 5 === 0;
    const isLand = type === "LAND";
    propertySeeds.push({
      id: `prop_demo_${String(i + 1).padStart(2, "0")}`,
      title: `${100 + i * 7} ${["N Oakley Ave", "W Shakespeare Ave", "S Dorchester Ave", "N Harvey Ave", "W Jackson Blvd"][i % 5]} — ${area} ${TYPE_LABEL[type]}`,
      area,
      type,
      purpose: isRent ? "RENT" : "SALE",
      // Land is listed in acres; everything else in finished square feet.
      size: isLand ? [0.17, 0.25, 0.34][i % 3] : [980, 1450, 1900, 2600][i % 4],
      unit: isLand ? "ACRE" : "SQFT",
      bedrooms: type === "LAND" ? undefined : 1 + (i % 4),
      // Rents are monthly; sale prices are Chicago-metro realistic.
      price: isRent ? 1_850 + (i % 6) * 420 : 325_000 + i * 62_500,
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
        description: `Fictional ${p.area} listing for demo purposes.`,
        // The street number/name is already in the title; keep the address consistent with it.
        address: p.title.split(" — ")[0],
        area: p.area,
        city: AREA_ADDRESS[p.area].city,
        state: AREA_ADDRESS[p.area].state,
        postalCode: AREA_ADDRESS[p.area].postalCode,
        propertyType: p.type,
        purpose: p.purpose,
        size: p.size,
        sizeUnit: p.unit,
        bedrooms: p.bedrooms,
        // US listings quote half baths, e.g. 3.5.
        bathrooms: p.bedrooms ? Math.max(1, p.bedrooms - 1) : null,
        furnishedStatus: p.purpose === "RENT" ? "Unfurnished" : null,
        price: p.price,
        currency: "USD",
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
      company: "Open House Walk-in",
      email: "no.followup.demo@synaslabs.demo",
      phone: "+17735550101",
      whatsappNumber: "+17735550101",
      industry: "Real Estate",
      source: "OPEN_HOUSE",
      stage: "NEW",
      intentType: "BUY",
      preferredArea: "Logan Square",
      budgetMin: 400_000,
      budgetMax: 650_000,
      propertyPurpose: "SALE",
      propertyTypePref: "SINGLE_FAMILY",
      sizeUnitPref: "SQFT",
      bedroomPref: 3,
      timeline: "30 days",
      followUpDue: null,
      estimatedValue: 525_000,
      ownerId: FIXED.users.agent,
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
      id: "lead_buyer_pref_lincoln_park",
      workspaceId: workspace.id,
      firstName: "Rebecca",
      lastName: "Donovan",
      email: "rebecca.donovan@demo.example",
      phone: "+17735550199",
      whatsappNumber: "+17735550199",
      source: "ZILLOW",
      stage: "QUALIFIED",
      intentType: "BUY",
      preferredArea: "Lincoln Park",
      budgetMin: 1_600_000,
      budgetMax: 1_950_000,
      propertyPurpose: "SALE",
      propertyTypePref: "SINGLE_FAMILY",
      sizePrefMin: 3200,
      sizePrefMax: 4200,
      sizeUnitPref: "SQFT",
      bedroomPref: 4,
      bathroomPref: 3,
      furnishedPref: null,
      timeline: "45 days",
      followUpDue: daysFromNow(3),
      estimatedValue: 1_800_000,
      ownerId: FIXED.users.admin,
      accountId: accounts[2].id,
      contactId: contacts[2].id,
      leadScore: 84,
      fitScore: 87,
      intentScore: 72,
      valueScore: 81,
      nextAction: "Schedule showing",
      lastActivityAt: daysAgo(1),
      notes: "DEMO: high-value Lincoln Park buyer, pre-approved, actively messaging.",
    },
  });
  leads.push(buyerPrefLead);

  // Competing buyers on the same Lincoln Park inventory, so the matcher has something real to rank.
  for (let m = 0; m < 3; m++) {
    const lead = await prisma.lead.create({
      data: {
        id: `lead_match_lincoln_park_${m + 1}`,
        workspaceId: workspace.id,
        firstName: FIRST[m + 5],
        lastName: LAST[m + 2],
        email: `lincolnpark.buyer${m + 1}@demo.example`,
        phone: `+1773555020${m}`,
        whatsappNumber: `+1773555020${m}`,
        source: SOURCES[m % SOURCES.length],
        stage: "QUALIFIED",
        intentType: "BUY",
        preferredArea: "Lincoln Park",
        budgetMin: 1_500_000,
        budgetMax: 2_100_000,
        propertyPurpose: "SALE",
        propertyTypePref: "SINGLE_FAMILY",
        sizePrefMin: 3000,
        sizeUnitPref: "SQFT",
        bedroomPref: 4,
        timeline: "60 days",
        followUpDue: daysFromNow(2 + m),
        estimatedValue: 1_800_000 + m * 60_000,
        ownerId: ownerIds[m % ownerIds.length],
        accountId: accounts[(m + 1) % accounts.length].id,
        contactId: contacts[(m + 1) % contacts.length].id,
        leadScore: 75 + m,
        fitScore: 88,
        intentScore: 80,
        valueScore: 90,
        nextAction: "Share Lincoln Park shortlist",
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
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.l${i}@demo.example`,
        phone: `+1847555${String(1000 + i).padStart(4, "0")}`,
        whatsappNumber: `+1847555${String(1000 + i).padStart(4, "0")}`,
        industry: ["Real Estate", "Retail", "Tech", "Healthcare"][i % 4],
        source: SOURCES[i % SOURCES.length],
        stage: (["NEW", "CONTACTED", "QUALIFIED", "NURTURING", "CONVERTED"] as const)[i % 5],
        intentType: (["BUY", "SELL", "RENT", "INVEST", "UNKNOWN"] as const)[i % 5],
        preferredArea: area,
        // Rent seekers think in monthly dollars, buyers in purchase price.
        budgetMin: i % 4 === 0 ? 1_800 + (i % 5) * 250 : 320_000 + i * 24_000,
        budgetMax: i % 4 === 0 ? 2_900 + (i % 5) * 300 : 480_000 + i * 31_000,
        propertyPurpose: i % 4 === 0 ? "RENT" : "SALE",
        propertyTypePref: PROPERTY_TYPES[i % PROPERTY_TYPES.length],
        sizeUnitPref: "SQFT",
        bedroomPref: 2 + (i % 4),
        timeline: ["Immediate", "30 days", "60 days", "90 days"][i % 4],
        followUpDue: i % 7 === 0 ? daysAgo(2) : daysFromNow((i % 10) + 1),
        estimatedValue: i % 4 === 0 ? 28_800 + i * 900 : 400_000 + i * 27_000,
        ownerId: ownerIds[i % ownerIds.length],
        accountId: accounts[i % accounts.length].id,
        contactId: contacts[i % contacts.length].id,
        leadScore: 40 + (i % 50),
        fitScore: 35 + (i % 55),
        intentScore: 30 + (i % 60),
        valueScore: 45 + (i % 50),
        nextAction: ["Call", "Text follow-up", "Send listings", "Confirm showing"][i % 4],
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
      name: "Stalled High-Value — Lincoln Park",
      accountId: accounts[1].id,
      primaryContactId: contacts[1].id,
      leadId: leads[1].id,
      linkedPropertyId: "prop_lincoln_park_sfh",
      dealSide: "BUYER",
      value: 1_875_000,
      currency: "USD",
      probability: 80,
      stageId: FIXED.stages.NEGOTIATION,
      ownerId: FIXED.users.owner,
      expectedCloseDate: daysFromNow(10),
      source: "ZILLOW",
      description: "High-value Lincoln Park buyer — stalled in negotiation.",
      stageEnteredAt: daysAgo(21),
      createdAt: daysAgo(45),
    },
  });
  opportunities.push(stalled);

  const buyerOpp = await prisma.opportunity.create({
    data: {
      id: "opp_buyer_demo",
      workspaceId: workspace.id,
      name: "Rebecca Donovan — Lincoln Park Greystone",
      accountId: accounts[2].id,
      primaryContactId: contacts[2].id,
      leadId: buyerPrefLead.id,
      linkedPropertyId: "prop_lincoln_park_sfh",
      dealSide: "BUYER",
      value: 1_825_000,
      currency: "USD",
      probability: 35,
      stageId: FIXED.stages.DISCOVERY,
      ownerId: FIXED.users.admin,
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
      name: "Seller Listing — Wicker Park Two-Flat",
      accountId: accounts[3].id,
      primaryContactId: contacts[3].id,
      leadId: leads[5].id,
      linkedPropertyId: properties[4].id,
      dealSide: "SELLER",
      value: 845_000,
      currency: "USD",
      probability: 50,
      stageId: FIXED.stages.SOLUTION,
      ownerId: FIXED.users.agent,
      expectedCloseDate: daysFromNow(25),
      source: "REFERRAL",
      description: "Seller-side listing mandate.",
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
        currency: "USD",
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
      currency: "USD",
      status: "VIEWED",
      sentAt: daysAgo(5),
      viewedAt: daysAgo(1),
      viewCount: 4,
      expiryAt: daysFromNow(10),
      notes: "Viewed multiple times — demo scenario.",
      ownerId: FIXED.users.owner,
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
        currency: "USD",
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

  // Calendar — upcoming showing tomorrow (relative to seed run)
  const tomorrowStart = daysFromNow(1);
  tomorrowStart.setHours(11, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart.getTime() + 2 * 3600000);

  const siteVisit = await prisma.calendarEvent.create({
    data: {
      id: "cal_site_visit_tomorrow",
      workspaceId: workspace.id,
      title: "Showing — 2214 N Cleveland Ave",
      type: "SITE_VISIT",
      status: "SCHEDULED",
      startAt: tomorrowStart,
      endAt: tomorrowEnd,
      location: "2214 N Cleveland Ave, Chicago, IL 60614",
      notes: "REQUIRED DEMO: SITE_VISIT starting tomorrow",
      ownerId: FIXED.users.admin,
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
        title: i % 3 === 0 ? `Showing — ${AREAS[i % AREAS.length]}` : `Meeting — ${FIRST[i]}`,
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
        body: `Hi — I'm interested in what you have in ${lead.preferredArea ?? "the area"}.`,
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
        body: "Thanks for reaching out! I'll send a shortlist shortly — when works for a showing?",
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
        body: "Hi, we're looking for a 4+ bedroom single-family home in Lincoln Park, up to about $1.9M.",
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
        body: "Thanks Rebecca — noted: Lincoln Park, 4+ beds, up to $1.9M. I'll send a shortlist today.",
        status: "READ",
        leadId: buyerPrefLead.id,
        opportunityId: buyerOpp.id,
        senderId: FIXED.users.admin,
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
          "Confirm showing",
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
        actorId: FIXED.users.owner,
        action: "LEAD_CREATED",
        entity: "Lead",
        entityId: noFollowUp.id,
        metadata: { scenario: "no_followup" },
      },
      {
        workspaceId: workspace.id,
        actorId: FIXED.users.owner,
        action: "OPPORTUNITY_CREATED",
        entity: "Opportunity",
        entityId: stalled.id,
        metadata: { scenario: "stalled_high_value" },
      },
      {
        workspaceId: workspace.id,
        actorId: FIXED.users.admin,
        action: "PROPOSAL_VIEWED",
        entity: "Proposal",
        entityId: viewed.id,
        metadata: { viewCount: 4 },
      },
      {
        workspaceId: workspace.id,
        actorId: FIXED.users.admin,
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
        niche: "Lincoln Park · single-family · buyer",
        likelyNeed: "4+ bedroom single-family home in Lincoln Park between $1.6M and $1.95M",
        painPoints: ["Wants Lincoln Park specifically", "Budget ceiling around $1,950,000", "45-day decision window"],
        recommendedAction: "Schedule showing",
        reasoning:
          "Rebecca Donovan is a qualified Zillow buyer with a stated Lincoln Park / 4-bedroom single-family brief and a $1.6–1.95M budget. Highest-leverage next step is a showing against the 94% and 87% matches.",
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
      reason: "Lead scheduled a showing and responded to the follow-up message.",
      createdAt: daysAgo(1),
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        workspaceId: workspace.id,
        userId: FIXED.users.admin,
        type: "HIGH_VALUE_LEAD",
        title: "High-value Lincoln Park buyer",
        body: "Rebecca Donovan · $1,800,000 · 84 score",
        href: `/leads/${buyerPrefLead.id}`,
        entityType: "Lead",
        entityId: buyerPrefLead.id,
      },
      {
        workspaceId: workspace.id,
        userId: FIXED.users.admin,
        type: "SITE_VISIT_TOMORROW",
        title: "Site visit tomorrow",
        body: "2214 N Cleveland Ave showing at 11:00 AM",
        href: "/calendar",
        entityType: "CalendarEvent",
        entityId: siteVisit.id,
      },
      {
        workspaceId: workspace.id,
        userId: FIXED.users.owner,
        type: "OPPORTUNITY_STALLED",
        title: "High-value opportunity stalled",
        body: "Lincoln Park negotiation idle 21 days",
        href: "/opportunities/opp_stalled_high_value",
        entityType: "Opportunity",
        entityId: stalled.id,
      },
      {
        workspaceId: workspace.id,
        userId: FIXED.users.owner,
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
      ahmed: FIXED.users.owner,
      sara: FIXED.users.admin,
      bilal: FIXED.users.agent,
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
