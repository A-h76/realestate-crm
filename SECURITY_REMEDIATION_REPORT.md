# Security Remediation Report

**Product:** Synas Labs Lead-to-Sale CRM  
**Date:** 2026-09-19  
**Scope:** P0 + P1 remediation against the provided repository audit  
**Method:** inspect → remediate → test → second review → report  

This report does **not** claim the product is 100% secure, fully secure, or free of vulnerabilities. Ratings below are evidence-based against the audit findings and the current source tree.

## Executive Summary

The original audit rated the system **HIGH RISK / NOT PRODUCTION READY** because demo credentials were public, the WhatsApp webhook was unauthenticated, RBAC existed in Prisma but was barely enforced, related-record IDs were trusted, some mutations were keyed only by primary key, and rate limiting was absent.

Those P0 classes have been closed in code:

- Demo Mode is fail-closed (`DEMO_MODE === "true"` only).
- Login no longer pre-fills or ships credentials.
- WhatsApp POST verifies Meta HMAC-SHA256 of the **raw** body, maps `phone_number_id` server-side, and de-duplicates events.
- Every sensitive API route calls `requirePermission(...)` and reloads membership from the database.
- Related IDs are checked with `assertRelationsInWorkspace`.
- Tenant mutations are workspace-scoped (`updateMany` / `findFirst` with `workspaceId`).
- Rate limiting uses Upstash when configured, otherwise PostgreSQL `RateLimitBucket` (memory fallback only in demo/test).

Automated security tests: **30 passed, 0 failed** (`npm test`).  
Typecheck: **PASS**. Lint: **PASS**. Production build: see verification section.

**Honest readiness:**

| Use | Status |
| --- | --- |
| DEMO (explicit `DEMO_MODE=true`) | Suitable |
| INTERNAL USE (`DEMO_MODE=false`, secrets rotated) | Suitable with remaining operational controls |
| PILOT | Conditional — see Remaining Risks |
| PRODUCTION | **Not yet** — remaining session, CSP, proxy-IP, pentest, and ops gaps |

## Original Risk

| Area | Original state |
| --- | --- |
| Demo credentials | Public on login (`ahmed@synaslabs.demo` / `demo1234`), seed hardcoded, `isDemoMode()` defaulted true |
| WhatsApp webhook | GET verified token; POST accepted arbitrary JSON into CRM |
| RBAC | Roles in schema; APIs mostly “user belongs to workspace” |
| IDOR | Parent records scoped; FK IDs trusted |
| Unscoped updates | `prisma.*.update({ where: { id } })` on attacker-supplied IDs |
| Rate limiting | None |
| Sessions | JWT could outlive membership/role |
| CSV | Unbounded body/rows; formula injection on export |
| Secrets | `passwordHash` loaded via broad User includes |

## P0 Findings

### P0.1 — Remove public demo owner credentials

| | |
| --- | --- |
| **Finding** | Login pre-filled demo credentials; seed password hardcoded; Demo Mode defaulted on. |
| **Original risk** | Seeded deployments takeover via public login. |
| **Fix** | `isDemoMode()` is `process.env.DEMO_MODE === "true"` only. Login fields start empty; no password in client JS. Seed refuses unless Demo Mode is on and `DEMO_SEED_PASSWORD` is operator-supplied (never printed). Demo reset requires `demo:reset` + Demo Mode + `isDemo` workspace. UI shows “Demo Environment” when enabled. |
| **Files changed** | `src/lib/demo-mode.ts`, `src/app/login/login-form.tsx`, `src/app/login/page.tsx`, `prisma/seed.ts`, `prisma/seed-data.ts`, `src/lib/demo/reset-demo.ts`, `src/app/api/demo/reset/route.ts`, `src/components/demo-banner.tsx`, `src/components/layout/app-shell.tsx`, `.env.example`, `README.md` |
| **Test added** | `tests/security/demo-mode.test.ts`, `tests/security/leakage.test.ts` |
| **Verification result** | **PASS.** Browser `/login`: empty email/password; HTML contains neither `demo1234` nor `ahmed@synaslabs.demo`. |

