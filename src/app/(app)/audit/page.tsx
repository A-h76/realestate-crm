import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { requireAppAccess } from "@/lib/app-access";
import { roleHasPermission } from "@/lib/authz";

export default async function AuditPage() {
  const access = await requireAppAccess();
  if (!roleHasPermission(access.role, "audit:read")) {
    return (
      <div className="space-y-8 p-8">
        <PageHeader
          eyebrow="Compliance"
          title="Activity log"
          description="You do not have permission to view the activity log."
        />
      </div>
    );
  }

  const logs = await prisma.auditLog.findMany({
    where: { workspaceId: access.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: { select: { name: true } } },
  });

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        eyebrow="Compliance"
        title="Activity log"
        description="Workspace actions recorded for ops review."
      />

      <div className="overflow-x-auto border border-border bg-surface">
        <table className="ops w-full min-w-[900px] text-left">
          <thead>
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Entity ID</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Metadata</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted">
                  No activity recorded yet.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-background/80 align-top">
                  <td className="px-3 py-2 mono text-[11px] text-muted whitespace-nowrap">
                    {formatDateTime(log.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone="neutral">{log.action.replaceAll("_", " ")}</Badge>
                  </td>
                  <td className="px-3 py-2 text-muted">{log.entity}</td>
                  <td className="px-3 py-2 mono text-[11px] text-muted">{log.entityId}</td>
                  <td className="px-3 py-2 text-muted">{log.actor?.name ?? "System"}</td>
                  <td className="px-3 py-2 mono text-[11px] text-muted max-w-xs truncate">
                    {log.metadata ? JSON.stringify(log.metadata) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
