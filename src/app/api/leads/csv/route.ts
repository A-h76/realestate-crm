import { NextResponse } from "next/server";
import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { CSV_LIMITS, parseLeadCsv, toCsv } from "@/lib/csv/leads";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { runAutomations } from "@/lib/automation/engine";
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
          const emails = [
            ...new Set(parsed.valid.map((row) => row.email).filter((value): value is string => Boolean(value))),
          ];
          const phones = [
            ...new Set(
              parsed.valid.map((row) => row.whatsappNumber).filter((value): value is string => Boolean(value)),
            ),
          ];

          const existing =
            emails.length === 0 && phones.length === 0
              ? []
              : await tx.lead.findMany({
                  where: {
                    workspaceId,
                    deletedAt: null,
                    OR: [
                      ...(emails.length ? [{ email: { in: emails } }] : []),
                      ...(phones.length ? [{ whatsappNumber: { in: phones } }] : []),
                    ],
                  },
                  select: { id: true, firstName: true, email: true, whatsappNumber: true },
                });

          const emailSet = new Set(
            existing
              .map((row) => row.email?.toLowerCase())
              .filter((value): value is string => Boolean(value)),
          );
          const phoneSet = new Set(
            existing.map((row) => row.whatsappNumber).filter((value): value is string => Boolean(value)),
          );

          const duplicates: Array<{ row: number; message: string }> = [];
          const toInsert = parsed.valid.flatMap((row, i) => {
            const emailHit = row.email ? emailSet.has(row.email.toLowerCase()) : false;
            const phoneHit = row.whatsappNumber ? phoneSet.has(row.whatsappNumber) : false;
            if (emailHit || phoneHit) {
              const match = existing.find(
                (lead) =>
                  (row.email && lead.email?.toLowerCase() === row.email.toLowerCase()) ||
                  (row.whatsappNumber && lead.whatsappNumber === row.whatsappNumber),
              );
              duplicates.push({
                row: i + 2,
                message: `Matches existing lead ${match?.firstName ?? ""}`.trim(),
              });
              return [];
            }
            if (row.email) emailSet.add(row.email.toLowerCase());
            if (row.whatsappNumber) phoneSet.add(row.whatsappNumber);
            return [
              {
                workspaceId,
                firstName: row.firstName,
                lastName: row.lastName,
                email: row.email,
                phone: row.phone,
                whatsappNumber: row.whatsappNumber,
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

    await measureExecution("csv.automations", async () => {
      const concurrency = 5;
      for (let i = 0; i < created.ids.length; i += concurrency) {
        const chunk = created.ids.slice(i, i + concurrency);
        await Promise.all(
          chunk.map((id) =>
            runAutomations({
              workspaceId,
              actorId: userId,
              trigger: "LEAD_CREATED",
              leadId: id,
            }),
          ),
        );
      }
    });

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
