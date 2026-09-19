/**
 * Runtime performance measurements against the local database.
 * Prints [PERF] lines only (no secrets, tokens, or CRM payloads).
 *
 * CSV imports of 1,000 / 5,000 / 10,000 rows are not executed: the importer
 * rejects more than 500 rows by design.
 */
import { performance } from "node:perf_hooks";
import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { parseLeadCsv, toCsv, CSV_LIMITS } from "../src/lib/csv/leads";
import { verifyHubSignature256 } from "../src/lib/security/hmac";
import { workspaceInsights, pipelineAging, resolveReportRange } from "../src/lib/insights";
import { scoreLead } from "../src/lib/scoring/score-lead";
import { analyzeLead } from "../src/lib/ai/lead-analysis";
import { runAutomations } from "../src/lib/automation/engine";
import { FETCH_TIMEOUTS_MS, fetchWithTimeout } from "../src/lib/http";
import { classifyDuration } from "../src/lib/perf";

type Row = {
  operation: string;
  durationMs: number;
  extra?: Record<string, number | string | boolean>;
};

const results: Row[] = [];

function record(operation: string, durationMs: number, extra?: Row["extra"]) {
  results.push({ operation, durationMs, extra });
  const bits = [
    "[PERF]",
    `operation=${operation}`,
    `duration=${Math.round(durationMs)}ms`,
    `threshold=${classifyDuration(durationMs)}`,
  ];
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      bits.push(`${key}=${String(value)}`);
    }
  }
  console.info(bits.join(" "));
}

async function timed<T>(operation: string, fn: () => Promise<T> | T, extra?: Row["extra"]): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    record(operation, performance.now() - started, extra);
  }
}

function csvForRows(n: number) {
  const header = "firstName,email,phone,whatsappNumber,source";
  const rows = Array.from(
    { length: n },
    (_, i) => `Perf${i},perf${i}@timing.invalid,+92300999${String(i).padStart(4, "0")},+92300999${String(i).padStart(4, "0")},WALK_IN`,
  );
  return [header, ...rows].join("\n");
}