### P0.2 — Secure WhatsApp webhook

| | |
| --- | --- |
| **Finding** | `POST /api/webhooks/whatsapp` unauthenticated. |
| **Original risk** | Anyone could inject fake inbound messages. |
| **Fix** | Read raw body first. Verify `x-hub-signature-256` with HMAC-SHA256 + timing-safe compare against `WHATSAPP_APP_SECRET`. Missing/invalid signature → 401. Missing secret → 503 (fail closed). Map `phone_number_id` via `WhatsAppIntegration` or env pair `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_WORKSPACE_ID`. Unknown number → 403. No payload `workspaceId`. Idempotency via unique `WebhookEvent(provider, externalEventId)` and `WhatsAppMessage(workspaceId, provider, externalId)`. Rate limit 120/min/IP. Audit/notify do not store full message bodies. |
| **Files changed** | `src/lib/security/hmac.ts`, `src/lib/webhooks/whatsapp.ts`, `src/app/api/webhooks/whatsapp/route.ts`, Prisma models + migration |
| **Test added** | `tests/security/webhook.test.ts` |
| **Verification result** | **PASS** for signature, fail-closed secret, unknown `phone_number_id`. Duplicate uniqueness is schema-enforced; live replay insert is covered by unique constraint + `P2002` handler, not a second live HTTP replay test. |

### P0.3 — Implement real RBAC

| | |
| --- | --- |
| **Finding** | Roles unused for authorization. |
| **Original risk** | VIEWER/AGENT could hit admin mutations. |
| **Fix** | Central `PERMISSIONS` matrix in `src/lib/authz.ts`. `requirePermission` / `requireRole` reload membership from DB (not JWT role). Sensitive routes enforce a permission. VIEWER is read-only. AGENT keeps CRM workflows; cannot write workspace settings, read audit, execute automations, review AI, or reset demo. OWNER/ADMIN retain admin surfaces. |
| **Files changed** | `src/lib/authz.ts`, `src/lib/api.ts`, all `src/app/api/**` mutation/read routes listed in the audit |
| **Test added** | `tests/security/rbac.test.ts` |
| **Verification result** | **PASS** for matrix + route wiring (`requirePermission` on CRM/API surfaces). Live HTTP role-spoof tests were not run against a running server. |

### P0.4 — Close cross-workspace FK / IDOR paths

| | |
| --- | --- |
| **Finding** | Client-supplied related IDs trusted. |
| **Original risk** | Attach Workspace B records to Workspace A objects. |
| **Fix** | `assertRelationsInWorkspace` / `assertResourceInWorkspace` / `assertMemberInWorkspace`. Invalid foreign IDs return **400** (do not confirm foreign existence). Applied on lead/account/contact/property/opportunity/task/proposal/note/activity/calendar/whatsapp/intelligence creates and updates. |
| **Files changed** | `src/lib/tenant.ts`, CRM API routes |
| **Test added** | `tests/security/contracts.test.ts` |
| **Verification result** | **PASS** in code review. Automated tests assert helper coverage, not two-tenant HTTP attach. |

### P0.5 — Fix unscoped lead updates

| | |
| --- | --- |
| **Finding** | `prisma.lead.update({ where: { id } })` and similar. |
| **Original risk** | Mutate another tenant’s row by primary key. |
| **Fix** | `touchLeadActivity` uses `updateMany({ where: { id, workspaceId } })`. Resource GET/PATCH/DELETE use `findFirst` / `updateMany` / `delete` only after workspace match. Second-review grep of `src` found no remaining unscoped CRM `update({ where: { id } })` on tenant resources. `automationExecution.update({ where: { id } })` remains after creating the execution in-process (not client-supplied). |
| **Files changed** | `src/lib/tenant.ts`, WhatsApp/calendar/activity/CRM `[id]` routes |
| **Test added** | `tests/security/contracts.test.ts` |
| **Verification result** | **PASS** for lead/account/contact/property/opportunity/task/proposal patterns. |

### P0.6 — Implement rate limiting

