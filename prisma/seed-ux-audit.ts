import { prisma } from "../src/lib/db";
import { seedUxAuditWorkspace, UX_AUDIT_SLUG, UX_AUDIT_USERS } from "./seed-ux-audit-data";

/**
 * Creates or resets ONLY the "Synas UX Audit Demo" workspace. Unlike
 * prisma/seed.ts it never wipes the database: other workspaces are untouched.
 * Requires DEMO_MODE=true and DEMO_SEED_PASSWORD; refuses a live WhatsApp provider.
 */
async function main() {
  // Keep the engine deterministic: no optional LLM assist while replaying scripted conversations.
  delete process.env.OPENAI_API_KEY;

  console.log(`Resetting ${UX_AUDIT_SLUG} (other workspaces are not touched)…`);
  const result = await seedUxAuditWorkspace();

  console.log("\nUX audit demo ready.");
  console.log("Counts:", JSON.stringify(result.counts, null, 2));
  console.log("\nLogins (password = UX_AUDIT_PASSWORD, or DEMO_SEED_PASSWORD if unset; it is not printed):");
  for (const u of UX_AUDIT_USERS) console.log(`  ${u.email.padEnd(32)} ${u.role}`);
  console.log("\nScenario leads:");
  for (const s of result.scenarios) console.log(`  /leads/${s.leadId}  ${s.name}: ${s.scenario}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
