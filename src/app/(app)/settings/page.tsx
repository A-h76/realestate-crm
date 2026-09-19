import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { SettingsClient } from "./settings-client";
import { getCalendarProvider } from "@/lib/providers/calendar";
import { getWhatsAppProvider } from "@/lib/providers/whatsapp";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const workspace = await prisma.workspace.findUnique({
    where: { id: session.user.workspaceId },
    include: {
      branding: true,
      members: { include: { user: { select: { name: true, email: true } } } },
      pipelineStages: { orderBy: { order: "asc" } },
    },
  });
  const calendar = getCalendarProvider();
  const whatsapp = getWhatsAppProvider();

  return (
    <div className="page-in space-y-8 p-6 md:p-10">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Workspace, pipeline, team, integrations, and client branding."
      />
      <SettingsClient
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
        timezone={workspace?.timezone ?? "Asia/Karachi"}
        currency={workspace?.currency ?? "PKR"}
        isDemo={workspace?.isDemo ?? false}
        members={(workspace?.members ?? []).map((m) => ({
          name: m.user.name,
          email: m.user.email,
          role: m.role,
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
        }}
      />
    </div>
  );
}
