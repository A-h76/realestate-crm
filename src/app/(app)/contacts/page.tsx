import Link from "next/link";
import { requireAppAccess } from "@/lib/app-access";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";

export default async function ContactsPage() {
  const { workspaceId } = await requireAppAccess();

  const contacts = await prisma.contact.findMany({
    where: { workspaceId: workspaceId, deletedAt: null },
    orderBy: { firstName: "asc" },
    include: { account: { select: { id: true, company: true } } },
  });

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        eyebrow="People"
        title="Contacts"
        description="Buyers, sellers, and decision-makers across accounts."
      />
      <div className="overflow-x-auto border border-border bg-surface">
        <table className="ops w-full min-w-[720px] text-left">
          <thead>
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">WhatsApp</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {contacts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted">
                  No contacts yet.
                </td>
              </tr>
            ) : (
              contacts.map((c) => (
                <tr key={c.id} className="hover:bg-background/80">
                  <td className="px-3 py-2">
                    <Link href={`/contacts/${c.id}`} className="font-medium hover:text-accent">
                      {c.firstName} {c.lastName ?? ""}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted">{c.title ?? "—"}</td>
                  <td className="px-3 py-2">
                    {c.account ? (
                      <Link href={`/accounts/${c.account.id}`} className="hover:text-accent">
                        {c.account.company}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">{c.email ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">{c.phone ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">{c.whatsappNumber ?? "—"}</td>
                  <td className="px-3 py-2 mono text-[11px] text-muted">
                    {formatDate(c.createdAt)}
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
