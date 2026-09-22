import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { assertDemoMode } from "@/lib/demo-mode";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createLead } from "@/lib/leads/create-lead";
import { measuredRoute } from "@/lib/perf";

const DEMO_NOTICE = "Demo simulation — not connected to Meta Lead Ads.";

const DEMO_FACEBOOK_LEADS = [
  {
    firstName: "Bilal",
    lastName: "Aslam",
    phone: "+923011122334",
    preferredArea: "Bahria Town",
    propertyTypePref: "HOUSE" as const,
    propertyPurpose: "SALE" as const,
    budgetMin: 30000000,
    budgetMax: 55000000,
    bedroomPref: 4,
    estimatedValue: 42000000,
    intentType: "BUY" as const,
  },
  {
    firstName: "Ayesha",
    lastName: "Rehman",
    phone: "+923021234567",
    preferredArea: "DHA Phase 5",
    propertyTypePref: "APARTMENT" as const,
    propertyPurpose: "RENT" as const,
    budgetMin: 150000,
    budgetMax: 250000,
    bedroomPref: 3,
    estimatedValue: 2400000,
    intentType: "RENT" as const,
  },
  {
    firstName: "Usman",
    lastName: "Tariq",
    phone: "+923331239876",
    preferredArea: "Gulberg",
    propertyTypePref: "HOUSE" as const,
    propertyPurpose: "SALE" as const,
    budgetMin: 60000000,
    budgetMax: 90000000,
    bedroomPref: 5,
    estimatedValue: 75000000,
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
    });

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