| | |
| --- | --- |
| **Finding** | None. |
| **Original risk** | Credential stuffing, webhook flood, CSV/AI abuse. |
| **Fix** | `src/lib/rate-limit.ts`: Upstash REST if `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set; else PostgreSQL `RateLimitBucket` (works across instances sharing the DB). In-memory Map is **only** a demo/test fallback. 429 includes `Retry-After`. |

Documented limits:

| Surface | Key | Limit | Window |
| --- | --- | --- | --- |
| Auth/login | IP + email | 5 | 15 min |
| WhatsApp webhook | IP | 120 | 1 min |
| CSV import | workspace + user | 5 | 15 min |
| CSV export | workspace + user | 10 | 15 min |
| Intelligence / AI | workspace + user | 30 | 1 min |
| Scoring | workspace + user | 30 | 1 min |
| WhatsApp send/draft | workspace + user | 30 | 1 min |
| Search | workspace + user | 60 | 1 min |
| Demo reset | workspace + user | 3 | 1 hour |
| CRM mutations | workspace + user | 120 | 1 min |

| | |
| --- | --- |
| **Files changed** | `src/lib/rate-limit.ts`, auth POST wrapper, webhook, CSV, intelligence, WhatsApp, search, demo reset, mutation routes |
| **Test added** | `tests/security/rate-limit.test.ts` |
| **Verification result** | **PARTIAL.** Store + documented limits implemented. Live login 429 HTTP test not in the suite. Production at high QPS should configure Upstash (Postgres counter is a shared hotspot). `X-Forwarded-For` must come from a trusted proxy. |

## P1 Findings

### P1.1 — Session / membership invalidation

| | |
| --- | --- |
| **Finding** | JWT could retain workspace/role after revocation. |
| **Original risk** | Removed members keep API/app access. |
| **Fix** | JWT maxAge 8h. `requireWorkspaceAccess` / `requireAppAccess` load current `WorkspaceMember.role` from DB on every protected request. Missing membership → 403 / redirect login. `SignOutButton` calls Auth.js `signOut` (cookie cleared). Role in JWT is **not** used for authorization. |
| **Files changed** | `src/lib/auth.ts`, `src/lib/api.ts`, `src/lib/app-access.ts`, `src/components/layout/sign-out-button.tsx`, `src/app/(app)/layout.tsx` |
| **Test added** | `tests/security/contracts.test.ts` (membership reload) |
| **Verification result** | **PARTIAL.** Revoked members cannot pass server checks. Logout is cookie deletion, not a server-side session denylist. A stolen cookie of a **still-active** member remains valid until expiry (8h). |

### P1.2 — Security headers

| | |
| --- | --- |
| **Finding** | Missing application headers. |
| **Original risk** | MIME sniffing, clickjacking, mixed referrer leakage. |
| **Fix** | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Permissions-Policy`, `COOP: same-origin`. CSP allows `'unsafe-inline'` / `'unsafe-eval'` for Next.js App Router hydration. HSTS only when `NODE_ENV=production` (disable with `DISABLE_HSTS=true`). |
| **Files changed** | `src/lib/security/headers.ts`, `src/middleware.ts`, `next.config.ts` |
| **Test added** | Not a dedicated header test (verified in source + `next.config.ts`). |
| **Verification result** | **PASS** with documented CSP exceptions. |

### P1.3 — CSV hardening

| | |
| --- | --- |
| **Finding** | Unbounded body/rows; formula injection. |
| **Original risk** | DoS + spreadsheet execution on export. |
| **Fix** | Max 1MB, 500 rows, 2000 chars/field. Import is a Prisma transaction; `workspaceId` always from session. Export prefixes `= + - @` with `'`, UTF-8 BOM. Numeric negatives are not prefixed. VIEWER cannot import/export. |
| **Files changed** | `src/lib/csv/leads.ts`, `src/app/api/leads/csv/route.ts` |
| **Test added** | `tests/security/csv.test.ts` |
| **Verification result** | **PASS.** |

### P1.4 — Prevent client-controlled security fields

