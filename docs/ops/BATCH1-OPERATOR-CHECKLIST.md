# Batch 1 — operator checklist (production-only verification)

These items cannot be proven from the repository. **None of them is verified as of this document.**
Each has an explicit pass condition and a place to record evidence. Do not mark an item done without
the evidence. Never paste secrets, connection strings or customer data into this file or a ticket.

Record evidence as: date, who ran it, environment, result, link/screenshot reference.

## 1. OPS-004 — production Postgres backups and restore readiness

Status: **UNVERIFIED.** The only restore drill on record ran against local dev (2026-09-22,
`DISASTER_RECOVERY.md` §1). That proves the procedure, not that production is backed up.

### 1a. Backup configuration (Railway dashboard, read-only)
- [ ] Project → Postgres service → **Backups**: backups are enabled.
- [ ] Schedule is at least daily (RPO target in `DISASTER_RECOVERY.md` is 24h). Record the schedule.
- [ ] Retention period is recorded (how many days of snapshots are kept).
- [ ] At least one snapshot exists that is newer than the schedule interval. Record its timestamp and size.
- [ ] Note who can restore (roles) and whether restore creates a new volume or overwrites in place.

### 1b. Restore drill (needs operator access; **never restore over the live database**)
1. Create a throwaway Postgres (new Railway service or local) — not the production instance.
2. Restore the most recent Railway snapshot into it, or `pg_dump -Fc` production (read-only) and
   `pg_restore --no-owner --no-privileges` into the throwaway database.
3. Compare row counts for `Lead`, `Opportunity`, `Property`, `WorkspaceMember`, `AuditLog`
   between production and the restored copy. Expected: equal, or lower only by writes made after the snapshot time.
4. Run `npx prisma migrate status` against the restored copy: must report the schema is up to date
   (9 migrations as of Batch 2, including the baseline, `20261003000000_account_setup_tokens` and `20261004000000_automation_idempotency`).
5. Point a scratch deploy at the restored database and confirm `GET /api/health` → `{"status":"ok"}`
   and that a known test user can sign in.
6. Record elapsed wall-clock time for steps 1–5 (this is the measured RTO; the documented target is 2h).
7. Destroy the throwaway database and any dump file (dumps contain customer data).

Pass condition: 1a all checked **and** 1b steps 1–6 completed with counts matching. Until then OPS-004 stays open
and the app must not hold real customer data.

> **Superseded by Batch 2 (read `docs/ops/ROLLBACK-RUNBOOK.md` section 5 first):** a new baseline migration
> `20260101000000_baseline` exists. On any existing database run `npx prisma migrate resolve --applied 20260101000000_baseline`
> once, before the next `migrate deploy`. The text below predates it.

### 1c. One-time baseline for an existing `db push` production database
`DISASTER_RECOVERY.md` §3 lists three `migrate resolve --applied` commands. If production was created with
`db push`, also baseline the later migrations **only if their changes are already present** in that database
(`20260926000000_add_manager_role`, `20260927000000_auth_sessions`, `20261002000000_member_invited_audit_action`);
otherwise let `migrate deploy` apply them. Check with `npx prisma migrate status` first. Take a backup before the first
`migrate deploy`.

## 2. AUTO-002 — scheduled inactive-lead follow-up wiring

Status: code and tests done; **the Railway Cron service does not exist yet**, so nothing runs on a schedule in production.
Steps are in `docs/ops/SCHEDULED-AUTOMATIONS.md`. Pass condition: one manual run from the Railway dashboard logs
`[scheduled-automations] done ... failedWorkspaces=0`, then confirm the next scheduled run appears in the deployment history.

## 3. SEC-003 — is `X-Real-IP` trustworthy behind Railway's edge?

Status: **UNVERIFIED.** `clientIp()` (`src/lib/security/request.ts`) prefers `X-Real-IP`. That is safe only if Railway's edge
overwrites a client-supplied value. Railway's docs say the header is edge-set; this has not been observed on the live service.

Test (use staging if one exists; otherwise a low-traffic window — it sends ~130 requests that the app rejects):
```bash
# The WhatsApp webhook rate-limits per client IP (120 / minute) before it checks the signature.
for i in $(seq 1 130); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://<app-host>/api/webhooks/whatsapp" \
    -H "X-Real-IP: 10.$((i/250)).$((i%250)).7" -H "X-Forwarded-For: 10.9.$((i%250)).1" -d '{}'
done | sort | uniq -c
```
- **Pass:** some responses are `429`. The forged rotating headers did not give each request its own bucket,
  so the edge is replacing them with the real client IP.
- **Fail:** no `429` at all. Client-supplied headers are honored: an attacker can evade every IP-keyed rate limit
  (login throttling, webhook, accept-invite). Stop trusting `X-Real-IP` in `clientIp()` and re-test before any pilot.
Wait about a minute afterwards before testing again from the same address.

## 4. OPS-001 — CI on the real repository
- [ ] Push the branch / open a PR; confirm `.github/workflows/ci.yml` runs and is green (typecheck, lint, tests, build, audit gate).
- [ ] In GitHub → Settings → Branches, make the `build-and-test` check **required** on `main` (otherwise CI is advisory only).

## 5. Environment sanity before any pilot
- [ ] `DEMO_MODE` is unset or not `true` in production.
- [ ] `AUTH_SECRET`, `AUTH_URL` are set; `AUTH_URL` is the public https origin (used to build team setup links).
- [ ] WhatsApp is in the intended mode (demo vs `WHATSAPP_BUSINESS_ENABLED=true` with credentials).
