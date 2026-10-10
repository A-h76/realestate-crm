import { redirect } from "next/navigation";
import { requireAppAccess } from "@/lib/app-access";
import { AppShell } from "@/components/layout/app-shell";
import { PermissionsProvider } from "@/components/providers/permissions";
import { permissionsForRole } from "@/lib/authz";
import { getCalendarProvider } from "@/lib/providers/calendar";
import { whatsappStatus } from "@/lib/providers/whatsapp";
import { shellProfile } from "@/lib/workspace/profile";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAppAccess();
  if (!access.session.user) {
    redirect("/login");
  }

  const calendar = getCalendarProvider();

  return (
    <PermissionsProvider permissions={[...permissionsForRole(access.role)]}>
    <AppShell
      userName={access.session.user.name ?? access.session.user.email}
      userRole={access.role}
      workspaceName={access.workspace.branding?.displayName ?? access.workspace.name ?? "Workspace"}
      companyName={access.workspace.branding?.companyName}
      timeZone={access.workspace.timezone}
      profile={shellProfile(access.workspace)}
      calendarDemo={calendar.isDemo}
      whatsappDemo={whatsappStatus().mode !== "live"} /* lamp is lit only when live and configured */
      demoMode={access.demoMode}
    >
      {children}
    </AppShell>
    </PermissionsProvider>
  );
}
