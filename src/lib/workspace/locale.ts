import { prisma } from "@/lib/db";
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE } from "@/lib/format";
import { DEFAULT_REGION } from "@/lib/phone";

/**
 * The workspace's locale settings, read once per render and passed down (US-11, US-12, US-14).
 *
 * Every number, date and phone the UI shows should be formatted with these, not with a
 * module-level constant: the dashboard's roll-ups and the pages you drill into from them must
 * agree about what "today" means. The defaults are only a fallback for a missing row.
 */
export type WorkspaceLocale = {
  timeZone: string;
  currency: string;
  region: string;
};

export const FALLBACK_LOCALE: WorkspaceLocale = {
  timeZone: DEFAULT_TIMEZONE,
  currency: DEFAULT_CURRENCY,
  region: DEFAULT_REGION,
};

export async function getWorkspaceLocale(workspaceId: string): Promise<WorkspaceLocale> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { timezone: true, currency: true, region: true },
  });
  if (!workspace) return FALLBACK_LOCALE;
  return {
    timeZone: workspace.timezone || FALLBACK_LOCALE.timeZone,
    currency: workspace.currency || FALLBACK_LOCALE.currency,
    region: workspace.region || FALLBACK_LOCALE.region,
  };
}
