import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { GoldenPathClient } from "./golden-path-client";

export default async function GoldenPathPage() {
  const session = await auth();
  if (!session?.user) return null;
  const workspaceId = session.user.workspaceId;

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
        eyebrow="Demo"
        title="Golden Path"
        description="Walk one lead from first contact to closed revenue using the real CRM APIs — no fake records, no bypassed business logic."
      />
      <GoldenPathClient
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
