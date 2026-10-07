import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { CSV_LIMITS, parseLeadCsv, toCsv } from "@/lib/csv/leads";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { runAutomations } from "@/lib/automation/engine";
import { storedPhone } from "@/lib/leads/create-lead";
import {
  identityKeys,
  identityPhones,
  lockLeadIdentities,
  normalizedEmail,
  phoneVariants,
} from "@/lib/leads/identity";
import { ApiError } from "@/lib/errors";
import { measureExecution, measuredRoute } from "@/lib/perf";

export const GET = measuredRoute("GET /api/leads/csv", async () => {
  try {
    const { workspaceId, userId } = await requirePermission("csv:export");
    await enforceRateLimit({ key: `csv-export:${workspaceId}:${userId}`, ...RATE_LIMITS.csvExport });
    const leads = await measureExecution("csv.exportQuery", () =>
      prisma.lead.findMany({
        where: { workspaceId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: CSV_LIMITS.maxRows,
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          whatsappNumber: true,
          source: true,
          company: true,
          industry: true,
          preferredArea: true,
          budgetMin: true,
          budgetMax: true,
          intentType: true,
          stage: true,
          notes: true,
        },
      }),
    );
    const csv = await measureExecution("csv.exportGenerate", async () =>
      toCsv(
        leads.map((l) => ({
          firstName: l.firstName,
          lastName: l.lastName,
          email: l.email,
          phone: l.phone,
          whatsappNumber: l.whatsappNumber,
          source: l.source,
          company: l.company,
          industry: l.industry,
          preferredArea: l.preferredArea,
          budgetMin: l.budgetMin?.toString() ?? "",
          budgetMax: l.budgetMax?.toString() ?? "",
          intentType: l.intentType,
          stage: l.stage,
          notes: l.notes,
        })),
      ),
    );
    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "CSV_EXPORTED",
      entity: "Lead",
      entityId: workspaceId,
      metadata: { rows: leads.length },
    });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="leads.csv"',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
});

