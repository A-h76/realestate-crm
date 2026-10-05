# Observability: what the app logs, and what is NOT in place

## What exists

The app writes **structured JSON log lines to stdout/stderr** (`src/lib/log.ts`). Railway captures them in the
service Logs view. There is no logging framework, no log shipping, no metrics and no tracing.

Every line has `ts`, `level` (`info` / `warn` / `error`), `event`, and `requestId` when it happened inside a request.
`requestId` is the same value the client receives in the `x-request-id` response header and that the older
`[PERF] ...` timing lines carry, so one failing request can be followed across lines.

| `event` | Level | Meaning | Useful fields |
| --- | --- | --- | --- |
| `startup_config` | info / error | Configuration check at start-up (`src/lib/env.ts`). In production an `error` here is followed by exit code 1. | `mode`, `errors[]`, `warnings[]` (variable names and rules, never values) |
| `security_event` | warn | A 401 / 403 / 429 response or a failed login (this includes webhook signature failures and unknown WhatsApp phone numbers) | `status`, `message`, `account` (masked email for failed logins) |
| `unhandled_error` | error | An unexpected exception in an API route (the client got a generic 500) | `error.name`, `error.message` (first line, scrubbed) |
| `request_error` | error | A server-side render / route error captured by Next | `digest` (the reference the user sees on the error page), `path`, `routeType` |
| `whatsapp_webhook_failed` | error | The inbound webhook threw (not a rejected signature, which is `security_event`) | `error` |
| `whatsapp_send_failed` | error | An outbound Meta send was recorded as Failed | `httpStatus`, `errorCode`, `failureKind`, `attempts`, `messageId` |
| `automation_action_failed` | error | An automation action failed (also stored in the execution log) | `automationId`, `trigger`, `actionType`, `error` |
| `automation_execution_persist_failed` | error | The result of an automation run could not be saved | context ids, `error` |
| `automation_actions_truncated` | warn | A rule had more actions than the per-rule cap | `defined`, `ran` |
| `ai_provider_failed` | warn | The optional OpenAI call failed; the deterministic fallback was used | `httpStatus` or `error` |
| `health_database_failed` | error | The readiness check could not query Postgres | `latencyMs`, `error` |
| `login_audit_write_failed`, `logout_revoke_failed` | error | Bookkeeping around sign-in / sign-out failed (the sign-in itself still succeeded) | `error` |

To find something in Railway Logs, search for the quoted event name, e.g. `"event":"whatsapp_send_failed"`, or for a
`requestId` copied from a response header.

## What is never logged

Redaction is applied by field **name** (passwords, secrets, tokens, authorization, cookies, signatures, API keys,
`body` / `text` / `message` / `notes` fields, phone numbers, WhatsApp numbers, emails) and by **shape** (credentials
inside URLs, bearer tokens, long opaque strings). Errors are reduced to their name and first message line (stack
traces and Prisma query arguments are dropped), strings are cut at 300 characters, objects at three levels. Failed
logins record a masked address (`a***@example.com`). This is enforced by `tests/unit/structured-log.test.ts`, but the
rule only protects fields that go through `logEvent`: a bare `console.log` of customer data would bypass it, so do not
add one.

## What is NOT configured (do not assume otherwise)

- **No alerting.** Nothing notifies anyone when `/api/health` fails, a deploy fails, or error lines appear.
- **No uptime monitor** is set up. `GET /api/health/live` is cheap and meant for one; `GET /api/health` runs a database
  query and is Railway's deploy gate.
- **No error tracker** (Sentry or similar), no metrics, no dashboards.
- **Log retention** is whatever the Railway plan provides; it has not been checked.
- The audit log (`/audit`, `AuditLog` table) records business events for users; it is not an operations log.

## Suggested alerts (a decision for the operator, not implemented)

1. External uptime check on `/api/health/live` (every minute), and on `/api/health` less often (every 5 minutes).
2. Log-based alert on `"level":"error"` for the events above, at least `whatsapp_send_failed` and
   `automation_action_failed`.
3. A repeating `security_event` with `status:401` for one `account`, which is a credential-guessing signal.
4. Railway deploy-failure notifications.

Add infrastructure for these only when the volume of real traffic justifies it.
