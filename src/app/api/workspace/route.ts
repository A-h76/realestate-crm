import { z } from "zod";
import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { isDemoMode } from "@/lib/demo-mode";
import { getCalendarProvider } from "@/lib/providers/calendar";
import { getWhatsAppProvider } from "@/lib/providers/whatsapp";
import { parseBody } from "@/lib/validations/common";
import { measuredRoute } from "@/lib/perf";


const brandingSchema = z.object({
  companyName: z.string().trim().min(1).max(80).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  logoUrl: z.string().trim().url().optional().nullable().or(z.literal("")),
  accentColor: z.string().trim().regex(/^#([0-9a-fA-F]{6})$/).optional(),
});

export const GET = measuredRoute("GET /api/workspace", async (_request: Request) => {
  try {
    const { workspaceId, role, userId, session } = await requirePermission("workspace:read");

    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      include: { branding: true },
    });

    if (!workspace) {
      throw new ApiError(404, "Workspace not found");
    }

    const calendar = getCalendarProvider();
    const whatsapp = getWhatsAppProvider();

    return jsonOk({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        timezone: workspace.timezone,
        currency: workspace.currency,
        isDemo: workspace.isDemo,
      },
      branding: workspace.branding,
      membership: {
        userId,
        role,
        email: session.user.email,
        name: session.user.name,
      },
      flags: {
        demoMode: isDemoMode() || workspace.isDemo,
        calendarProvider: calendar.name,
        calendarDemo: calendar.isDemo,
        whatsappProvider: whatsapp.name,
        whatsappDemo: whatsapp.isDemo,
        googleCalendarEnabled: process.env.GOOGLE_CALENDAR_ENABLED === "true",
        whatsappBusinessEnabled: process.env.WHATSAPP_BUSINESS_ENABLED === "true",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
});

export const PATCH = measuredRoute("PATCH /api/workspace", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("workspace:write");
    const body = parseBody(brandingSchema, await request.json());
    const branding = await prisma.workspaceBranding.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        companyName: body.companyName ?? "Workspace",
        displayName: body.displayName ?? body.companyName ?? "Workspace",
        logoUrl: body.logoUrl || null,
        accentColor: body.accentColor ?? "#0D9488",
      },
      update: {
        companyName: body.companyName,
        displayName: body.displayName,
        logoUrl: body.logoUrl === undefined ? undefined : body.logoUrl || null,
        accentColor: body.accentColor,
      },
    });
    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "BRANDING_UPDATED",
      entity: "WorkspaceBranding",
      entityId: branding.id,
      metadata: { fields: Object.keys(body) },
    });
    return jsonOk({ branding });
  } catch (error) {
    return jsonError(error);
  }
});