export const POST = measuredRoute("POST /api/leads/csv", async (request) => {
  try {
    const { workspaceId, userId } = await requirePermission("csv:import");
    await enforceRateLimit({ key: `csv-import:${workspaceId}:${userId}`, ...RATE_LIMITS.csvImport });

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > CSV_LIMITS.maxBytes) {
      throw new ApiError(413, "CSV exceeds the maximum size of 1MB");
    }
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > CSV_LIMITS.maxBytes) {
      throw new ApiError(413, "CSV exceeds the maximum size of 1MB");
    }
    const parsed = await measureExecution("csv.parseValidate", () => parseLeadCsv(text));

    const created = await measureExecution("csv.dbTransaction", () =>
      prisma.$transaction(
        async (tx) => {
          // DATA-001/002: same identity rules + locks as manual and WhatsApp intake, so a retried or
          // concurrent import of the same file cannot insert the same people twice.
          const rowIdentity = (row: (typeof parsed.valid)[number]) => ({
            phone: row.phone,
            whatsappNumber: row.whatsappNumber,
            email: row.email,
          });
          await lockLeadIdentities(
            tx,
            workspaceId,
            parsed.valid.flatMap((row) => identityKeys(rowIdentity(row))),
          );
          const emails = [
            ...new Set(parsed.valid.map((row) => normalizedEmail(row.email)).filter((value): value is string => Boolean(value))),
          ];
          const phoneVariantList = [
            ...new Set(parsed.valid.flatMap((row) => identityPhones(rowIdentity(row))).flatMap(phoneVariants)),
          ];

          const existing =
            emails.length === 0 && phoneVariantList.length === 0
              ? []
              : await tx.lead.findMany({
                  where: {
                    workspaceId,
                    deletedAt: null,
                    OR: [
                      ...emails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })),
                      ...(phoneVariantList.length
                        ? [{ whatsappNumber: { in: phoneVariantList } }, { phone: { in: phoneVariantList } }]
                        : []),
                    ],
                  },
                  select: { id: true, firstName: true, email: true, phone: true, whatsappNumber: true },
                });

          const emailSet = new Set(existing.map((row) => normalizedEmail(row.email)).filter((v): v is string => Boolean(v)));
          const phoneSet = new Set(existing.flatMap((row) => identityPhones(row)));
          const sameIdentity = (
            row: (typeof parsed.valid)[number],
            lead: { email: string | null; phone: string | null; whatsappNumber: string | null },
          ) => {
            const email = normalizedEmail(row.email);
            if (email && normalizedEmail(lead.email) === email) return true;
            const leadPhones = identityPhones(lead);
            return identityPhones(rowIdentity(row)).some((p) => leadPhones.includes(p));
          };

          const duplicates: Array<{ row: number; message: string }> = [];
          const toInsert = parsed.valid.flatMap((row, i) => {
            const email = normalizedEmail(row.email);
            const emailHit = email ? emailSet.has(email) : false;
            const phoneHit = identityPhones(rowIdentity(row)).some((p) => phoneSet.has(p));
            if (emailHit || phoneHit) {
              const match = existing.find((lead) => sameIdentity(row, lead));
              duplicates.push({
                row: i + 2,
                message: `Matches existing lead ${match?.firstName ?? ""}`.trim(),
              });
              return [];
            }
            if (email) emailSet.add(email);
            for (const p of identityPhones(rowIdentity(row))) phoneSet.add(p);
            return [
              {
                workspaceId,
                firstName: row.firstName,
                lastName: row.lastName,
                email: row.email,
                phone: storedPhone(row.phone),
                whatsappNumber: storedPhone(row.whatsappNumber),
                source: row.source,
                company: row.company,
                industry: row.industry,
                preferredArea: row.preferredArea,
                budgetMin: row.budgetMin,
                budgetMax: row.budgetMax,
                intentType: row.intentType,
                propertyTypePref: row.propertyTypePref,
                propertyPurpose: row.propertyPurpose,
                notes: row.notes,
                receivedAt: row.receivedAt,
                ownerId: userId,
              },
            ];
          });

          if (toInsert.length === 0) return { ids: [] as string[], duplicates };

          const inserted = await tx.lead.createManyAndReturn({
            data: toInsert,
            select: { id: true },
          });
          return { ids: inserted.map((row) => row.id), duplicates };
        },
        { timeout: 30000 },
      ),
    );

    // Buffered here and flushed once below: runAutomations() otherwise writes one
    // auditLog row per lead-action instead of one for the whole batch.
    const auditBuffer: Prisma.AuditLogCreateManyInput[] = [];
    let automationPersistFailures = 0;

    await measureExecution("csv.automations", async () => {
      if (created.ids.length === 0) return;
      // Fetched once for the whole batch: runAutomations() otherwise re-runs this
      // identical findMany on every row (measured ~3.5s of redundant queries at 500 rows).
      const automations = await prisma.automation.findMany({
        where: { workspaceId, trigger: "LEAD_CREATED", enabled: true, paused: false },
      });
      const concurrency = 5;
      for (let i = 0; i < created.ids.length; i += concurrency) {
        const chunk = created.ids.slice(i, i + concurrency);
        const chunkResults = await Promise.all(
          chunk.map((id) =>
            runAutomations(
              {
                workspaceId,
                actorId: userId,
                trigger: "LEAD_CREATED",
                leadId: id,
                eventKey: `lead-created:${id}`,
              },
              automations,
              auditBuffer,
            ),
          ),
        );
        for (const rows of chunkResults) {
          for (const row of rows) {
            if ("persisted" in row && row.persisted === false) automationPersistFailures += 1;
          }
        }
      }
    });

    if (auditBuffer.length > 0) {
      await measureExecution("csv.auditFlush", () => prisma.auditLog.createMany({ data: auditBuffer }));
    }

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "CSV_IMPORTED",
      entity: "Lead",
      entityId: workspaceId,
      metadata: {
        created: created.ids.length,
        invalid: parsed.invalid.length,
        duplicates: created.duplicates.length,
        // Count of automation bookkeeping writes that failed after their action already ran —
        // the leads above are still fully committed regardless (Finding F1).
        automationPersistFailures,
      },
    });

    return jsonOk({
      created: created.ids.length,
      ids: created.ids,
      invalid: parsed.invalid,
      duplicates: [
        ...parsed.duplicatesInFile.map((row) => ({ row, message: "Duplicate inside file" })),
        ...created.duplicates,
      ],
    });
  } catch (error) {
    return jsonError(error);
  }
});
