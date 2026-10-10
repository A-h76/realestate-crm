import type { LeadSource } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Sources with an automatic feed: WhatsApp (WhatsAppIntegration), website forms and Meta lead ads (IntakeSource). Every
 * other source reaches the CRM by CSV import or manual entry, so it is "manual only": leads are counted when someone enters them, and any that
 * nobody enters are invisible. That gap is exactly what this registry exists to expose.
 */
export type SourceCoverageRow = {
  source: LeadSource;
  declared: boolean;
  feed: "live" | "manual_only";
  lastEventAt: Date | null;
};
export type SourceCoverage = {
  declaredCount: number;
  liveCount: number;
  /** Declared sources first, then any undeclared source that has produced leads. */
  rows: SourceCoverageRow[];
};

export async function loadSourceCoverage(workspaceId: string): Promise<SourceCoverage> {
  const [declarations, integration, bySource, lastWhatsApp, intake] = await Promise.all([
    prisma.sourceDeclaration.findMany({ where: { workspaceId }, select: { source: true } }),
    prisma.whatsAppIntegration.findFirst({ where: { workspaceId, enabled: true }, select: { id: true } }),
    prisma.lead.groupBy({ by: ["source"], where: { workspaceId, deletedAt: null }, _max: { createdAt: true } }),
    // Real traffic only: the demo provider's rows are simulated.
    prisma.whatsAppMessage.findFirst({
      where: { workspaceId, direction: "INBOUND", provider: { not: "demo" } },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    prisma.intakeSource.findMany({ where: { workspaceId, enabled: true }, select: { kind: true } }),
  ]);
  const live = new Set<LeadSource>();
  if (integration) live.add("WHATSAPP_INBOUND");
  const FEED_SOURCE = { WEB_FORM: "WEB_FORM", META_LEADS: "FACEBOOK_ADS", EMAIL: "EMAIL" } as const;
  for (const { kind } of intake) live.add(FEED_SOURCE[kind]);
  const declared = new Set(declarations.map((d) => d.source));
  const sources = new Set<LeadSource>([...declared, ...bySource.map((b) => b.source)]);
  const rows = [...sources].map((source): SourceCoverageRow => {
    const isWhatsApp = source === "WHATSAPP_INBOUND";
    return {
      source,
      declared: declared.has(source),
      feed: live.has(source) ? "live" : "manual_only",
      lastEventAt: isWhatsApp ? (lastWhatsApp?.sentAt ?? null) : (bySource.find((b) => b.source === source)?._max.createdAt ?? null),
    };
  });
  rows.sort((a, b) => Number(b.declared) - Number(a.declared) || a.source.localeCompare(b.source));
  return {
    declaredCount: declared.size,
    liveCount: rows.filter((r) => r.declared && r.feed === "live").length,
    rows,
  };
}