| | |
| --- | --- |
| **Finding** | Client could POST scores / workspace / role. |
| **Original risk** | Privilege and scoring integrity bypass. |
| **Fix** | Zod create/update schemas omit `leadScore`, `fitScore`, `intentScore`, `valueScore`, `workspaceId`, `role`, `deletedAt`. Scoring engine writes scores. `ownerId` must be a workspace member. |
| **Files changed** | `src/lib/validations/leads.ts` and other mutation schemas, scoring routes |
| **Test added** | `tests/security/api-hardening.test.ts` |
| **Verification result** | **PASS** for lead schema strip. Other entities reviewed the same way; not every schema has a dedicated unit test. |

### P1.5 — Never load passwordHash unnecessarily

| | |
| --- | --- |
| **Finding** | User includes loaded `passwordHash`. |
| **Original risk** | Hash leakage into RSC/API trees. |
| **Fix** | `passwordHash` is selected **only** in `src/lib/auth.ts` `authorize`. Owner relations use `{ select: { name: true } }` / `{ id, name }`. |
| **Files changed** | `src/lib/auth.ts`, RSC pages using `owner` |
| **Test added** | Repository grep in second review; leakage tests for client credentials |
| **Verification result** | **PASS.** |

### P1.6 — Restrict audit log access

| | |
| --- | --- |
| **Finding** | Any member could read audit. |
| **Original risk** | Sensitive ops metadata exposure. |
| **Fix** | `audit:read` is OWNER/ADMIN only. API/page omit actor email (`id` + `name` only). VIEWER/AGENT denied. |
| **Files changed** | `src/lib/authz.ts`, `src/app/api/audit/route.ts`, `src/app/(app)/audit/page.tsx` |
| **Test added** | `tests/security/rbac.test.ts` |
| **Verification result** | **PASS.** |

## Authentication

| Item | Status |
| --- | --- |
| Credentials provider + bcrypt | PASS |
| Unauthenticated API → 401 via `requireSession` | PASS (code) |
| Login rate limit IP+email | PASS (code); live 429 not in suite |
| Demo credentials not in client | PASS |
| Logout UI | PASS (`SignOutButton`) |
| Server-side session store / token denylist | FAIL (JWT cookie; 8h maxAge) |
| Membership revalidation | PASS |

**Category: PARTIAL**

## Authorization / RBAC

Central matrix enforced server-side. UI hiding is not the control.

| Role | Intended access |
| --- | --- |
| OWNER | All permissions |
| ADMIN | Same operational admin set (CRM, CSV, automations, audit, workspace, demo reset) |
| AGENT | CRM read/write/delete, CSV, WhatsApp, calendar, intelligence run, scoring, search |
| VIEWER | Read CRM/WhatsApp/calendar/intelligence/automations/workspace/notifications/search only |

**Category: PASS** (live cross-role HTTP not automated)

## Multi-Tenant Isolation

Workspace ID always from session. Client `workspaceId` ignored. Related IDs checked. Queries include `workspaceId` (and `deletedAt` where applicable).

**Category: PASS** (code). Automated two-workspace HTTP: **not executed**.

## API Security

- `requirePermission` on CRM, WhatsApp, calendar, intelligence, scoring, automations, audit, notifications, workspace, CSV, demo reset, search.
- Middleware covers app + API except public `/login`, `/api/auth`, `/api/webhooks/whatsapp`.
- Webhook remains network-public and cryptographically authenticated.
- Errors return `{ error: message }`; no `passwordHash` / env dumps.

**Category: PASS** with middleware deprecation warning (Next.js 16 prefers `proxy`; not migrated this pass).

## Rate Limiting

Distributed via Postgres (default) or Upstash (optional). Memory fallback is not production.

**Category: PARTIAL** until Upstash (or equivalent) is configured for high-traffic deploys, and the edge trusts only a reverse-proxy IP.

## Webhook Security

HMAC on raw body, timing-safe, fail closed, phone mapping, uniqueness, rate limit.

**Category: PASS** (requires production `WHATSAPP_APP_SECRET` + integration rows). Unsigned traffic is rejected; simulated inbound remains a **demo-mode** authenticated API, not a public bypass.

