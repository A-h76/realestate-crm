/** Read-only smoke check: runs the Needs Attention loaders against every workspace and prints counts. */
import { prisma } from "../src/lib/db";
import { loadHome } from "../src/lib/attention/loader";
import { loadTeamHealth } from "../src/lib/attention/team-health";

async function main() {
  const workspaces = await prisma.workspace.findMany({ where: { deletedAt: null }, select: { id: true, name: true, timezone: true } });
  for (const w of workspaces) {
    const m = await prisma.workspaceMember.findFirst({ where: { workspaceId: w.id }, select: { userId: true } });
    const home = await loadHome(w.id, m?.userId ?? "none", w.timezone, "team");
    const h = await loadTeamHealth(w.id, w.timezone);
    console.log(w.name, JSON.stringify({ attention: home.attentionCount, respond: home.respondNow.length, followUps: home.followUps.length, today: home.appointments.length, cold: home.goingCold.length, health: h.followUpHealth, data: h.dataHealth, flow: h.leadFlow.steps.map((s) => s.count) }));
  }
}
main().finally(() => prisma.$disconnect());
