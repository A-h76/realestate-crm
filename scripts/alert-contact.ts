/**
 * Operator tool: who gets email alerts for a client's workspace (no login, no team seat).
 * The client says how many people at agreement time; run this once per person.
 *
 *   npm run alerts -- add <workspace-slug> <email> [label]
 *   npm run alerts -- list <workspace-slug>
 *   npm run alerts -- remove <workspace-slug> <email>
 */
import { prisma } from "../src/lib/db";
import { emailAlertsConfigured } from "../src/lib/alerts";

const MAX_CONTACTS = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const [command, slug, rawEmail, ...label] = process.argv.slice(2);
  if (!["add", "list", "remove"].includes(command ?? "") || !slug) {
    console.error("Usage: npm run alerts -- add|list|remove <workspace-slug> [email] [label]");
    process.exit(2);
  }
  const workspace = await prisma.workspace.findFirst({ where: { slug, deletedAt: null }, select: { id: true } });
  if (!workspace) throw new Error(`No workspace with slug "${slug}"`);

  if (command === "list") {
    const contacts = await prisma.alertContact.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } });
    for (const c of contacts) console.log(`${c.active ? "on " : "off"}  ${c.channel}  ${c.address}  ${c.label ?? ""}`);
    console.log(`${contacts.length} contact(s). Email sending is ${emailAlertsConfigured() ? "configured" : "NOT configured (RESEND_API_KEY / ALERT_FROM_EMAIL)"} in this environment.`);
    return;
  }

  const email = rawEmail?.trim().toLowerCase();
  if (!email || !EMAIL.test(email)) throw new Error("A valid email address is required");
  const where = { workspaceId_channel_address: { workspaceId: workspace.id, channel: "EMAIL" as const, address: email } };

  if (command === "remove") {
    await prisma.alertContact.delete({ where }).catch(() => {
      throw new Error("That address is not an alert contact for this workspace");
    });
    console.log("Removed.");
    return;
  }

  const existing = await prisma.alertContact.count({ where: { workspaceId: workspace.id, active: true } });
  if (existing >= MAX_CONTACTS) throw new Error(`Limit of ${MAX_CONTACTS} alert contacts reached`);
  await prisma.alertContact.upsert({
    where,
    create: { workspaceId: workspace.id, channel: "EMAIL", address: email, label: label.join(" ") || null },
    update: { active: true, label: label.join(" ") || undefined },
  });
  console.log("Added. They will get new-enquiry and waiting-too-long emails.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
