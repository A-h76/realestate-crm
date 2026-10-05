# DATA-006 - cross-workspace relational integrity: decision

## Problem
Tenant isolation is enforced in application code (`src/lib/tenant.ts` and `workspaceId` on every query). The database does
not prevent a row in workspace A from referencing a row in workspace B: every relation is a plain single-column foreign key
to `id`. A future code bug could therefore create a cross-workspace link that the database would accept.

## Options considered
1. **Composite foreign keys** `(parentId, workspaceId) -> (id, workspaceId)` on every workspace-owned relation.
   - Needs `@@unique([id, workspaceId])` on each parent and a rewritten relation on each child (39 workspace-scoped
     relations in the current schema, found by `workspaceScopedRelations()`).
   - `ON DELETE SET NULL` on a composite key would try to null `workspaceId`, which is NOT NULL; Postgres 15+ supports
     `SET NULL (column)` but Prisma does not express it, so every optional relation (most of them) needs a hand-edited
     migration that Prisma's schema would then disagree with, causing permanent drift warnings.
   - Large, hard-to-reverse change touching nearly every table, on a database that may already contain bad rows
     (adding the constraint would fail), with no way to check that first until now.
2. **Row-level security** in Postgres: needs a per-request `SET app.workspace_id` on a pooled connection and changes every
   query path; high blast radius.
3. **Detect, do not prevent (chosen):** a read-only checker that finds any cross-workspace reference, generated from the
   Prisma schema so new relations are covered automatically.

## Decision
Do **not** add composite FKs in this batch. Add the checker and keep the application-level guards.
- `src/lib/integrity/workspace-integrity.ts` + `npm run integrity:check` (SELECT-only, safe against production).
- Tested (`tests/security/workspace-integrity.test.ts`) by planting a cross-workspace row with raw SQL.
- HTTP-level isolation tests (`tests/security/tenant-isolation-http.test.ts`) prove the application guards hold.
- Run `integrity:check` after every restore/rollback (ROLLBACK-RUNBOOK section 6) and periodically on production.

## What this does NOT give you
The database still accepts a cross-workspace link if code or a manual SQL statement creates one; the checker reports it
afterwards, it does not prevent it. Application-level checks alone are not proof of relational integrity, which is why the
checker exists.

## Revisit when
- the checker ever reports a finding, or
- the product moves to direct SQL access / reporting tools / multiple writers, or
- a clean migration path exists (e.g. Prisma supports `SET NULL (col)` for composite keys). A pilot of composite FKs on
  the highest-risk pairs (Opportunity->Lead/Property/Account, Proposal->Opportunity, Task->Lead) would be the first step,
  after `integrity:check` reports zero on production.
