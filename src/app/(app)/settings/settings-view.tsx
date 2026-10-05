import { requireAppAccess } from "@/lib/app-access";
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE } from "@/lib/format";
import { roleHasPermission } from "@/lib/authz";
import { invitationStatesFor } from "@/lib/workspace/invitation-status";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { SettingsClient, type Tab } from "./settings-client";
import { getCalendarProvider } from "@/lib/providers/calendar";
import { describeWhatsAppStatus, getWhatsAppProvider, whatsappStatus } from "@/lib/providers/whatsapp";

export async function SettingsView({
  eyebrow,
  title,
  description,
  tabs,
}: {
  eyebrow: string;
  title: string;
  description: string;
  tabs: Tab[];
}) {
  const access = await requireAppAccess();

  const workspace = await prisma.workspace.findUnique({
    where: { id: access.workspaceId },
    include: {
      branding: true,
      members: { include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } },
      pipelineStages: { orderBy: { order: "asc" } },
    },
  });
  const canManageMembers = roleHasPermission(access.role, "members:manage");
  // Pending/expired invitation state is only shown to people who can manage members.
  const invitations = canManageMembers
    ? await invitationStatesFor((workspace?.members ?? []).map((m) => m.userId))
    : new Map();
  const calendar = getCalendarProvider();
  const whatsapp = getWhatsAppProvider();
  const waStatus = whatsappStatus();

  return (
    <div className="page-in space-y-8 p-6 md:p-10">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
      />
      <SettingsClient
        tabs={tabs}
        initialTab={tabs[0]}
        branding={
          workspace?.branding
            ? {
                companyName: workspace.branding.companyName,
                displayName: workspace.branding.displayName,
                logoUrl: workspace.branding.logoUrl,
                accentColor: workspace.branding.accentColor,
              }
            : null
        }
        workspaceName={workspace?.name ?? "Workspace"}
        timezone={workspace?.timezone ?? DEFAULT_TIMEZONE}
        currency={workspace?.currency ?? DEFAULT_CURRENCY}
        isDemo={workspace?.isDemo ?? false}
        viewer={{
          userId: access.userId,
          role: access.role,
          canEditWorkspace: roleHasPermission(access.role, "workspace:write"),
          canResetDemo: roleHasPermission(access.role, "demo:reset"),
          canManageMembers: roleHasPermission(access.role, "members:manage"),
        }}
        members={(workspace?.members ?? []).map((m) => ({
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          invitation: invitations.get(m.userId) ?? null,
        }))}
        stages={(workspace?.pipelineStages ?? []).map((s) => ({
          name: s.name,
          probability: s.probability,
        }))}
        integrations={{
          calendar: calendar.name,
          calendarDemo: calendar.isDemo,
          whatsapp: whatsapp.name,
          whatsappDemo: whatsapp.isDemo,
          whatsappMode: waStatus.mode,
          whatsappDetail: describeWhatsAppStatus(waStatus),
        }}
      />
    </div>
  );
}
