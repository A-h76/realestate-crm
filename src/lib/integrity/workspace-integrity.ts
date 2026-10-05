import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * DATA-006: the database does not stop a row in workspace A from pointing at a row in workspace B
 * (see docs/security/WORKSPACE-INTEGRITY-DECISION.md for why composite FKs were not added).
 * This read-only check finds any such reference. It is derived from the Prisma schema itself, so a
 * new relation between two workspace-owned models is covered automatically.
 */
export type CrossWorkspaceFinding = { child: string; column: string; parent: string; count: number };

type Relation = { child: string; column: string; parent: string; parentColumn: string };

export function workspaceScopedRelations(): Relation[] {
  const models = Prisma.dmmf.datamodel.models;
  const scoped = new Set(models.filter((m) => m.fields.some((f) => f.name === "workspaceId")).map((m) => m.name));
  const relations: Relation[] = [];
  for (const model of models) {
    if (!scoped.has(model.name)) continue;
    for (const field of model.fields) {
      if (field.kind !== "object" || !field.relationFromFields?.length) continue;
      if (field.relationFromFields.length !== 1 || !field.relationToFields?.length) continue;
      if (!scoped.has(field.type)) continue;
      relations.push({
        child: model.name,
        column: field.relationFromFields[0],
        parent: field.type,
        parentColumn: field.relationToFields[0],
      });
    }
  }
  return relations;
}

export async function findCrossWorkspaceReferences(
  workspaceId?: string,
): Promise<{ checked: number; findings: CrossWorkspaceFinding[] }> {
  const relations = workspaceScopedRelations();
  const findings: CrossWorkspaceFinding[] = [];
  for (const r of relations) {
    // Identifiers come from the generated Prisma schema, never from user input.
    const sql = `SELECT count(*)::int AS count FROM "${r.child}" c JOIN "${r.parent}" p ON c."${r.column}" = p."${r.parentColumn}"
      WHERE c."workspaceId" <> p."workspaceId"${workspaceId ? ` AND (c."workspaceId" = $1 OR p."workspaceId" = $1)` : ""}`;
    const rows = workspaceId
      ? await prisma.$queryRawUnsafe<{ count: number }[]>(sql, workspaceId)
      : await prisma.$queryRawUnsafe<{ count: number }[]>(sql);
    if (rows[0].count > 0) findings.push({ child: r.child, column: r.column, parent: r.parent, count: rows[0].count });
  }
  return { checked: relations.length, findings };
}
