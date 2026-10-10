/**
 * Operator tool: connect a client's enquiry sources (no login involved).
 *
 *   npm run intake -- add-form <workspace-slug> <form name> <https://their-site.example> [more origins...]
 *   npm run intake -- add-meta <workspace-slug> <facebook page id> <name>
 *   npm run intake -- add-email <workspace-slug> <receiving address> <name>
 *   npm run intake -- list <workspace-slug>
 *   npm run intake -- disable <workspace-slug> <source id>
 *
 * add-form prints the embed code for the client's website. add-meta registers the Page so the Meta lead-ads webhook
 * (/api/webhooks/meta) knows which workspace its leads belong to; the Meta app itself is set up in Meta's dashboard
 * (docs/ops/INTAKE.md).
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { workspaceProfile } from "../src/lib/workspace/profile";

function origin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error(`Origin must be https: ${value}`);
  return url.origin;
}

function snippet(endpoint: string) {
  return `<form id="enquiry-form">
  <input name="name" placeholder="Your name" required>
  <input name="email" type="email" placeholder="Email">
  <input name="phone" type="tel" placeholder="Phone">
  <textarea name="message" placeholder="How can we help?"></textarea>
  <input name="hp_url" style="display:none" tabindex="-1" autocomplete="off" aria-hidden="true">
  <button type="submit">Send</button>
</form>
<script>
document.getElementById("enquiry-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const res = await fetch("${endpoint}", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(form))),
  });
  form.outerHTML = res.ok ? "<p>Thanks! We will be in touch shortly.</p>" : "<p>Sorry, that did not send. Please call us.</p>";
});
</script>`;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const [command, slug, a, b, ...more] = args.filter((x) => x !== "--force");
  if (!["add-form", "add-meta", "add-email", "list", "disable"].includes(command ?? "") || !slug) {
    console.error("Usage: npm run intake -- add-form|add-meta|add-email|list|disable <workspace-slug> ...");
    process.exit(2);
  }
  const workspace = await prisma.workspace.findFirst({ where: { slug, deletedAt: null }, select: { id: true, industry: true, package: true } });
  if (!workspace) throw new Error(`No workspace with slug "${slug}"`);
  const base = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "https://YOUR-APP-URL").replace(/\/$/, "");

  if (command === "list") {
    for (const s of await prisma.intakeSource.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } })) {
      console.log(`${s.enabled ? "on " : "off"}  ${s.kind}  ${s.id}  ${s.name}  ${s.kind === "WEB_FORM" ? `${base}/api/intake/forms/${s.publicKey}  origins: ${s.allowedOrigins.join(", ") || "(server-to-server only)"}` : s.kind === "META_LEADS" ? `page ${s.externalId}` : `mailbox ${s.externalId}`}`);
    }
    return;
  }
  if (command === "disable") {
    const done = await prisma.intakeSource.updateMany({ where: { id: a, workspaceId: workspace.id }, data: { enabled: false } });
    console.log(done.count ? "Disabled." : "No such source in this workspace.");
    return;
  }
  /** The package sells a number of enquiry channels (Starter 1, Growth 4). --force is for something agreed in writing. */
  async function assertChannelAvailable() {
    const { plan } = workspaceProfile(workspace!);
    if (plan.channels === null || force) return;
    const used = (await prisma.intakeSource.count({ where: { workspaceId: workspace!.id, enabled: true } })) + (await prisma.whatsAppIntegration.count({ where: { workspaceId: workspace!.id, enabled: true } }));
    if (used >= plan.channels) throw new Error(`The ${plan.name} package includes ${plan.channels} enquiry channel(s) and this workspace already uses ${used}. Re-run with --force if more was agreed.`);
  }

  if (command === "add-form") {
    await assertChannelAvailable();
    if (!a) throw new Error("A form name is required");
    const allowedOrigins = [b, ...more].filter((o): o is string => Boolean(o)).map(origin);
    const created = await prisma.intakeSource.create({
      data: { workspaceId: workspace.id, kind: "WEB_FORM", name: a, publicKey: randomBytes(12).toString("base64url"), allowedOrigins },
    });
    const endpoint = `${base}/api/intake/forms/${created.publicKey}`;
    console.log(`Form "${a}" created.\nEndpoint: ${endpoint}\nAllowed origins: ${allowedOrigins.join(", ") || "(none: only server-to-server posts work)"}\n\nPaste on the client's site:\n\n${snippet(endpoint)}`);
    return;
  }
  if (command === "add-email") {
    await assertChannelAvailable();
    const address = a?.trim().toLowerCase();
    if (!address || !b || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error("Usage: add-email <workspace-slug> <receiving address> <name>");
    await prisma.intakeSource.create({
      data: { workspaceId: workspace.id, kind: "EMAIL", name: b, externalId: address, publicKey: randomBytes(12).toString("base64url"), allowedOrigins: [] },
    });
    console.log(`Mailbox ${address} registered as "${b}". In Resend: receive mail for that address, and add a webhook for email.received to ${base}/api/webhooks/resend (docs/ops/INTAKE.md).`);
    return;
  }
  // add-meta
  await assertChannelAvailable();
  if (!a || !b) throw new Error("Usage: add-meta <workspace-slug> <facebook page id> <name>");
  if (!/^\d{5,30}$/.test(a)) throw new Error("A Facebook Page id is digits only");
  await prisma.intakeSource.create({
    data: { workspaceId: workspace.id, kind: "META_LEADS", name: b, externalId: a, publicKey: randomBytes(12).toString("base64url"), allowedOrigins: [] },
  });
  console.log(`Page ${a} registered as "${b}". Webhook URL for the Meta app: ${base}/api/webhooks/meta (subscribe the Page to "leadgen").`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