## Database Security

Migration `20260919120000_security_hardening`:

- `Workspace.isDemo` default **false**
- `WhatsAppIntegration.phoneNumberId` unique
- `WebhookEvent` unique `(provider, externalEventId)`
- `WhatsAppMessage` unique `(workspaceId, provider, externalId)`
- `RateLimitBucket` composite PK

Applied locally with `prisma db push` during development. Production should use `prisma migrate deploy` — **do not** `migrate reset` / `db:seed` / `clearEntireDatabase()` against real data.

**Category: PASS** for the constraints above.

## CSV Security

Size, rows, field length, formula escape, transactional import, session `workspaceId`.

**Category: PASS**

## Privacy

AI remains local/deterministic (no OpenAI/Anthropic). Webhook audit metadata is direction/webhook flags, not full body. Notifications say “New inbound WhatsApp message”. Open-Meteo weather remains the only unrelated external call.

**Category: PASS** for stated policy. Residual: CRM PII still stored in Postgres (expected).

## AI Data Handling

No external LLM. Intelligence/scoring/NBA stay in-process.

**Category: PASS**

## Caching

No CRM response cache added. App layout is `force-dynamic`.

**Category: PASS** (NOT APPLICABLE for a cache subsystem — none added)

## Security Headers

Present. CSP exceptions for Next.js are intentional.

**Category: PASS** (CSP is not nonce-strict)

## Secrets

| Variable | Handling |
| --- | --- |
| `DATABASE_URL` | Server only |
| `AUTH_SECRET` / `AUTH_URL` / `NEXTAUTH_URL` | Server only |
| `DEMO_MODE` | Fail closed; `.env.example` is `"false"` |
| `DEMO_SEED_PASSWORD` | Local seed only; not in example value |
| `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_ACCESS_TOKEN` | Server; webhook fails closed without app secret |
| `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_WORKSPACE_ID` | Server mapping fallback |
| `UPSTASH_REDIS_REST_*` | Optional |
| `GOOGLE_*` | Unchanged; not committed |

No `NEXT_PUBLIC_` secrets. `.env` is not committed. Local `.env` still contains a **demo** `AUTH_SECRET` that **must** be rotated before any real deployment.

**Category: PARTIAL** (code paths good; operator secrets on this machine are demo-grade)

## Security Testing

Framework: Node.js test runner + `tsx` (`npm test`). No extra npm dependencies.

| # | Case | Coverage |
| --- | --- | --- |
| 1 | Unauthenticated API → 401 | Code (`requireSession`); not live HTTP |
| 2 | Invalid credentials rejected | Auth.js `authorize` returns null |
| 3 | Login rate limit 429 | Code; not live HTTP |
| 4 | Logout invalidates session | Cookie `signOut`; no denylist test |
| 5–11 | Cross-workspace GET/PATCH/DELETE | Code + workspace `where`; not live two-tenant HTTP |
| 12–16 | FK IDOR | `assertRelationsInWorkspace` + contract test |
| 17–24 | RBAC | Matrix unit tests + route `requirePermission` |
| 25–27 | Webhook signatures | Unit tests PASS |
| 28 | Duplicate webhook | Unique constraint + `P2002`; no second insert test |
| 29 | Unknown `phone_number_id` | Unit+DB test PASS |
| 30 | Attacker `workspaceId` ignored | Contract test PASS |
| 31–34 | CSV size/rows/formula/workspace | Unit tests PASS |
| 35–37 | Revoked membership / role change | DB membership reload; no live revoke test |
| 38–40 | Leakage | Client/README/seed password tests + grep |

**Category: PARTIAL** — strong unit/contract suite; not a substitute for authenticated two-tenant HTTP or a pentest.

## Remaining Risks

