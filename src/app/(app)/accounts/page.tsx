import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDatePK } from "@/lib/format";

export default async function AccountsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const accounts = await prisma.account.findMany({
    where: { workspaceId: session.user.workspaceId, deletedAt: null },
    orderBy: { company: "asc" },
    include: {
      owner: { select: { name: true } },
      _count: { select: { contacts: true, leads: true, opportunities: true } },
    },
  });

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        eyebrow="Organizations"
        title="Accounts"
        description="Companies and developer groups linked to leads and deals."
      />
      <div className="overflow-x-auto border border-border bg-surface">
        <table className="ops w-full min-w-[800px] text-left">
          <thead>
            <tr>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Industry</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Contacts</th>
              <th className="px-3 py-2">Leads</th>
              <th className="px-3 py-2">Opps</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted">
                  No accounts yet.
                </td>
              </tr>
            ) : (
              accounts.map((a) => (
                <tr key={a.id} className="hover:bg-background/80">
                  <td className="px-3 py-2">
                    <Link href={`/accounts/${a.id}`} className="font-medium hover:text-accent">
                      {a.company}
                    </Link>
                    {a.website ? <div className="text-xs text-muted">{a.website}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-muted">{a.industry ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">
                    {[a.locationArea, a.city].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-muted">{a.owner?.name ?? "—"}</td>
                  <td className="px-3 py-2 mono">{a._count.contacts}</td>
                  <td className="px-3 py-2 mono">{a._count.leads}</td>
                  <td className="px-3 py-2 mono">{a._count.opportunities}</td>
                  <td className="px-3 py-2 mono text-[11px] text-muted">
                    {formatDatePK(a.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-muted">
        <Badge tone="accent">Demo Mode</Badge>
        <span className="ml-2">{accounts.length} accounts</span>
      </div>
    </div>
  );
}
