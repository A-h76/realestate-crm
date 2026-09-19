import { redirect } from "next/navigation";
import { requireAppAccess } from "@/lib/app-access";
import { AppShell } from "@/components/layout/app-shell";
import { getCalendarProvider } from "@/lib/providers/calendar";
import { getWhatsAppProvider } from "@/lib/providers/whatsapp";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAppAccess();
  if (!access.session.user) {
    redirect("/login");
  }

  const calendar = getCalendarProvider();
  const whatsapp = getWhatsAppProvider();

  return (
    <AppShell
      userName={access.session.user.name ?? access.session.user.email}
      userRole={access.role}
      workspaceName={access.workspace.branding?.displayName ?? access.workspace.name ?? "Workspace"}
      companyName={access.workspace.branding?.companyName}
      city="Lahore"
      calendarDemo={calendar.isDemo}
      whatsappDemo={whatsapp.isDemo}
      demoMode={access.demoMode}
    >
      {children}
    </AppShell>
  );
}