async function main() {
  const hash = await bcrypt.hash("timing-only", 10);
  await timed("auth.passwordVerify", () => bcrypt.compare("timing-only", hash));

  const webhookBody = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const secret = "perf-audit-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(webhookBody, "utf8").digest("hex")}`;
  await timed("webhook.signature", () => verifyHubSignature256(webhookBody, signature, secret));

  for (const n of [100, 500] as const) {
    const text = csvForRows(n);
    const parsed = await timed(`csv.parse.${n}`, () => parseLeadCsv(text), {
      bytes: Buffer.byteLength(text, "utf8"),
      rows: n,
    });
    if (parsed.valid.length !== n) {
      throw new Error(`expected ${n} valid rows, got ${parsed.valid.length}`);
    }
  }

  try {
    parseLeadCsv(csvForRows(1000));
    record("csv.parse.1000", 0, { executed: false, reason: "should_have_rejected" });
  } catch {
    record("csv.parse.1000", 0, { executed: false, reason: "rejected_by_csv_limits" });
  }
  record("csv.parse.5000", 0, { executed: false, reason: "rejected_by_csv_limits" });
  record("csv.parse.10000", 0, { executed: false, reason: "rejected_by_csv_limits" });

  try {
    await timed(
      "external.openMeteo",
      async () => {
        const res = await fetchWithTimeout(
          "https://api.open-meteo.com/v1/forecast?latitude=31.5204&longitude=74.3587&current=temperature_2m",
          { provider: "open-meteo", timeoutMs: FETCH_TIMEOUTS_MS.openMeteo },
        );
        return res.status;
      },
      { timeoutMs: FETCH_TIMEOUTS_MS.openMeteo },
    );
  } catch (error) {
    record("external.openMeteo", FETCH_TIMEOUTS_MS.openMeteo, {
      ok: false,
      reason: error instanceof Error ? error.name : "error",
    });
  }

  const workspace = await prisma.workspace.findFirst({
    where: { deletedAt: null },
    select: { id: true },
  });
  if (!workspace) {
    console.info("[PERF] operation=db.skipped reason=no_workspace");
    printSummary();
    await prisma.$disconnect();
    return;
  }
  const workspaceId = workspace.id;

  const counts = await timed("db.counts", async () => {
    const [leads, opportunities, properties, contacts, accounts, activities, tasks, proposals, messages] =
      await Promise.all([
        prisma.lead.count({ where: { workspaceId, deletedAt: null } }),
        prisma.opportunity.count({ where: { workspaceId, deletedAt: null } }),
        prisma.property.count({ where: { workspaceId, deletedAt: null } }),
        prisma.contact.count({ where: { workspaceId, deletedAt: null } }),
        prisma.account.count({ where: { workspaceId, deletedAt: null } }),
        prisma.activity.count({ where: { workspaceId } }),
        prisma.task.count({ where: { workspaceId, deletedAt: null } }),
        prisma.proposal.count({ where: { workspaceId, deletedAt: null } }),
        prisma.whatsAppMessage.count({ where: { workspaceId } }),
      ]);
    return { leads, opportunities, properties, contacts, accounts, activities, tasks, proposals, messages };
  });
  console.info(
    `[PERF] operation=db.dataset leads=${counts.leads} opportunities=${counts.opportunities} properties=${counts.properties} contacts=${counts.contacts} activities=${counts.activities}`,
  );

  const leadPage = await timed("db.lead.findMany.page20", () =>
    prisma.lead.findMany({
      where: { workspaceId, deletedAt: null },
      take: 20,
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        account: { select: { id: true, company: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
  );
  const leadJson = await timed("serialize.leads.page20", () => JSON.stringify(leadPage));
  record("response.leads.page20.bytes", 0, { bytes: Buffer.byteLength(leadJson, "utf8"), records: leadPage.length });

  await timed("db.lead.findMany.unbounded", () =>
    prisma.lead.findMany({
      where: { workspaceId, deletedAt: null },
      include: { owner: { select: { id: true, name: true } } },
    }),
  );
  const allLeads = await prisma.lead.findMany({
    where: { workspaceId, deletedAt: null },
    include: { owner: { select: { id: true, name: true } } },
  });
  const unboundedJson = await timed("serialize.leads.unbounded", () => JSON.stringify(allLeads));
  record("response.leads.unbounded.bytes", 0, {
    bytes: Buffer.byteLength(unboundedJson, "utf8"),
    records: allLeads.length,
  });

  await timed("db.opportunity.findMany.unbounded", () =>
    prisma.opportunity.findMany({
      where: { workspaceId, deletedAt: null },
      include: {
        stage: true,
        owner: { select: { id: true, name: true } },
        lead: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
  );

  const membership = await timed("db.membership.lookup", () =>
    prisma.workspaceMember.findFirst({
      where: { workspaceId },
      select: { userId: true, role: true },
    }),
  );

  await timed("insights.workspace.30d", () => workspaceInsights(workspaceId, resolveReportRange("30d")));
  await timed("insights.pipelineAging", () => pipelineAging(workspaceId));

  const sampleLead = await prisma.lead.findFirst({
    where: { workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (sampleLead) {
    await timed("ai.analyzeLead", () => analyzeLead({ workspaceId, leadId: sampleLead.id }));
    await timed("score.lead", () => scoreLead({ workspaceId, leadId: sampleLead.id }));
    if (membership?.userId) {
      await timed("automation.LEAD_CREATED", () =>
        runAutomations({
          workspaceId,
          actorId: membership.userId,
          trigger: "LEAD_CREATED",
          leadId: sampleLead.id,
        }),
      );
    }
  }

  await timed("search.8entity", () =>
    Promise.all([
      prisma.lead.findMany({
        where: { workspaceId, deletedAt: null, firstName: { contains: "a", mode: "insensitive" } },
        take: 6,
        select: { id: true, firstName: true },
      }),
      prisma.account.findMany({
        where: { workspaceId, deletedAt: null, company: { contains: "a", mode: "insensitive" } },
        take: 5,
        select: { id: true },
      }),
      prisma.contact.findMany({
        where: { workspaceId, deletedAt: null, firstName: { contains: "a", mode: "insensitive" } },
        take: 5,
        select: { id: true },
      }),
      prisma.property.findMany({
        where: { workspaceId, deletedAt: null, title: { contains: "a", mode: "insensitive" } },
        take: 6,
        select: { id: true },
      }),
      prisma.opportunity.findMany({
        where: { workspaceId, deletedAt: null, name: { contains: "a", mode: "insensitive" } },
        take: 6,
        select: { id: true },
      }),
      prisma.task.findMany({
        where: { workspaceId, deletedAt: null, title: { contains: "a", mode: "insensitive" } },
        take: 5,
        select: { id: true },
      }),
      prisma.proposal.findMany({
        where: { workspaceId, deletedAt: null, proposalNumber: { contains: "P", mode: "insensitive" } },
        take: 5,
        select: { id: true },
      }),
      prisma.activity.findMany({
        where: { workspaceId, title: { contains: "a", mode: "insensitive" } },
        take: 5,
        select: { id: true },
      }),
    ]),
  );

  await timed("dashboard.apiQueryBundle", () =>
    Promise.all([
      prisma.lead.count({ where: { workspaceId, deletedAt: null } }),
      prisma.opportunity.count({ where: { workspaceId, deletedAt: null } }),
      prisma.opportunity.findMany({
        where: { workspaceId, deletedAt: null, stage: { isWon: false, isLost: false } },
        select: { value: true, probability: true },
      }),
      prisma.activity.findMany({
        where: { workspaceId },
        orderBy: { date: "desc" },
        take: 12,
        include: { owner: { select: { id: true, name: true } } },
      }),
      prisma.task.findMany({
        where: { workspaceId, deletedAt: null, status: { in: ["TODO", "IN_PROGRESS"] } },
        take: 10,
      }),
      prisma.calendarEvent.findMany({
        where: { workspaceId, deletedAt: null, type: "SITE_VISIT" },
        take: 8,
      }),
    ]),
  );

  const exportRows = await timed("csv.exportQuery", () =>
    prisma.lead.findMany({
      where: { workspaceId, deletedAt: null },
      take: CSV_LIMITS.maxRows,
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        source: true,
        stage: true,
        notes: true,
      },
    }),
  );
  await timed("csv.exportGenerate", () => toCsv(exportRows), { rows: exportRows.length });

  const importText = csvForRows(100);
  const parsedImport = parseLeadCsv(importText);
  try {
    await timed("csv.import.100.rollback", async () => {
      await prisma.$transaction(
        async (tx) => {
          const emails = parsedImport.valid.map((row) => row.email).filter((value): value is string => Boolean(value));
          await tx.lead.findMany({
            where: { workspaceId, deletedAt: null, email: { in: emails } },
            select: { id: true, email: true },
          });
          await tx.lead.createMany({
            data: parsedImport.valid.map((row) => ({
              workspaceId,
              firstName: row.firstName,
              email: row.email,
              phone: row.phone,
              whatsappNumber: row.whatsappNumber,
              source: row.source,
              ownerId: membership?.userId,
            })),
          });
          throw new Error("perf_rollback");
        },
        { timeout: 30000 },
      );
    });
  } catch (error) {
    if (!(error instanceof Error && error.message === "perf_rollback")) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        record("csv.import.100.rollback", 0, { ok: false, code: error.code });
      } else {
        throw error;
      }
    }
  }

  const phone = (
    await prisma.lead.findFirst({
      where: { workspaceId, deletedAt: null, OR: [{ phone: { not: null } }, { whatsappNumber: { not: null } }] },
      select: { phone: true, whatsappNumber: true },
    })
  );
  if (phone) {
    const lookup = phone.whatsappNumber ?? phone.phone;
    if (lookup) {
      await timed("webhook.lookups", () =>
        Promise.all([
          prisma.lead.findFirst({
            where: { workspaceId, deletedAt: null, OR: [{ whatsappNumber: lookup }, { phone: lookup }] },
            select: { id: true },
          }),
          prisma.contact.findFirst({
            where: { workspaceId, deletedAt: null, OR: [{ whatsappNumber: lookup }, { phone: lookup }] },
            select: { id: true },
          }),
        ]),
      );
    }
  }

  printSummary();
  await prisma.$disconnect();
}

function printSummary() {
  const slow = results.filter((row) => classifyDuration(row.durationMs) !== "FAST" && row.durationMs > 0);
  console.info("[PERF] operation=summary.slowCount count=" + slow.length);
  for (const row of slow.sort((a, b) => b.durationMs - a.durationMs)) {
    console.info(`[PERF] operation=summary.slow name=${row.operation} duration=${Math.round(row.durationMs)}ms`);
  }
}

main().catch(async (error) => {
  console.error("[PERF] operation=audit.failed", error instanceof Error ? error.message : "error");
  await prisma.$disconnect();
  process.exitCode = 1;
});
