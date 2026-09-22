# Disaster Recovery Runbook

Scope: the Postgres database backing the Lead-to-Sale CRM. This is the only
store with real client data — WhatsApp/AI/calendar providers are stateless
external calls and hold nothing that isn't already mirrored in Postgres.

## RPO / RTO targets (pilot)

| | Target | Basis |
| --- | --- | --- |
| RPO (max data loss) | 24 hours | Railway managed Postgres daily backups (verify enabled — see below) |
| RTO (max downtime) | 2 hours | Time to restore a backup + redeploy, per the drill below |

These are pilot-scale targets, not contractual SLAs. Tighten RPO by enabling
more frequent snapshots in Railway if a client requires it — that's a Railway
dashboard setting, not an application change.

## What's out of scope here

Railway's own backup configuration (snapshot frequency, retention) is a
platform setting, verified/configured directly in the Railway dashboard —
not through this codebase. This runbook assumes that's been checked and
covers what to do *with* a backup once you have one, and how the app
verifies its own DB connection is healthy.

## 1. Verify a backup exists and is restorable

Don't trust that backups are running — prove it periodically (before the
pilot, then on a schedule, e.g. monthly) with a real restore drill:

```bash
# 1. Dump the database (adjust host/user/db for the target environment)
pg_dump -h <host> -U <user> -Fc -f dr-drill.dump <database>

# 2. Restore into a throwaway database — never the original
createdb -h <host> -U <user> <database>_dr_drill
pg_restore -h <host> -U <user> --no-owner --no-privileges -d <database>_dr_drill dr-drill.dump

# 3. Sanity-check row counts against the original for a few core tables
psql -h <host> -U <user> -d <database> -c 'SELECT count(*) FROM "Lead";'
psql -h <host> -U <user> -d <database>_dr_drill -c 'SELECT count(*) FROM "Lead";'

# 4. Clean up
dropdb -h <host> -U <user> <database>_dr_drill
rm dr-drill.dump
```

**Last verified:** 2026-09-22, against the local dev database
(`leadtosale_crm`, 1 workspace / 3 users / 50 leads / 25 opportunities / 18
WhatsApp messages / 4 audit rows). Dump took <1s, restore took <2s, all
table counts matched exactly between original and restored copies. Re-run
this against the actual production database before the pilot goes live —
a successful drill against dev only proves the *procedure* works, not that
production backups are enabled.

## 2. Restoring production after data loss

1. Put the app in a known-down state if needed (Railway can pause the
   service from the dashboard).
2. Identify the most recent good backup (Railway snapshot, or a manual
   `pg_dump` if one was taken more recently).
3. Restore it into a **new** Postgres instance/database — never overwrite
   the live one in place until the restore is verified.
4. Point a scratch deploy's `DATABASE_URL` at the restored database and hit
   `GET /api/health` — it must return `{"status":"ok"}` (see below).
5. Spot-check a handful of records (recent leads, recent WhatsApp messages)
   against what the team remembers being there.
6. Cut `DATABASE_URL` over on the real service, redeploy
   (`prisma migrate deploy && next start` — see below), confirm `/api/health`
   is green, confirm login works.

## 3. Deploying schema changes safely

Production now deploys with `prisma migrate deploy`, not `prisma db push`
(see `package.json` `start:railway` and `railway.json`). `migrate deploy`
only applies committed migration files under `prisma/migrations/` in order
— it never infers or auto-applies schema drift, so a bad migration can't
silently reshape a live database the way `db push` could.

**One-time step before this first deploys to an existing production
database:** if production was previously deployed with `db push` (no
`_prisma_migrations` tracking table), `migrate deploy` will try to run
every migration from scratch and fail because the tables already exist.
Baseline it first, once, via `railway run` or the Railway shell:

```bash
npx prisma migrate resolve --applied 20260919120000_security_hardening
npx prisma migrate resolve --applied 20260919180000_perf_lookup_indexes
npx prisma migrate resolve --applied 20260922000000_add_handoff_enum_values
npx prisma migrate status   # should report "Database schema is up to date!"
```

After that one-time baseline, every future deploy just runs
`prisma migrate deploy` normally. This exact sequence was run and verified
against the local dev database as part of this change (same drift: two
enum values added via a prior `db push` with no matching migration file —
captured in `prisma/migrations/20260922000000_add_handoff_enum_values/`).

## 4. Health check

`GET /api/health` is public (no auth) and queries the database
(`SELECT 1`) rather than just confirming the Node process is up. It returns
`200 {"status":"ok","database":"ok","latencyMs":N}` or `503` on DB failure.
Railway's `healthcheckPath` points here (`railway.json`), so a deploy with a
broken DB connection fails the healthcheck instead of serving traffic.

## 5. Where to look during an incident — log/data separation

Four distinct places hold information, on purpose — don't conflate them:

| Layer | What it holds | Where |
| --- | --- | --- |
| **Business AuditLog** | Business events: lead/opportunity/proposal changes, logins, handoffs, etc. | Postgres `AuditLog` table, browsable at `/audit`, API at `/api/audit` (`src/lib/audit.ts`) |
| **Application logs** | Request timing (`[PERF]`) and security-relevant failures — 401/403/429, failed logins (`[SECURITY]`) | stdout, captured by Railway's log viewer (`src/lib/perf.ts`, `src/lib/security/log.ts`) |
| **Database/infra logs** | Postgres server logs, connection errors, platform-level events | Railway's own logging for the Postgres service — not this app |
| **Backups** | Point-in-time snapshots of the whole database | Railway managed Postgres backups — verified per §1 above, not application code |

If you're investigating "who did X" → AuditLog. "Why did a request fail /
who tried to break in" → grep Railway logs for `[SECURITY]`. "Is the DB
itself healthy" → `/api/health` plus Railway's Postgres metrics. "We lost
data" → §2 above.
