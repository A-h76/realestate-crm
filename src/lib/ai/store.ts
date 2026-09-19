import type { IntelligenceKind, IntelligenceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AI_MODEL, AI_PROMPT_VERSION } from "./schemas";

export async function storeIntelligenceRun(input: {
  workspaceId: string;
  actorId?: string | null;
  kind: IntelligenceKind;
  entityType: string;
  entityId: string;
  leadId?: string | null;
  opportunityId?: string | null;
  inputSnapshot?: Prisma.InputJsonValue;
  output: Prisma.InputJsonValue;
  confidence?: number | null;
  status?: IntelligenceStatus;
  model?: string;
  promptVersion?: string;
}) {
  const run = await prisma.intelligenceRun.create({
    data: {
      workspaceId: input.workspaceId,
      kind: input.kind,
      model: input.model ?? AI_MODEL,
      promptVersion: input.promptVersion ?? AI_PROMPT_VERSION,
      entityType: input.entityType,
      entityId: input.entityId,
      leadId: input.leadId ?? null,
      opportunityId: input.opportunityId ?? null,
      inputSnapshot: input.inputSnapshot,
      output: input.output,
      confidence: input.confidence ?? null,
      status: input.status ?? "COMPLETED",
    },
  });

  await writeAudit({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    action: "AI_ANALYSIS_COMPLETED",
    entity: "IntelligenceRun",
    entityId: run.id,
    metadata: {
      kind: input.kind,
      entityType: input.entityType,
      entityId: input.entityId,
      confidence: input.confidence ?? null,
      model: run.model,
      promptVersion: run.promptVersion,
    },
  });

  return run;
}
