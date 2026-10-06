# Scheduled inactive-lead automation (AUTO-002)

## Is it required?
Evidence: every workspace is seeded with the rule "Lead inactive -> follow-up task" (shown on the Automations
screen), the master plan calls inactive-lead re-engagement central to the lead-to-sale value proposition, and the
feature tree lists it as built but never triggered. `PRODUCT.md` itself defers "advanced automation" without a
commitment. Decision taken in Batch 1: ship the minimum scheduler for the rule that is already advertised in the UI;
do not add other schedules.

## Defined behaviour
`npm run automations:scheduled` -> `scripts/run-inactive-lead-automations.ts` calls `evaluateInactiveLeads()` for every
non-deleted workspace, one after another.

| Aspect | Rule |
| --- | --- |
| Cadence | Daily. Railway cron is UTC: `0 3 * * *` = 03:00 UTC = 23:00 US Eastern (EDT) / 22:00 (EST). |
| Timezone | Irrelevant to eligibility: inactivity is a rolling 14 x 24h window from `lastActivityAt`. |
| Workspace coverage | All non-deleted workspaces. One workspace failing is logged; the rest still run; exit code 1 if any failed. |
| Eligible leads | Not LOST / ARCHIVED / CONVERTED, not soft-deleted, `lastActivityAt` older than 14 days or null. Oldest first. |
| Volume cap | 25 leads per workspace per run. A bigger backlog drains over successive days. |
| Action | The workspace's enabled, un-paused `LEAD_INACTIVE` automations (default: create a follow-up task). It does **not** send a WhatsApp message. |
| Idempotency | A lead with a non-FAILED `LEAD_INACTIVE` execution in the last 14 days is skipped. |
| Retries | A FAILED execution does not block the lead; the next daily run retries it. No in-run retry loop. |
| Duplicate-run prevention | Per-workspace Postgres advisory lock (`pg_try_advisory_xact_lock`) held for the whole evaluation. A second run (overlapping cron, second app instance, or the manual `POST /api/automations`) gets the lock denied and does nothing for that workspace. This is database-level, so it holds across instances. |

Tests: `tests/security/inactive-lead-scheduler.test.ts` (eligibility, repeat-run skip, lock held elsewhere -> no-op then
exactly-once, FAILED retried, paused rule ignored, converted/lost/archived ignored).

Known limits: no per-action idempotency key inside `runAutomations` (AUTO-003, Batch 2); the evaluation itself is
synchronous within the cron process (AUTO-005, Batch 2); a crash after a task is created but before its execution row
is written could create one extra task on the next run.

## Required manual action (not done by the repository)
In the Railway project:
1. Add a service from the same repo/image as the web service.
2. Settings -> Cron Schedule: `0 3 * * *`. Start command: `npm run automations:scheduled`.
3. Give it the same `DATABASE_URL` as the web service (nothing else is needed today).
4. Trigger one run from the dashboard and confirm the log shows `[scheduled-automations] done ... failedWorkspaces=0`.

Until step 4 is done, inactive-lead follow-up in production only happens when a user triggers it manually.

## Webhook recovery (`npm run webhooks:recover`)
A WhatsApp event is claimed (`WebhookEvent`) in the same transaction that stores the message; automations, consent,
handoff and the conversation turn run after that commit. If the process dies in between, Meta's retry is rejected as a
duplicate, so the customer's turn would be lost. `WebhookEvent.processedAt` is stamped when all steps finish;
`scripts/run-webhook-recovery.ts` replays events still unstamped after 2 minutes (each step is idempotent; a conversation
turn is skipped if an outbound already follows the inbound). At most 5 attempts per event; after that the event is logged as
`[webhook-recovery] EXHAUSTED ...` and the run exits 1.

Cadence: every 5 minutes (`*/5 * * * *`, Railway's minimum). Start command: `npm run webhooks:recover`.
**The Railway cron service for this is a manual step and is not confirmed in production.** Until it exists, a lost turn
is not recovered.

## Custody sweep (`npm run custody:sweep`)
Backs "every lead owned, every minute measured": `scripts/run-custody-sweep.ts` calls `sweepCustody()` (`src/lib/custody/sweep.ts`)
for every non-deleted workspace. It reuses the Needs Attention rules (`detectFlags`) rather than re-implementing them.

| Flag | Action |
| --- | --- |
| `UNASSIGNED` | Assign the least-loaded agent (audit `LEAD_UPDATED`, reason `custody_sweep_auto_assign`). No agents: left unowned. |
| `RESPOND_NOW` (customer waiting) / `NEW_UNCONTACTED` | Waiting 5 min: notify the owner (`RESPONSE_SLA_BREACH`, audit `CUSTODY_SLA_BREACH`). Waiting 15 min: also notify MANAGER/ADMIN members (OWNER if there are none), audit `CUSTODY_ESCALATED`. No owner: managers are told at 5 min. |
| `OVERDUE_FOLLOW_UP` | Owner told at once (`FOLLOW_UP_OVERDUE`); managers after 24 h overdue. |

Thresholds are constants in `CUSTODY_SLA`. Idempotency: one notification per recipient per waiting episode
(`custody:<flag>:<leadId>:<waitStartMs>:...` via `notifyOnce`), so a re-run, or an overlapping one, never repeats it; a new
episode (the customer writes again after being answered) notifies again. A per-workspace advisory lock makes overlapping
runs no-ops. One workspace failing is logged and the rest still run; exit code 1 if any failed. Limits: 500 workable leads
per workspace per run. Backlog guard: a breach whose wait started more than 24 h ago (48 h for overdue follow-ups) is never notified, and the first run in a workspace is silent (assigns owners, notifies nobody; marked by a `CUSTODY_SWEEP_RUN` audit row), so enabling the cron on an old backlog does not page anyone.

Cadence: every 5 minutes (`*/5 * * * *`, Railway's minimum). Start command: `npm run custody:sweep` (the npm script passes
`--conditions=react-server` because the attention loader imports `server-only`).
**The Railway cron service for this is a manual step and is not confirmed in production.** Until it exists, no SLA breach
is notified or escalated.

## Required Railway cron services (manual, not done by the repository)
Create two services from the same repo/image as the web service, each with the web service's `DATABASE_URL` (nothing else):

| Service | Cron Schedule | Start command |
| --- | --- | --- |
| `custody-sweep` | `*/5 * * * *` | `npm run custody:sweep` |
| `webhook-recovery` | `*/5 * * * *` | `npm run webhooks:recover` |
| `inactive-lead-automations` (already documented above) | `0 3 * * *` | `npm run automations:scheduled` |

Heartbeat: both 5-minute jobs upsert a `JobHeartbeat` row when a run finishes (a run with failures still counts as alive,
but is shown as "Last run had errors"). **Team Health -> Background jobs** shows "Not scheduled" (never ran), "Running",
or "Stopped" (no run for 15 minutes). It is deliberately not on `/api/health`, which is public and gates deploys.
