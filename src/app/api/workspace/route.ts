import { z } from "zod";
import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { isDemoMode } from "@/lib/demo-mode";
import { getCalendarProvider } from "@/lib/providers/calendar";
import { getWhatsAppProvider, whatsappStatus } from "@/lib/providers/whatsapp";
import { currencyEnum, parseBody, timeZoneEnum } from "@/lib/validations/common";
import { measuredRoute } from "@/lib/perf";


const brandingSchema = z.object({
  companyName: z.string().trim().min(1).max(80).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  logoUrl: z.string().trim().url().optional().nullable().or(z.literal("")),
  accentColor: z.string().trim().regex(/^#([0-9a-fA-F]{6})$/).optional(),
  /**
   * Locale settings (US-12). Previously the settings page rendered these as if they were
   * configurable while no route could write them; now they are. The time zone is checked
   * against an allowlist of US IANA zones rather than accepting free text, because an
   * unrecognized zone would make every date and SLA clock in the app silently wrong.
   */
  timezone: timeZoneEnum.optional(),
  currency: currencyEnum.optional(),
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
        whatsappBusinessEnabled: process.env.WHATSAPP_BUSINESS_ENABLED === "true",
        whatsappMode: whatsappStatus().mode,
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

    // Locale is on the Workspace row, branding is on its own; only write what was sent.
    if (body.timezone !== undefined || body.currency !== undefined) {
      await prisma.workspace.updateMany({
        where: { id: workspaceId, deletedAt: null },
        data: { timezone: body.timezone, currency: body.currency },
      });
      await writeAudit({
        workspaceId,
        actorId: userId,
        action: "WORKSPACE_UPDATED",
        entity: "Workspace",
        entityId: workspaceId,
        metadata: {
          fields: Object.keys({
            ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
            ...(body.currency !== undefined ? { currency: body.currency } : {}),
          }),
          timezone: body.timezone,
          currency: body.currency,
        },
      });
    }

    const brandingTouched =
      body.companyName !== undefined ||
      body.displayName !== undefined ||
      body.logoUrl !== undefined ||
      body.accentColor !== undefined;
    if (!brandingTouched) {
      const workspace = await prisma.workspace.findFirstOrThrow({
        where: { id: workspaceId },
        select: { timezone: true, currency: true },
      });
      return jsonOk({ workspace });
    }

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
