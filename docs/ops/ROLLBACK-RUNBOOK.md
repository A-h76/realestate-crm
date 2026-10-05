# Rollback and recovery runbook (OPS-005)

Scope: application rollback and database-migration rollback for the Lead-to-Sale CRM on Railway.
Complements `DISASTER_RECOVERY.md` (backups/restore). **Nothing here has been run against production.**
The reversible parts were exercised on a disposable local database (see "What was actually tested").

## 1. Principles
- **Prefer rolling forward.** Every migration so far is additive. Old application code keeps working against a newer
  schema (extra nullable columns/tables are ignored), so the usual fix for a bad release is to redeploy the previous
  application build and leave the database alone.
- **Take a backup before any `migrate deploy`** (Railway snapshot or `pg_dump -Fc`). A restore, not a rollback script,
  is the answer to data damage.
- **Never run a down script against production without a fresh backup and a second person reading it.**

## 2. Migration compatibility table
| Migration | Adds | Old app code still works? | Reversible? | Rollback file |
| --- | --- | --- | --- | --- |
| `20260101000000_baseline` | whole pre-migration schema (fresh DBs only) | n/a | no (it is the schema) | - |
| `20260919120000_security_hardening` | WhatsAppIntegration, WebhookEvent, RateLimitBucket, unique WhatsApp message id (also **deleted duplicate WhatsApp rows**) | no - webhooks and rate limiting need these | **No** (data deletion + live tables); restore from backup | - |
| `20260919180000_perf_lookup_indexes` | 3 indexes | yes | yes, safe | `prisma/rollback/20260919180000_perf_lookup_indexes.down.sql` |
| `20260922000000_add_handoff_enum_values` | 2 enum values | yes | enum values cannot be dropped; harmless | - |
| `20260926000000_add_manager_role` | MANAGER role + 2 audit enum values | **no if any member holds MANAGER** (old code does not know the role) | enum value cannot be dropped; first change MANAGER members to AGENT | - |
| `20260927000000_auth_sessions` | AuthSession table | yes (ignored) but everyone is signed out on rollback of the *code*, because old tokens carry no session id | yes | `prisma/rollback/20260927000000_auth_sessions.down.sql` |
| `20261002000000_member_invited_audit_action` | 1 audit enum value | yes | enum value stays; harmless | - |
| `20261003000000_account_setup_tokens` | AccountSetupToken table, 1 audit enum value | yes | yes; pending invitation links die | `prisma/rollback/20261003000000_account_setup_tokens.down.sql` |
| `20261004000000_automation_idempotency` | `Task.dedupeKey`, `Notification.dedupeKey` + unique indexes | yes | yes; idempotency keys are discarded | `prisma/rollback/20261004000000_automation_idempotency.down.sql` |

## 3. Application rollback (no schema change)
1. Railway -> service -> Deployments -> choose the last good deployment -> **Redeploy** (or `git revert` + push).
2. `GET /api/health` must return `{"status":"ok"}` (readiness, database reachable; `/api/health/live` is process-only); sign in; open the dashboard. The release procedure and smoke tests are in `RELEASE-RUNBOOK.md`.
3. Behavioural differences when running **older code on the newer schema**:
   - code before Batch 2 ignores `dedupeKey`, so retried automations can repeat (the old behaviour);
   - code before `auth_sessions` has no session revocation; users are signed out once;
   - code before Batch 1 `account_setup_tokens` has no `/accept-invite`; outstanding links return 404.
4. Record what was rolled back and why.

## 4. Migration rollback (only when the old code cannot run on the new schema)
For each migration to undo, newest first, with a backup taken:
```bash
npx prisma db execute --schema prisma/schema.prisma --file prisma/rollback/<migration>.down.sql
# Prisma will otherwise think the migration is still applied. `migrate resolve --rolled-back` only works on
# FAILED migrations, so remove the bookkeeping row instead:
echo "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '<migration>';" > forget.sql
npx prisma db execute --schema prisma/schema.prisma --file forget.sql && rm forget.sql
npx prisma migrate status        # must list the migration as "not yet applied"
```
Then deploy the older application build. To go forward again, `npx prisma migrate deploy` re-applies it.
Data written *while* a column existed (e.g. dedupeKey values) is gone after a rollback and is not restored by re-applying.

## 5. Building or rebuilding a database from scratch
`npx prisma migrate deploy` now works on an empty database: the baseline creates the pre-migration schema and the later
migrations apply on top (CI checks that the result equals `schema.prisma`).

**Existing databases (production, dev) were created before migrations existed and already contain the baseline.**
Mark it applied once, before the next deploy - do not run it:
```bash
npx prisma migrate resolve --applied 20260101000000_baseline
npx prisma migrate status
```
If production was originally created with `db push` and never baselined, `DISASTER_RECOVERY.md` section 3 lists the
older `migrate resolve --applied` commands; run those **and** the baseline one for whichever migrations' changes are
already present, then `migrate deploy` for the rest. Check `migrate status` first and keep a backup.

## 6. Recovery verification checklist (after any rollback or restore)
- [ ] `npx prisma migrate status` -> "Database schema is up to date" (or the intended pending list).
- [ ] `GET /api/health` ok; login works for an OWNER and an AGENT.
- [ ] `npm run integrity:check` (read-only) -> no cross-workspace references.
- [ ] Spot-check recent leads, opportunities and WhatsApp messages against what the team expects.
- [ ] A won opportunity's property shows SOLD/RENTED; an open one shows AVAILABLE (DATA-003 invariant).
- [ ] The scheduled automation run (if the Cron service exists) completes with `failedWorkspaces=0`.

## 7. Duplicate leads report (read-only, before any future unique constraint)
Lead de-duplication is enforced in code under advisory locks, not by a unique index, because existing workspaces may
already contain duplicates. To see them:
```sql
SELECT "workspaceId", right(regexp_replace(coalesce("whatsappNumber","phone"), '\D', '', 'g'), 10) AS last10, count(*)
FROM "Lead" WHERE "deletedAt" IS NULL AND coalesce("whatsappNumber","phone") IS NOT NULL
GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY 3 DESC;
```
Merge or soft-delete duplicates by hand; only then consider a partial unique index.

## 8. What was actually tested (local, disposable database)
- Fresh database: baseline + 8 migrations applied; `prisma migrate diff` against `schema.prisma`: no difference.
- With seeded rows (workspace, lead, tasks and a notification with dedupe keys, a setup token): rollback of
  `20261004000000` and `20261003000000` removed the columns/table, **all lead/task/notification rows survived**,
  `migrate status` listed both as pending, `migrate deploy` re-applied them, schema diff: none.
- **Not tested:** any rollback against production or a copy of production data, restoring a Railway snapshot, the
  irreversible migrations, running old application code against the rolled-back schema.
