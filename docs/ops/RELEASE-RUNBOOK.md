# Release runbook

Scope: shipping a new version of the Lead-to-Sale CRM to Railway and knowing it worked. Rollback and restore steps are
in `ROLLBACK-RUNBOOK.md`; backups in `../../DISASTER_RECOVERY.md`; the scheduled job in `SCHEDULED-AUTOMATIONS.md`;
what the app logs in `OBSERVABILITY.md`.

**Status: written from the code and configuration, not rehearsed on Railway.** Every command below that touches
production is a manual operator action. Nothing here has been run against the production project.

## 0. Rules that keep a release safe

1. **Migrations must stay backward compatible (additive).** Railway starts the new release (which runs
   `prisma migrate deploy`) while the previous release is still serving, and keeps the previous one if the new one never
   becomes healthy. Old code therefore runs against the new schema for a while. A migration that drops or renames
   something the old code reads breaks that window. See the compatibility table in the rollback runbook.
2. **Never put real customer data in an environment until OPS-004 is closed** (production backups and a restore drill
   are verified; see `BATCH1-OPERATOR-CHECKLIST.md`).
3. **Never run a rollback script or restore against production without a fresh backup and a second reader.**

## 1. Before deploying

- [ ] The commit is on `main` and CI is green on it: typecheck, lint, tests, build, **CSP check**, dependency audit
      (critical gate). CI also applies every migration to an empty database and fails if the result differs from
      `schema.prisma`.
- [ ] `npx prisma migrate status` against production (read-only) lists exactly the migrations you expect to be pending.
      Read each pending `migration.sql`: is it additive? If not, stop and plan a maintenance window.
- [ ] A backup exists that is newer than this change: Railway Postgres snapshot, or `pg_dump -Fc` (contains customer
      data: store it like the database). Record its timestamp.
- [ ] Environment variables reviewed against `.env.example`. The app validates them at start-up (section 3): a missing
      or placeholder `DATABASE_URL` / `AUTH_URL` / `AUTH_SECRET` stops the release before it takes traffic. Optional
      integrations (WhatsApp, Upstash, OpenAI) only produce warnings.
- [ ] If this release changes WhatsApp variables: re-read `WHATSAPP_BUSINESS_ENABLED` rules (live needs the token and
      phone-number id; webhooks also need the app secret and verify token). A half-set live configuration records
      sends as **Failed**, never as sent.

## 2. Deploy order

1. Push to `main` (or redeploy in the Railway dashboard). Railway builds with Railpack.
2. Start command, in order: `npx prisma migrate deploy` then `npx next start`.
   - A failing migration aborts the start; the release never becomes healthy and the previous release keeps serving.
   - Then the app's start-up configuration check runs (section 3). An invalid production configuration exits with
     code 1 and names every problem.
3. Railway polls `GET /api/health` (readiness: one `SELECT 1`, bounded to 3 seconds) for up to 300 seconds. It switches
   traffic only after it returns 200. Restart policy: on failure, up to 5 retries.
4. The scheduled-automation Cron service (if it exists; it may not, see `SCHEDULED-AUTOMATIONS.md`) is a separate
   Railway service built from the same repository. Redeploy it after the web service so both run the same code.

## 3. Verify (first 15 minutes)

- [ ] **Logs** (Railway > service > Logs): find the single `"event":"startup_config"` line. Check `mode`
      (`production`, or `demo` if `DEMO_MODE=true`) and read every entry in `warnings`. An unexpected `demo` mode on a
      production deployment is a configuration mistake.
- [ ] `GET /api/health/live` returns `{"status":"ok"}` (process up) and `GET /api/health` returns `{"status":"ok"}`
      (database reachable). A 503 from readiness means the database is unreachable; the body never says more, the log
      has `health_database_failed`.
- [ ] `npx prisma migrate status` (Railway shell) reports "Database schema is up to date".
- [ ] No new `"level":"error"` lines other than expected ones: search `request_error`, `unhandled_error`,
      `whatsapp_webhook_failed`, `automation_action_failed`.
- [ ] Settings > Integrations shows the WhatsApp state you intend: **Demo**, **Live**, or **Not connected** (with the
      missing setting named). It must never say Live unless live is configured.

## 4. Smoke tests

Use a throwaway test user in a test workspace, never a real customer record, and a **test** WhatsApp number if live
mode is on. About 10 minutes.

1. Sign in as an OWNER; the dashboard loads with no error page.
2. Leads: create a lead; open it; change its stage. The timeline shows the change.
3. Pipeline: move an opportunity with the "Move to stage" control.
4. As an AGENT and as a VIEWER: write buttons are hidden for the VIEWER, and an AGENT cannot take over a colleague's
   lead.
5. WhatsApp: open a lead's thread; the badge matches Settings. Send one message. Demo: it is labelled demo. Live: it
   shows SENT then DELIVERED from Meta's status webhook. Not connected: it shows Failed.
6. Meta webhook (live only): in the Meta dashboard, "Verify and save" the callback URL
   (`GET /api/webhooks/whatsapp` with the verify token), then send a message to the business number from a test phone
   and confirm a lead and an inbound message appear.
7. Settings > Team (OWNER): invite a test member; the setup link is shown once; a second "New setup link" works.
8. Security headers and CSP in a browser, against the release URL:
   `ALLOW_REMOTE_DB=yes BASE_URL=https://<host> npm run check:csp` creates a throwaway user in the database it points
   at, so run it only against a disposable staging database; for production use steps 1-3 above and watch the browser
   console for CSP violations.
9. If the Cron service exists: trigger it once and confirm `failedWorkspaces=0` in its logs.

## 5. When something is wrong

| Symptom | First action |
| --- | --- |
| Release never becomes healthy; deploy shows failed | Open the new release's logs. `startup_config` with `errors`: fix the named variable(s) and redeploy. A migration error: do not retry blindly, read it, then `ROLLBACK-RUNBOOK.md` section 4. The previous release is still serving. |
| `/api/health` 503 after a deploy | Database unreachable or credentials changed. Check the Postgres service, then `DATABASE_URL`. |
| Errors started after the release, health is fine | Redeploy the previous deployment (`ROLLBACK-RUNBOOK.md` section 3). Leave the database alone unless the compatibility table says otherwise. |
| Data is wrong or missing | Stop writes if you can. Restore into a **new** database and compare (`DISASTER_RECOVERY.md`). Do not restore over the live one. |
| Pages are blank or buttons do nothing after a change to headers/proxy | Suspect the CSP: open the browser console for "Refused to execute inline script". Roll back; run `npm run check:csp` locally before retrying. |

## 6. What is not verified

- No deployment, rollback, restore, or health-gated switch-over has been rehearsed on the real Railway project.
- Railway's behaviour (keep the previous release when the new one fails its healthcheck) is taken from its
  documentation, not observed on this project.
- Backups and retention of the production database are unverified (OPS-004).
- No alerting is configured: nobody is notified when a health check fails or an error line appears
  (`OBSERVABILITY.md`).
