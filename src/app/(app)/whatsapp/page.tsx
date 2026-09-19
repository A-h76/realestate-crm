import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { formatDateTimePK } from "@/lib/format";

export default async function WhatsAppInboxPage() {
  const session = await auth();
  if (!session?.user) return null;

  const messages = await prisma.whatsAppMessage.findMany({
    where: { workspaceId: session.user.workspaceId },
    orderBy: { sentAt: "desc" },
    take: 80,
    include: { lead: { select: { id: true, firstName: true, lastName: true } } },
  });

  const threads = new Map<
    string,
    {
      id: string;
      leadId: string | null;
      name: string;
      preview: string;
      at: Date;
    }
  >();
  for (const message of messages) {
    if (threads.has(message.conversationId)) continue;
    threads.set(message.conversationId, {
      id: message.conversationId,
      leadId: message.leadId,
      name: message.lead ? `${message.lead.firstName} ${message.lead.lastName ?? ""}`.trim() : message.conversationId,
      preview: message.body,
      at: message.sentAt,
    });
  }

  return (
    <div className="page-in space-y-6 p-6 md:p-8">
      <PageHeader
        eyebrow="WhatsApp"
        title="Inbox"
        description="Demo threads stay inside the CRM. Outbound messages are never sent automatically."
      />
      <section className="card divide-y divide-border">
        {threads.size === 0 ? (
          <p className="p-6 text-sm text-muted">No WhatsApp conversations logged yet.</p>
        ) : (
          [...threads.values()].map((thread) => (
            <Link
              key={thread.id}
              href={thread.leadId ? `/leads/${thread.leadId}` : "/leads"}
              className="block px-5 py-4 hover:bg-background"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">{thread.name}</div>
                <div className="text-[12px] text-muted">{formatDateTimePK(thread.at)}</div>
              </div>
              <p className="mt-1 line-clamp-2 text-[13px] text-muted">{thread.preview}</p>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
