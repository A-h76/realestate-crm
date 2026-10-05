import { requireAppAccess } from "@/lib/app-access";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LeadJourneyClient } from "./lead-journey-client";

export default async function LeadJourneyPage() {
  const { workspaceId } = await requireAppAccess();

  const [stages, property] = await Promise.all([
    prisma.pipelineStage.findMany({
      where: { workspaceId, slug: { in: ["new", "proposal", "won"] } },
      select: { id: true, slug: true },
    }),
    prisma.property.findFirst({
      where: { workspaceId, deletedAt: null, status: "AVAILABLE" },
      select: { id: true, title: true },
    }),
  ]);
  const stageBySlug = Object.fromEntries(stages.map((s) => [s.slug, s.id]));

  return (
    <div className="page-in space-y-8 p-6 md:p-10">
      <PageHeader
        eyebrow="Guided demo"
        title="Lead Journey (guided demo)"
        description="Walk one lead from first contact to closed revenue using the real CRM APIs — no fake records, no bypassed business logic."
      />
      <LeadJourneyClient
        stageIds={{
          new: stageBySlug.new ?? null,
          proposal: stageBySlug.proposal ?? null,
          won: stageBySlug.won ?? null,
        }}
        property={property}
      />
    </div>
  );
}
