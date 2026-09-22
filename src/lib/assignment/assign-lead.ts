import type { LeadStage } from "@prisma/client";
import { prisma } from "@/lib/db";

const OPEN_LEAD_STAGES: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "NURTURING"];

export type AssignmentResult = {
  agentId: string;
  agentName: string;
  openLeadCount: number;
};

/**
 * Least-loaded eligible agent: the workspace AGENT with the fewest open leads.
 * Isolated behind this function so the strategy can later be swapped for
 * round-robin, territory, or manual assignment without touching callers.
 */
export async function assignLeastLoadedAgent(workspaceId: string): Promise<AssignmentResult | null> {
  const agents = await prisma.workspaceMember.findMany({
    where: { workspaceId, role: "AGENT" },
    select: { userId: true, createdAt: true, user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (agents.length === 0) return null;

  const loads = await prisma.lead.groupBy({
    by: ["ownerId"],
    where: {
      workspaceId,
      deletedAt: null,
      stage: { in: OPEN_LEAD_STAGES },
      ownerId: { in: agents.map((a) => a.userId) },
    },
    _count: { _all: true },
  });
  const loadByAgent = new Map(loads.map((l) => [l.ownerId as string, l._count._all]));

  let best = agents[0];
  let bestLoad = loadByAgent.get(best.userId) ?? 0;
  for (const agent of agents.slice(1)) {
    const load = loadByAgent.get(agent.userId) ?? 0;
    if (load < bestLoad) {
      best = agent;
      bestLoad = load;
    }
  }

  return { agentId: best.userId, agentName: best.user.name, openLeadCount: bestLoad };
}
