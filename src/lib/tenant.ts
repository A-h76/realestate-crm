import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/db";

export type RelationRefs = {
  accountId?: string | null;
  contactId?: string | null;
  ownerId?: string | null;
  assignedAgentId?: string | null;
  ownerContactId?: string | null;
  leadId?: string | null;
  propertyId?: string | null;
  linkedPropertyId?: string | null;
  opportunityId?: string | null;
  taskId?: string | null;
  proposalId?: string | null;
  pipelineStageId?: string | null;
  stageId?: string | null;
  primaryContactId?: string | null;
  siteVisitId?: string | null;
};

type ResourceModel =
  | "lead"
  | "account"
  | "contact"
  | "property"
  | "opportunity"
  | "task"
  | "proposal"
  | "pipelineStage"
  | "calendarEvent"
  | "note"
  | "automation"
  | "intelligenceRun"
  | "whatsAppMessage";

async function existsInWorkspace(model: ResourceModel, id: string, workspaceId: string): Promise<boolean> {
  switch (model) {
    case "lead":
      return Boolean(await prisma.lead.findFirst({ where: { id, workspaceId, deletedAt: null }, select: { id: true } }));
    case "account":
      return Boolean(await prisma.account.findFirst({ where: { id, workspaceId, deletedAt: null }, select: { id: true } }));
    case "contact":
      return Boolean(await prisma.contact.findFirst({ where: { id, workspaceId, deletedAt: null }, select: { id: true } }));
    case "property":
      return Boolean(await prisma.property.findFirst({ where: { id, workspaceId, deletedAt: null }, select: { id: true } }));
    case "opportunity":
      return Boolean(await prisma.opportunity.findFirst({ where: { id, workspaceId, deletedAt: null }, select: { id: true } }));
    case "task":
      return Boolean(await prisma.task.findFirst({ where: { id, workspaceId, deletedAt: null }, select: { id: true } }));
    case "proposal":
      return Boolean(await prisma.proposal.findFirst({ where: { id, workspaceId, deletedAt: null }, select: { id: true } }));
    case "pipelineStage":
      return Boolean(await prisma.pipelineStage.findFirst({ where: { id, workspaceId }, select: { id: true } }));
    case "calendarEvent":
      return Boolean(await prisma.calendarEvent.findFirst({ where: { id, workspaceId, deletedAt: null }, select: { id: true } }));
    case "note":
      return Boolean(await prisma.note.findFirst({ where: { id, workspaceId }, select: { id: true } }));
    case "automation":
      return Boolean(await prisma.automation.findFirst({ where: { id, workspaceId }, select: { id: true } }));
    case "intelligenceRun":
      return Boolean(await prisma.intelligenceRun.findFirst({ where: { id, workspaceId }, select: { id: true } }));
    case "whatsAppMessage":
      return Boolean(await prisma.whatsAppMessage.findFirst({ where: { id, workspaceId }, select: { id: true } }));
    default: {
      const _exhaustive: never = model;
      void _exhaustive;
      return false;
    }
  }
}

export async function assertResourceInWorkspace(
  model: ResourceModel,
  id: string,
  workspaceId: string,
): Promise<void> {
  const found = await existsInWorkspace(model, id, workspaceId);
  if (!found) {
    throw new ApiError(404, "Resource not found");
  }
}

export async function assertMemberInWorkspace(workspaceId: string, userId: string): Promise<void> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { id: true },
  });
  if (!membership) {
    throw new ApiError(400, "User is not a member of this workspace");
  }
}

/**
 * Rejects client-supplied foreign keys that do not belong to the authenticated workspace.
 * Missing / null IDs are ignored. Unknown IDs return 400 so existence in another
 * tenant is not confirmed.
 */
export async function assertRelationsInWorkspace(workspaceId: string, refs: RelationRefs): Promise<void> {
  const checks: Array<Promise<void>> = [];

  const related = async (model: ResourceModel, id: string | null | undefined, label: string) => {
    if (!id) return;
    const found = await existsInWorkspace(model, id, workspaceId);
    if (!found) {
      throw new ApiError(400, `Invalid ${label}`);
    }
  };

  checks.push(related("account", refs.accountId, "accountId"));
  checks.push(related("contact", refs.contactId, "contactId"));
  checks.push(related("contact", refs.ownerContactId, "ownerContactId"));
  checks.push(related("contact", refs.primaryContactId, "primaryContactId"));
  checks.push(related("lead", refs.leadId, "leadId"));
  checks.push(related("property", refs.propertyId, "propertyId"));
  checks.push(related("property", refs.linkedPropertyId, "linkedPropertyId"));
  checks.push(related("opportunity", refs.opportunityId, "opportunityId"));
  checks.push(related("task", refs.taskId, "taskId"));
  checks.push(related("proposal", refs.proposalId, "proposalId"));
  checks.push(related("pipelineStage", refs.pipelineStageId ?? refs.stageId, "stageId"));
  checks.push(related("calendarEvent", refs.siteVisitId, "siteVisitId"));

  if (refs.ownerId) {
    checks.push(assertMemberInWorkspace(workspaceId, refs.ownerId));
  }
  if (refs.assignedAgentId) {
    checks.push(assertMemberInWorkspace(workspaceId, refs.assignedAgentId));
  }

  await Promise.all(checks);
}

export async function touchLeadActivity(
  workspaceId: string,
  leadId: string,
  at: Date = new Date(),
): Promise<void> {
  const result = await prisma.lead.updateMany({
    where: { id: leadId, workspaceId, deletedAt: null },
    data: { lastActivityAt: at },
  });
  if (result.count === 0) {
    throw new ApiError(400, "Invalid leadId");
  }
}
