import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDatePK, formatPKR } from "@/lib/format";

function statusTone(status: string): "neutral" | "accent" | "warning" | "danger" | "success" {
  switch (status) {
    case "AVAILABLE":
      return "success";
    case "RESERVED":
      return "warning";
    case "SOLD":
    case "RENTED":
      return "accent";
    case "WITHDRAWN":
      return "danger";
    default:
      return "neutral";
  }
}

export default async function PropertiesPage() {
  const session = await auth();
  if (!session?.user) return null;

  const properties = await prisma.property.findMany({
    where: { workspaceId: session.user.workspaceId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    include: {
      assignedAgent: { select: { name: true } },
      ownerContact: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        eyebrow="Inventory"
        title="Properties"
        description="Listings priced in PKR with type, purpose, area, and status."
      />
      <div className="overflow-x-auto border border-border bg-surface">
        <table className="ops w-full min-w-[960px] text-left">
          <thead>
            <tr>
              <th className="px-3 py-2">Property</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Purpose</th>
              <th className="px-3 py-2">Area</th>
              <th className="px-3 py-2">Size</th>
              <th className="px-3 py-2">Price (₨)</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Agent</th>
              <th className="px-3 py-2">Listed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {properties.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted">
                  No properties yet.
                </td>
              </tr>
            ) : (
              properties.map((p) => (
                <tr key={p.id} className="hover:bg-background/80">
                  <td className="px-3 py-2">
                    <Link href={`/properties/${p.id}`} className="font-medium hover:text-accent">
                      {p.title}
                    </Link>
                    <div className="text-xs text-muted">{p.city}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone="neutral">{p.propertyType}</Badge>
                  </td>
                  <td className="px-3 py-2 text-muted">{p.purpose}</td>
                  <td className="px-3 py-2 text-muted">{p.area ?? "—"}</td>
                  <td className="px-3 py-2 mono text-xs">
                    {p.size != null ? `${p.size} ${p.sizeUnit}` : "—"}
                  </td>
                  <td className="px-3 py-2 mono font-medium">{formatPKR(Number(p.price))}</td>
                  <td className="px-3 py-2">
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-muted">{p.assignedAgent?.name ?? "—"}</td>
                  <td className="px-3 py-2 mono text-[11px] text-muted">
                    {formatDatePK(p.dateListed)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Badge tone="accent">Demo Mode</Badge>
    </div>
  );
}
