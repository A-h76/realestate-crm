/**
 * Operator tool: connect a Starter client's own CRM. New enquiries (and repeat enquiries) are copied into it.
 *
 *   npm run crm -- connect-hubspot <workspace-slug>
 *   npm run crm -- connect-sheets <workspace-slug> <sheet url or id> [tab name]
 *   npm run crm -- list <workspace-slug>
 *   npm run crm -- disable <workspace-slug> <hubspot|sheets>
 *
 * Credentials are per-deployment env, never stored in the database (docs/ops/CRM-CONNECTORS.md). Connecting first proves
 * the credentials work, and for a sheet writes the header row if it is empty, so a wrong token or an unshared sheet
 * fails here, not on the client's first enquiry.
 */
import { prisma } from "../src/lib/db";
import { checkHubspot } from "../src/lib/crm/hubspot";
import { checkSheet } from "../src/lib/crm/google-sheets";
import { CrmError } from "../src/lib/crm/types";

const KINDS = { hubspot: "HUBSPOT", sheets: "GOOGLE_SHEETS" } as const;

async function main() {
  const [command, slug, a, ...rest] = process.argv.slice(2);
  if (!["connect-hubspot", "connect-sheets", "list", "disable"].includes(command ?? "") || !slug) {
    console.error("Usage: npm run crm -- connect-hubspot|connect-sheets|list|disable <workspace-slug> ...");
    process.exit(2);
  }
  const workspace = await prisma.workspace.findFirst({ where: { slug, deletedAt: null }, select: { id: true } });
  if (!workspace) throw new Error(`No workspace with slug "${slug}"`);

  if (command === "list") {
    const rows = await prisma.crmConnection.findMany({ where: { workspaceId: workspace.id } });
    for (const c of rows) {
      const counts = await prisma.crmSyncDelivery.groupBy({ by: ["status"], where: { connectionId: c.id }, _count: true });
      console.log(`${c.enabled ? "on " : "off"}  ${c.kind}  ${c.target ?? ""}  ${counts.map((x) => `${x.status}=${x._count}`).join(" ") || "no enquiries copied yet"}`);
    }
    return;
  }
  if (command === "disable") {
    const kind = KINDS[a as keyof typeof KINDS];
    if (!kind) throw new Error("Say which: hubspot or sheets");
    const done = await prisma.crmConnection.updateMany({ where: { workspaceId: workspace.id, kind }, data: { enabled: false } });
    console.log(done.count ? "Disabled." : "No such connection.");
    return;
  }

  let kind: "HUBSPOT" | "GOOGLE_SHEETS";
  let target: string | null = null;
  try {
    if (command === "connect-hubspot") {
      kind = "HUBSPOT";
      console.log(await checkHubspot());
    } else {
      kind = "GOOGLE_SHEETS";
      const id = /\/d\/([\w-]+)/.exec(a ?? "")?.[1] ?? a;
      target = rest.length ? `${id}|${rest.join(" ")}` : (id ?? null);
      console.log(await checkSheet(target));
    }
  } catch (e) {
    throw new Error(`Not connected: ${e instanceof CrmError ? e.message : "unexpected error"}. Check the credentials in this deployment's environment and that the sheet is shared with the service account as Editor.`);
  }
  await prisma.crmConnection.upsert({
    where: { workspaceId_kind: { workspaceId: workspace.id, kind } },
    create: { workspaceId: workspace.id, kind, target },
    update: { target, enabled: true },
  });
  console.log("Connected. New enquiries will be copied from now on.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
