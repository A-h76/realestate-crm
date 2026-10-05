import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { assertDemoMode } from "@/lib/demo-mode";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createLead } from "@/lib/leads/create-lead";
import { measuredRoute } from "@/lib/perf";

const DEMO_NOTICE = "Demo simulation — not connected to Meta Lead Ads.";

// Fictional US buyers and renters. The 555-01xx line range is reserved for fictional use, so
// no simulated lead can resolve to a real person's phone.
const DEMO_FACEBOOK_LEADS = [
  {
    firstName: "Brianna",
    lastName: "Whitfield",
    phone: "+14155550142",
    preferredArea: "Noe Valley",
    propertyTypePref: "SINGLE_FAMILY" as const,
    propertyPurpose: "SALE" as const,
    budgetMin: 1_200_000,
    budgetMax: 1_650_000,
    bedroomPref: 4,
    estimatedValue: 1_450_000,
    intentType: "BUY" as const,
  },
  {
    firstName: "Marcus",
    lastName: "Delgado",
    phone: "+13125550188",
    preferredArea: "Logan Square",
    propertyTypePref: "CONDO" as const,
    propertyPurpose: "RENT" as const,
    budgetMin: 2_400,
    budgetMax: 3_200,
    bedroomPref: 2,
    estimatedValue: 38_400,
    intentType: "RENT" as const,
  },
  {
    firstName: "Danielle",
    lastName: "Okonkwo",
    phone: "+14805550173",
    preferredArea: "Arcadia",
    propertyTypePref: "SINGLE_FAMILY" as const,
    propertyPurpose: "SALE" as const,
    budgetMin: 650_000,
    budgetMax: 875_000,
    bedroomPref: 3,
    estimatedValue: 740_000,
    intentType: "BUY" as const,
  },
];

/**
 * Demo-only inbound lead simulator: creates a lead through the real lead
 * creation path (same audit + automations as any other lead), stamped with
 * a Facebook Ads source and an explicit "not real Meta Lead Ads" notice.
 */
export const POST = measuredRoute("POST /api/leads/simulate-inbound", async () => {
  try {
    assertDemoMode("Inbound lead simulation is only available in Demo Mode.");
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });

    const template = DEMO_FACEBOOK_LEADS[Math.floor(Math.random() * DEMO_FACEBOOK_LEADS.length)];
    const lead = await createLead(workspaceId, userId, {
      ...template,
      whatsappNumber: template.phone,
      source: "FACEBOOK_ADS",
      notes: DEMO_NOTICE,
    }, { allowDuplicate: true }); // demo-only: the same canned lead may be generated repeatedly

    return jsonOk(
      {
        lead,
        demo: true,
        notice: DEMO_NOTICE,
      },
      201,
    );
  } catch (error) {
    return jsonError(error);
  }
});
