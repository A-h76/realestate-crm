import { requireAppAccess } from "@/lib/app-access";
import { roleHasPermission } from "@/lib/authz";
import { loadHome, type HomeScope } from "@/lib/attention/loader";
import { HomeView } from "@/components/home/home-view";
import { formatInTimeZone } from "date-fns-tz";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const access = await requireAppAccess();
  const { scope: scopeParam } = await searchParams;
  // Team scope is a manager view; the server decides, the query string only asks.
  const canSeeTeam = roleHasPermission(access.role, "leads:assign");
  const scope: HomeScope = scopeParam === "team" && canSeeTeam ? "team" : "mine";

  const data = await loadHome(access.workspaceId, access.userId, access.workspace.timezone, scope);
  const hour = Number(formatInTimeZone(data.now, access.workspace.timezone, "H"));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (access.session.user.name ?? "").trim().split(/\s+/)[0] || "there";

  return (
    <HomeView
      data={data}
      greeting={greeting}
      firstName={firstName}
      timeZone={access.workspace.timezone}
      canSeeTeam={canSeeTeam}
      canWrite={roleHasPermission(access.role, "crm:write")}
    />
  );
}
