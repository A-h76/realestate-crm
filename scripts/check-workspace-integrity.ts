/**
 * DATA-006: read-only report of rows that reference a record in a different workspace.
 * Safe to run against production (SELECT only). Exit code 1 if any are found.
 * Run: npm run integrity:check
 */
import { prisma } from "../src/lib/db";
import { findCrossWorkspaceReferences } from "../src/lib/integrity/workspace-integrity";

findCrossWorkspaceReferences()
  .then(({ checked, findings }) => {
    console.log(`[integrity] checked ${checked} workspace-scoped relations`);
    for (const f of findings) console.error(`[integrity] ${f.count} x ${f.child}.${f.column} -> ${f.parent} crosses workspaces`);
    if (findings.length === 0) console.log("[integrity] no cross-workspace references found");
    else process.exitCode = 1;
  })
  .catch((error) => {
    console.error("[integrity] failed", error instanceof Error ? error.message.split("\n")[0] : "unknown_error");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
