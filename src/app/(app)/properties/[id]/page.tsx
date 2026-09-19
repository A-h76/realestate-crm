import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader, SectionHeading } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDatePK, formatPKR } from "@/lib/format";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const { id } = await params;

  const property = await prisma.property.findFirst({
    where: { id, workspaceId: session.user.workspaceId, deletedAt: null },
    include: {
      assignedAgent: true,
      ownerContact: true,
      opportunities: {
        where: { deletedAt: null },
        include: { stage: true },
        orderBy: { updatedAt: "desc" },
      },
      proposals: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      tasks: { where: { deletedAt: null }, orderBy: { dueAt: "asc" }, take: 10 },
      noteEntries: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { author: { select: { name: true } } },
      },
    },
  });

  if (!property) notFound();

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        eyebrow="Property"
        title={property.title}
        description={[property.area, property.city].filter(Boolean).join(", ") || undefined}
        actions={
          <>
            <Badge tone="neutral">{property.propertyType}</Badge>
            <Badge tone="accent">{property.purpose}</Badge>
            <Badge tone="neutral">{property.status}</Badge>
          </>
        }
      />

      <section>
        <SectionHeading>Listing</SectionHeading>
        <div className="grid gap-px border border-border bg-border sm:grid-cols-3">
          {[
            ["Price", formatPKR(Number(property.price))],
            ["Type", property.propertyType],
            ["Purpose", property.purpose],
            ["Area", property.area ?? "—"],
            ["City", property.city],
            [
              "Size",
              property.size != null ? `${property.size} ${property.sizeUnit}` : "—",
            ],
            ["Bedrooms", property.bedrooms?.toString() ?? "—"],
            ["Bathrooms", property.bathrooms?.toString() ?? "—"],
            ["Listing type", property.listingType],
            ["Verification", property.verificationStatus],
            ["Agent", property.assignedAgent?.name ?? "—"],
            [
              "Owner contact",
              property.ownerContact
                ? `${property.ownerContact.firstName} ${property.ownerContact.lastName ?? ""}`.trim()
                : "—",
            ],
            ["Date listed", formatDatePK(property.dateListed)],
            ["Last price update", formatDatePK(property.lastPriceUpdate)],
            ["Address", property.address ?? "—"],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-4 py-3">
              <div className="section-kicker">{label}</div>
              <div className="mt-1 text-sm break-words">{value}</div>
            </div>
          ))}
        </div>
        {property.description ? (
          <p className="mt-3 border border-border bg-surface px-4 py-3 text-sm whitespace-pre-wrap">
            {property.description}
          </p>
        ) : null}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <SectionHeading>Opportunities</SectionHeading>
          <div className="divide-y divide-border border border-border bg-surface">
            {property.opportunities.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">No linked opportunities.</div>
            ) : (
              property.opportunities.map((o) => (
                <Link
                  key={o.id}
                  href={`/opportunities/${o.id}`}
                  className="block px-4 py-3 hover:bg-background"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{o.name}</span>
                    <Badge tone="neutral">{o.dealSide}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {o.stage.name} · {formatCurrency(Number(o.value))}
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section>
          <SectionHeading>Proposals</SectionHeading>
          <div className="divide-y divide-border border border-border bg-surface">
            {property.proposals.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">No proposals.</div>
            ) : (
              property.proposals.map((p) => (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{p.proposalNumber}</span>
                    <Badge tone="neutral">{p.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted">{formatPKR(Number(p.value))}</div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {property.ownerContact ? (
        <div className="text-sm text-muted">
          Owner:{" "}
          <Link href={`/contacts/${property.ownerContact.id}`} className="text-foreground hover:text-accent">
            {property.ownerContact.firstName} {property.ownerContact.lastName ?? ""}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