1. **JWT theft:** an 8h cookie for an active member is valid until expiry. Database sessions or a denylist would reduce this.
2. **Trusted proxy:** login/webhook keys use `X-Forwarded-For`. Configure the platform so clients cannot spoof it.
3. **CSP:** `'unsafe-inline'` and `'unsafe-eval'` are required for current Next.js; XSS impact is higher than a nonce CSP.
4. **Rate limiter at scale:** Postgres counters work across instances but can contend. Set Upstash for busy pilots.
5. **No live IDOR/RBAC HTTP suite** against two workspaces.
6. **Next.js 16 middleware deprecation** (`proxy` migration not done).
7. **Demo seed emails** remain in `prisma/seed-data.ts` for the isolated demo dataset. Passwords are not in source; operators still must never seed production.
8. **Local `AUTH_SECRET`** in `.env` is a known demo placeholder.
9. **WhatsApp live send** was already incomplete; security work did not add a production Meta send path.
10. **No external pentest / dependency CVE audit** in this pass.
11. **Dev-only `dangerouslySetInnerHTML`** in root layout strips inspector attrs; not shipped as user-controlled HTML.
12. **CSV import** skips duplicates rather than failing the whole file; the transaction still prevents partial writes on thrown errors.

## Production Readiness

| Environment | Verdict |
| --- | --- |
| Isolated sales demo (`DEMO_MODE=true`) | **Ready** |
| Internal staff CRM (`DEMO_MODE=false`, rotated secrets, HTTPS) | **Ready for internal use** with remaining JWT/CSP/proxy caveats |
| External pilot with real leads | **Conditional** — complete the manual config list, prefer Upstash, restrict admin IPs if possible, run two-tenant HTTP tests |
| Production customer data | **Not ready** until remaining risks 1–6 and 8–10 are accepted or closed |

### Manual production configuration

1. `DEMO_MODE` unset or `"false"`. Never seed production.
2. Generate a unique `AUTH_SECRET` (≥32 chars). Rotate the local demo secret.
3. Set `AUTH_URL` / `NEXTAUTH_URL` to the HTTPS origin.
4. `DATABASE_URL` to a private Postgres. Run `npx prisma migrate deploy` only.
5. If WhatsApp Cloud is used: `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, map `phone_number_id` in `WhatsAppIntegration` (or env pair).
6. Recommended: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`.
7. Terminate TLS at a proxy that overwrites `X-Forwarded-For`.
8. Confirm HSTS is acceptable for the domain (`DISABLE_HSTS` only if TLS is not ready).
9. Do not run `npm run db:reset` or `db:seed` against production.

## Performance pass (same calendar day)

Observability and hang-protection were added without relaxing security controls: request IDs, `[PERF]` timings (no payloads/secrets), Prisma duration aggregation without SQL params, Upstash timeout 800ms, Open-Meteo timeout 2500ms. HMAC verification, bcrypt cost, RBAC, webhook signatures, audit writes, and rate limits remain. Details and measured numbers are in `PERFORMANCE_AUDIT.md`.

## Verification results (this pass)

| Check | Result |
| --- | --- |
| `npm test` | PASS — 38/38 (30 security + 8 performance) |
| `npx tsc --noEmit` | PASS (exit 0) |
| `npm run lint` | PASS (exit 0) |
| `npm run build` | PASS (exit 0). First attempt OOM’d on 11 page-data workers; `experimental.cpus: 1` made the build succeed. Next.js still warns that `middleware` is deprecated in favor of `proxy` (not migrated). Login is static `○`; authenticated CRM routes are dynamic `ƒ`. |
| Login UI | PASS — empty fields, no credentials in HTML |
| Second-review greps | `demo1234` only in tests; `passwordHash` only in `auth.ts`; no `NEXT_PUBLIC_` secrets |

## Category scorecard

| Category | Rating |
| --- | --- |
| Authentication | PARTIAL |
| Authorization / RBAC | PASS |
| Multi-tenant isolation | PASS |
| API security | PASS |
| Rate limiting | PARTIAL |
| Webhook security | PASS |
| Database security | PASS |
| CSV security | PASS |
| Privacy | PASS |
| AI data handling | PASS |
| Caching | PASS |
| Security headers | PASS |
| Secrets | PARTIAL |
| Security testing | PARTIAL |
| Production readiness | FAIL (as a blanket “production ready” claim) |
