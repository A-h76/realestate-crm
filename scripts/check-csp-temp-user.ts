/**
 * Runs scripts/check-csp.ts against a running production build, signed in as a throwaway OWNER that this script
 * creates in a throwaway workspace and deletes afterwards. The password is generated in memory and never printed.
 *
 *   npm run build && npx next start -p 3002 &      # with AUTH_URL / NEXTAUTH_URL pointing at that port
 *   BASE_URL=http://localhost:3002 npm run check:csp
 *
 * Writes to whatever DATABASE_URL points at, so it refuses a non-local database unless ALLOW_REMOTE_DB=yes
 * (use that only for a disposable staging database, never production).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
if (!["localhost", "127.0.0.1", "::1"].includes(host) && process.env.ALLOW_REMOTE_DB !== "yes") {
  console.error("Refusing to create a test user in a non-local database. Set ALLOW_REMOTE_DB=yes only for disposable staging.");
  process.exit(1);
}

const prisma = new PrismaClient();
async function main() {
  const password = randomBytes(12).toString("hex");
  const email = `csp-${randomUUID()}@example.test`;
  const ws = await prisma.workspace.create({ data: { name: "csp-check", slug: `csp-check-${randomUUID()}` } });
  const user = await prisma.user.create({ data: { email, name: "CSP Check", passwordHash: await bcrypt.hash(password, 10) } });
  await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id, role: "OWNER" } });
  try {
    const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/check-csp.ts"], {
      stdio: "inherit",
      env: { ...process.env, BASE_URL: process.env.BASE_URL ?? "http://localhost:3000", E2E_EMAIL: email, E2E_PASSWORD: password },
    });
    process.exitCode = r.status ?? 1;
  } finally {
    await prisma.workspace.delete({ where: { id: ws.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
