import { PrismaClient } from "@prisma/client";
import { isDemoMode } from "../src/lib/demo-mode";
import { clearEntireDatabase, seedDemoWorkspace } from "./seed-data";

const prisma = new PrismaClient();

async function main() {
  if (!isDemoMode()) {
    throw new Error("Refusing to seed: set DEMO_MODE=true for isolated demo environments only.");
  }

  console.log("Clearing database (demo environment only)…");
  await clearEntireDatabase(prisma);

  console.log("Seeding Synas Realty demo workspace…");
  const result = await seedDemoWorkspace(prisma);

  console.log("\nSeed complete.");
  console.log("Workspace:", result.workspaceId, "(synas-realty-demo)");
  console.log("Counts:", JSON.stringify(result.counts, null, 2));
  console.log("Demo users created. Password is the DEMO_SEED_PASSWORD you supplied — it is not printed.");
  console.log("  ahmed@synaslabs.demo  — OWNER");
  console.log("  sara@synaslabs.demo   — ADMIN");
  console.log("  bilal@synaslabs.demo  — AGENT");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
