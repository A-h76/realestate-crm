# Database, Session, Cookie & Storage Security Audit

Scope: Synas Labs Lead-to-Sale CRM (Next.js 16.3.5 App Router, Auth.js v5 beta, Prisma 6 / PostgreSQL, Railway).
Audit date: 2026-09-27. Method: full read of `src/`, `prisma/`, `scripts/`, `tests/`, config and docs; local test runs.
No production system was accessed or changed. No secret values appear in this document.

This report does not claim the system is "secure" or immune to attack. It records which boundaries exist, how they are enforced, what was hardened, and what can only be verified on the infrastructure side.

---

## 1. Executive summary

The API layer is in good shape. All 44 route handlers derive `workspaceId` from the authenticated session, re-check workspace membership and role **from the database** on every request, scope every Prisma query by `workspaceId`, validate bodies with Zod (which strips unknown keys, so `workspaceId`, `role` and score fields can't be mass-assigned), and verify that every client-supplied foreign key belongs to the caller's workspace (`src/lib/tenant.ts`). No raw SQL takes user input. We found no stored-XSS sink.

The weak points were in **session lifecycle** and **abuse controls**:

- **Session revocation:** sessions were stateless JWTs. Logout, removing a member, or soft-deleting a user did not invalidate an issued token, and a stolen cookie stayed valid indefinitely while in use (8h rolling).
- **Page authorization:** server-component pages trusted `session.user.workspaceId` from the JWT without a membership check. Only the layout checked, and in the App Router layouts do not gate pages.
- **Login rate limit:** it was keyed on the client-controlled leftmost `X-Forwarded-For` value plus the email, so it could be bypassed with one spoofed header. There was no per-account or per-IP limit.
- **Production backup on disk:** an unencrypted production `pg_dump` sits in the working tree.

No P0 findings. Four P1 findings. The three code-level P1s are remediated in this change. The fourth (the dump file) needs an operator decision and is documented.

## 2. Current architecture

```
Browser ──HTTPS──▶ Railway edge ──▶ Next.js (proxy.ts ▶ route handlers / RSC pages)
                                          │
        Auth.js v5 (Credentials only, JWT/JWE session cookie)
                                          │
        requirePermission() / requireAppAccess()   ◀── DB: AuthSession + WorkspaceMember
                                          │
        Prisma (workspace-scoped queries) ──▶ PostgreSQL (Railway managed)
```

- **Authentication:** email + password (bcrypt, cost 10) through the Auth.js Credentials provider. There is no signup, password reset, email verification, OAuth/Google sign-in, or account linking. Users are provisioned by seed or by an operator. (`src/lib/providers/calendar/google.ts` is a Calendar API integration, not a sign-in method.)
- **Session:** Auth.js `jwt` strategy. The cookie holds an encrypted JWE (A256CBC-HS512, key derived from `AUTH_SECRET` + cookie name) with `id`, `email`, `name`, `workspaceId`, `role`. After remediation it also holds `sid`, a pointer to a server-side `AuthSession` row.
- **Authorization:** `src/lib/authz.ts` maps roles to permissions (OWNER, ADMIN, MANAGER, AGENT, VIEWER). API routes call `requirePermission()`, which reads the role from `WorkspaceMember` in the DB, not from the token.
- **Tenancy:** a single-database, shared-schema model. Every CRM table carries `workspaceId` (FK to `Workspace`, cascading delete).
- **Rate limiting:** fixed-window counters in Upstash Redis if configured, otherwise a PostgreSQL `RateLimitBucket` table. It fails closed (503) outside demo/test.
- **Audit:** the `AuditLog` table, written by application code, readable through `audit:read` (OWNER, ADMIN, MANAGER). There is no update or delete endpoint.
- **Security log:** `[SECURITY]` console lines for 401/403/429 and failed logins (`src/lib/security/log.ts`).

## 3. Data classification

Only fields that exist in `prisma/schema.prisma` are listed.

| Class | Data (model.field) | Why stored | Who can read | Retention | Encrypt at field level? | Remove? |
|---|---|---|---|---|---|---|
| PUBLIC | Enum metadata, product copy | UI | Anyone | n/a | No | No |
| INTERNAL | `Workspace` (name, slug, timezone, currency, isDemo), `WorkspaceBranding`, `PipelineStage`, `Automation` config, `RateLimitBucket`, `WebhookEvent` ids | Configuration / idempotency | Workspace members (`workspace:read`, `automations:read`) | Life of workspace (buckets/webhook ids: no purge job, see F-19) | No | No |
| CONFIDENTIAL | `Lead` requirements (budgetMin/Max, preferredArea, property prefs, timeline, scores), `Opportunity` (value, stage, lostReason), `Property` (price, address, owner contact), `Proposal`, `Task`, `CalendarEvent` (site visits, locations), `Note.body`, `Activity.notes`, `IntelligenceRun.inputSnapshot/output`, `ScoreHistory` | Core CRM workflow | Members with `crm:read` / `intelligence:read` in the same workspace | Soft-deleted (`deletedAt`) and never hard-purged | No (at-rest disk encryption is enough; see §14) | No |
| SENSITIVE (PII) | `Lead`/`Contact` firstName, lastName, email, phone, whatsappNumber; `User.email`, `User.name`, `User.phone`; `WhatsAppMessage.body` (customer conversations) | Contacting customers, which is the product's purpose | `crm:read` / `whatsapp:read` members; CSV export needs `csv:export` | As above; soft delete keeps PII | Not required by the threat model; DB-at-rest encryption must be verified (INFRA-2) | **`User.phone` and `User.image` are never written or read by app code.** Recommend dropping them (F-20) |
| SENSITIVE (security) | `User.passwordHash` (bcrypt), `AuthSession` (sid, expiry, revocation), `AuditLog`, `[SECURITY]` logs (contain the failed-login email) | Authentication / forensics | passwordHash: never selected outside login. AuditLog: `audit:read`. AuthSession: never exposed through the API | AuditLog: life of workspace (cascade). AuthSession: expired rows kept (small); purge job recommended | Hash already one-way | No |
| SECRETS | `DATABASE_URL`, `AUTH_SECRET`, `OPENAI_API_KEY`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ACCESS_TOKEN`, `UPSTASH_REDIS_REST_TOKEN`, `DEMO_SEED_PASSWORD`, `UX_AUDIT_PASSWORD` | Provider access | Server env only. Never in the DB, cookies, client bundle or API responses (verified; no `NEXT_PUBLIC_*` variables exist) | n/a | Secret manager (INFRA-6) | No |

## 4. Database security

| Check | Result |
|---|---|
| Query safety | Two raw queries (`src/lib/health.ts` `SELECT 1`; `src/lib/rate-limit.ts` upsert). Both use `$queryRaw` tagged templates, so values are bound parameters. No `$queryRawUnsafe` / `$executeRawUnsafe`. User-controlled `orderBy` is allow-listed per route. No user-controlled `select`/`include`. |
| Foreign keys | Every relation is a real FK. Tenant children cascade from `Workspace`. Cross-entity FKs (lead→owner, etc.) are `Restrict`/`SetNull` by Prisma default. |
| Cross-tenant FK integrity | The DB cannot enforce that `Lead.accountId` points to an Account in the *same* workspace (no composite FKs). The app enforces it in `assertRelationsInWorkspace` on every write path. Composite FKs `(workspaceId, id)` would be the DB-level upgrade (F-21). |
| Unique constraints | `User.email`, `Workspace.slug`, `(workspaceId,userId)` membership, `(workspaceId,slug)` stage, `(workspaceId,proposalNumber)`, `(workspaceId,provider,externalId)` WhatsApp idempotency, `(provider,externalEventId)` webhooks. |
| Soft delete | Leads, accounts, contacts, properties, opportunities, tasks, proposals, calendar events. Every read filters `deletedAt: null`. PII stays in the DB after "delete" (see F-20). |
| Transactions | CSV import is transactional. Other multi-step writes (stage change + activity + audit) are sequential, not atomic. That's a consistency risk, not a security one. |
| Migrations | `prisma migrate deploy` at start (`railway.json`). Migrations are additive. The new migration adds a table and enum values only. |
| Error leakage | `jsonError` returns a generic `Internal server error` for anything that isn't an `ApiError`. Prisma messages are not returned to clients. |
| DB credentials / privileges / TLS / network exposure / encryption at rest / backups | **Not verifiable from the repository.** See §15 INFRA items. |

## 5. Session security

| Aspect | Before | After |
|---|---|---|
| Strategy | Stateless JWE, 8h `maxAge`, re-issued every 15 min (`updateAge`) | Same JWE, plus a server-side `AuthSession` row whose id (`sid`) is embedded in the token |
| Lifetime | 8h idle, **no absolute cap** (rolling) | 8h idle (JWT) **and** 12h absolute (`AuthSession.expiresAt`) |
| Signing / encryption | Auth.js JWE, key from `AUTH_SECRET` | Unchanged |
| Revocation | None | `revokedAt` is set on logout, on member removal (all of that user's sessions), and implicitly by `User.deletedAt` |
| Logout | Cleared the cookie only; a copied token kept working | Cookie cleared **and** the session row revoked, so a copied token dies immediately |
| Stolen cookie | Valid while in use, indefinitely | Valid at most 12h. Can be killed by logout, member removal or user deletion |
| Where it's checked | API: token + DB membership. Pages: token only | API and pages: token → `AuthSession` (active, same user, user not deleted) → `WorkspaceMember` |
| Fixation | Auth.js issues a new token at sign-in | Plus a new random `sid` (32 bytes, `crypto.randomBytes`) per sign-in |

## 6. Cookie security

See `docs/security/COOKIE-POLICY.md` for the per-cookie table. Summary: every cookie is set by Auth.js, and all are `HttpOnly`, `SameSite=Lax`, `Path=/`, with no `Domain`. The session cookie is now named `__Host-synas_session` in production (`Secure` is required by the prefix) and `synas_session` in development. Nothing sensitive lives in `localStorage`/`sessionStorage` (the app doesn't use them), and no credential ever appears in a URL.

## 7. API security

See `docs/security/API-AUTHORIZATION-MATRIX.md`. Every non-public route follows authenticate → DB membership + role/permission → workspace-scoped query → Zod validation → rate limit (mutations, search, exports, AI, WhatsApp).

## 8. Workspace isolation

- **Ownership:** a `workspaceId` column on every CRM row.
- **Current workspace:** derived from the authenticated session and confirmed against a `WorkspaceMember` row. It's never taken from the request. `requireWorkspaceAccess(explicit)` returns 403 when a different id is supplied.
- **Reads/updates/deletes:** `findFirst`/`updateMany`/`count` always include `{ id, workspaceId }`. A miss returns 404, so the resource's existence in another tenant isn't confirmed.
- **Inserts:** `workspaceId` comes from the session. The Zod schemas don't accept it (stripped).
- **Relations:** `assertRelationsInWorkspace` checks every client-supplied FK (lead, account, contact, property, opportunity, task, proposal, stage, calendar event, owner/agent membership) before a write.
- **Forged fields:** `userId`, `workspaceId`, `role`, `membershipId` and permission fields in the body are ignored (tested in `tests/security/api-hardening.test.ts`).
- **Gap found:** RSC pages used the JWT `workspaceId` without a membership check (F-01).

## 9. Secrets

A pattern scan of every tracked file and the full git history (OpenAI/AWS/GitHub/Slack/Google/Meta token formats, private keys, `postgres://user:pass@` URLs, `AUTH_SECRET=` values) **found no credentials**. Seeds and e2e scripts read passwords from the environment and never print them. The only hardcoded password is a unit-test fixture hashed in memory. `.env` is gitignored. `.env.example` was *also* gitignored by the `.env*` pattern, so the template never reached the repo (F-13).

## 10. Backups & storage

- **Object storage / uploads:** none. `Attachment.fileUrl` and `Proposal.attachmentUrl` store URLs only, with no upload endpoint. No signed-URL system exists.
- **CSV export:** streamed in the response (500-row cap), never written to disk or storage. It is now audit-logged (F-07).
- **Temp files:** none written by the app.
- **Database backups:** Railway managed Postgres. Frequency, retention, encryption and access control **cannot be verified from code** (INFRA-3/4). `DISASTER_RECOVERY.md` covers the restore drill.
- **Local backup copy:** `synas-production-before-migration.dump` (custom-format `pg_dump`, unencrypted) is in the working tree (F-04).

## 11. Logging

- **Never logged (verified):** passwords, session tokens, JWTs, provider tokens, API keys, `DATABASE_URL`. The Prisma query hook records only the SQL verb and duration, never parameters.
- **Logged:** failed-login reason plus the attempted email (forensic, PII); request ids; 401/403/429 messages.
- **Unhandled errors** used to log the full `error.message`. Prisma validation messages can echo input values (PII), so only the first line is logged now (F-11).
- **Audit events:** login, logout (new), CSV import, CSV export (new), member role change / removal (now with the revoked-session count), branding, CRM mutations, AI review, automations, handoffs.
- **Access control:** `AuditLog` is readable only with `audit:read`, and no API writes to or deletes from it. It *is* mutable by the application DB role and cascades on workspace delete (F-18).

## 12. Attack surface

| Surface | Exposure | Controls |
|---|---|---|
| `/login`, `/api/auth/*` | Public | Auth.js CSRF double-submit token; login rate limits per IP+email, per email, per IP (F-03) |
| `/api/health` | Public | Returns only status, DB up/down and latency |
| `/api/webhooks/whatsapp` | Public | HMAC-SHA256 (`X-Hub-Signature-256`, timing-safe), phone-number→workspace mapping, per-IP rate limit, idempotency on external id, body-size cap (new) |
| Every other `/api/*` | Authenticated | Session + DB membership + permission + workspace scope + Zod + rate limit, same-origin check on mutations (new), `Cache-Control: no-store` (new) |
| RSC pages | Authenticated | Proxy redirect + `requireAppAccess()` per page (new) |
| Demo endpoints | Authenticated + `DEMO_MODE=true` | Fail closed when the env var isn't exactly `"true"` |

---

## 13. Findings

Severity: P0 immediate blocker · P1 high risk · P2 medium hardening · P3 low · INFO observation.

### F-01 — P1 — Pages authorize from the JWT alone (no membership / revocation check)
- **Location:** `src/app/(app)/*/page.tsx` (16 pages used `auth()` + `session.user.workspaceId`). Only `src/app/(app)/layout.tsx` called `requireAppAccess()`.
- **Problem:** In the App Router, layouts render in parallel with pages and aren't re-run on client-side navigation (Next docs, *Authentication → Layouts and auth checks*). The pages trusted the token's `workspaceId`.
- **Attack scenario:** An agent is removed from the workspace (or soft-deleted). Their existing cookie is still a valid JWE for up to 8h and keeps renewing while used. They keep opening `/leads`, `/contacts/[id]`, `/whatsapp` etc. and read customer PII. The API would refuse them, but the pages render the data server-side.
- **Impact:** A removed user keeps confidential and PII read access. Revocation doesn't work for the UI.
- **Remediation:** Every page now calls `requireAppAccess()` (a React-`cache`d DAL: active session → membership → workspace not deleted) and uses its `workspaceId`/`userId`.
- **Status:** **Fixed.**

### F-02 — P1 — No server-side session revocation
- **Location:** `src/lib/auth.ts` (`strategy: "jwt"`, no session store).
- **Problem:** Logout only deleted the cookie. A copied token stayed valid. The rolling `updateAge` gave active sessions no absolute lifetime. `User.deletedAt` was checked only at login.
- **Attack scenario:** A session cookie leaks (shared machine, malware, a proxy log). The user clicks "Sign out". The attacker's copy keeps working, indefinitely while in use.
- **Impact:** Account takeover persists past logout, removal and deletion.
- **Remediation:** Added an `AuthSession` table (`id` = 32 random bytes, `userId`, `createdAt`, `expiresAt` = +12h, `revokedAt`). A row is created at sign-in and its id goes into the JWE as `sid`. `getActiveSession()` rejects missing, expired, revoked, wrong-user or deleted-user sessions and is used by both `requireSession()` (API) and `requireAppAccess()` (pages). Sign-out revokes the row. Member removal revokes all of that user's sessions. Tokens issued before this change have no `sid` and are rejected, which forces a single re-login.
- **Status:** **Fixed.** (Rationale for keeping JWE rather than an opaque cookie: see §16 R-01.)

### F-03 — P1 — Login rate limit trivially bypassable
- **Location:** `src/app/api/auth/[...nextauth]/route.ts`, `src/lib/security/request.ts`.
- **Problem:** The only bucket was `ip + email`, and the IP was the **leftmost** `X-Forwarded-For` entry, which the client sets. There was no per-account bucket (credential stuffing across IPs) and no per-IP bucket (password spraying across emails). The check also matched only `/callback/credentials` or paths ending in `/signin`.
- **Attack scenario:** An attacker sends `X-Forwarded-For: <random>` with each guess and gets unlimited password attempts against any account.
- **Impact:** Brute force, credential stuffing and password spraying.
- **Remediation:** `clientIp()` now prefers `X-Real-IP` (set by the Railway edge, per Railway docs), then the **rightmost** `X-Forwarded-For` hop. Three independent buckets: `ip+email` 5/15min, `email` 10/15min (any IP), `ip` 30/15min (any email). Any POST under `/api/auth/signin*` or `/api/auth/callback*` is limited. 429 responses carry `Retry-After` and no internal key names.
- **Status:** **Fixed** (see INFRA-9 for verifying edge header behaviour).

### F-04 — P1 — Unencrypted production database dump in the working tree
- **Location:** `./synas-production-before-migration.dump` (≈127 KB, PostgreSQL custom format, created 2026-09-22).
- **Problem:** A full plaintext copy of production (customer PII, conversations, bcrypt password hashes) on a developer workstation. It's gitignored (`*.dump`) and not in git history, but it's exposed to laptop loss, sync tools, backups and malware.
- **Attack scenario:** The laptop or a cloud-synced folder is compromised. The attacker restores the dump and has every customer record, plus password hashes to crack offline.
- **Impact:** Full confidential and PII disclosure outside every application control.
- **Remediation:** Not deleted automatically (rule: no deletion of production data). **Operator action:** if the dump is still needed, move it into encrypted storage (e.g. `age`/`gpg` encrypted, access-restricted); otherwise securely delete it. Treat it like a production backup under the §17 policy.
- **Status:** **Open — operator confirmation required.** As of 2026-09-27 the file is no longer in the working tree and was never committed. Its disposition (encrypted storage vs secure deletion) must be confirmed by the operator. See `PRODUCTION-READINESS-CHECKLIST.md`.

### F-05 — P2 — CSRF relies on SameSite alone for app APIs
- **Location:** all state-changing `/api/*` routes.
- **Problem:** Cookie-authenticated JSON APIs had no Origin check. `SameSite=Lax` blocks classic cross-site form posts, but a *same-site* sibling origin (e.g. `evil.example.com` next to `crm.example.com` on a custom domain) is not blocked, and `request.json()` also parses a `text/plain` form body.
- **Attack scenario:** An attacker controls or XSSes a sibling subdomain. A form auto-posts `enctype=text/plain` JSON to `/api/leads/<id>` with DELETE semantics through method-capable fetches, and the browser attaches the Lax cookie because the request is same-site.
- **Impact:** Unauthorized mutations as the victim.
- **Remediation:** `src/proxy.ts` rejects `/api/*` mutations (POST/PUT/PATCH/DELETE) with 403 when the `Origin` host differs from the request host, or when `Sec-Fetch-Site: cross-site` is present. The Auth.js endpoints keep their own CSRF token. The Meta webhook is exempt (HMAC-authenticated, server-to-server).
- **Status:** **Fixed.**

### F-06 — P2 — No request-size or field-length limits
- **Location:** all `request.json()` routes, Zod schemas, `/api/search`, list `q` params, webhook.
- **Problem:** No body cap. No string `.max()` (notes, names, message bodies unbounded). Search terms unbounded (expensive `ILIKE` across 8 tables).
- **Attack scenario:** An authenticated user (or a flood against the webhook, before HMAC) posts 50 MB bodies or 1 MB search strings. The result is memory pressure, DB CPU load and table bloat.
- **Impact:** Availability, storage abuse.
- **Remediation:** The proxy rejects `/api/*` requests whose `Content-Length` exceeds 1 MB (2 MB for CSV import), and `experimental.proxyClientMaxBodySize` bounds chunked bodies. `parseBody()` rejects any string field over 10,000 characters. List `q` is capped at 200 characters and `/api/search` `q` at 100.
- **Status:** **Fixed.** (Per-field semantic limits, e.g. names ≤ 200, would be a further P3 refinement.)

### F-07 — P2 — Bulk PII export and logout not audited
- **Location:** `GET /api/leads/csv`, Auth.js sign-out.
- **Problem:** Exporting up to 500 leads with phone, email and notes left no audit trail. Logout wasn't recorded.
- **Impact:** A data-exfiltration event would be invisible to the workspace owner.
- **Remediation:** New `AuditAction` values `CSV_EXPORTED` (with row count) and `USER_LOGOUT`. Both are written.
- **Status:** **Fixed.**

### F-08 — P2 — CSP allows `'unsafe-eval'` in production
- **Location:** `src/lib/security/headers.ts`.
- **Problem:** `'unsafe-eval'` is needed only by the Next dev server (React Refresh) but was sent in production. `'unsafe-inline'` scripts are also allowed.
- **Impact:** Any injected script would face weaker CSP containment.
- **Remediation:** `'unsafe-eval'` is now sent only when `NODE_ENV=development`. `'unsafe-inline'` remains because Next's inline hydration scripts need it without a nonce pipeline (R-03).
- **Status:** **Partially fixed.**

### F-09 — P2 — Sensitive API responses cacheable
- **Location:** `/api/*` responses (no `Cache-Control`).
- **Problem:** JSON with PII could be stored by an intermediary or the browser's disk cache.
- **Remediation:** The proxy sets `Cache-Control: no-store` on every `/api/*` response.
- **Status:** **Fixed.**

### F-10 — P3 — Login timing reveals whether an email exists
- **Location:** `verifyLoginCredentials` (`src/lib/auth.ts`).
- **Problem:** Unknown emails returned before the ~100 ms bcrypt compare.
- **Remediation:** Unknown or deleted users are compared against a fixed dummy hash, so both paths cost one bcrypt verification.
- **Status:** **Fixed.**

### F-11 — P3 — Unhandled-error logs may contain PII
- **Location:** `jsonError` (`src/lib/api.ts`).
- **Problem:** Full Prisma error messages can include invocation arguments (emails, phones).
- **Remediation:** Only the first line of the message is logged, truncated to 300 characters.
- **Status:** **Fixed.**

### F-12 — P3 — Unvalidated enum filters produce 500s
- **Location:** `GET /api/audit?action=…`, `/api/automations/executions?status=…`, `/api/intelligence?kind=…` (`as never` casts).
- **Problem:** An invalid value reaches Prisma and returns 500. No data leaks, but it's noisy and inconsistent.
- **Remediation:** The audit route now validates `action` against the `AuditAction` enum (400). Malformed JSON bodies now return 400 instead of 500. The executions and intelligence filters are still open (low impact).
- **Status:** **Partially fixed.**

### F-13 — P3 — `.env.example` not tracked; undocumented secrets
- **Location:** `.gitignore` (`.env*`).
- **Problem:** The template never reached the repo. `OPENAI_API_KEY`, `OPENAI_MODEL` and `GOOGLE_REFRESH_TOKEN` are read by code but not documented.
- **Remediation:** Added `!.env.example` to `.gitignore` and documented the missing variables (names only).
- **Status:** **Fixed** (the file still has to be committed by a maintainer).

### F-14 — P3 — Deprecated `middleware.ts`
- **Location:** `src/middleware.ts`.
- **Problem:** Next 16 renamed Middleware to Proxy. The deprecated convention is the route-protection layer.
- **Remediation:** Moved to `src/proxy.ts` (same matcher, Node runtime by default).
- **Status:** **Fixed.**

### F-15 — P3 — Owner reassignment not gated consistently
- **Location:** `PATCH /api/opportunities/:id`, `/api/tasks/:id`, `/api/properties/:id`, `/api/accounts/:id` (`ownerId`, `assignedAgentId`).
- **Problem:** Leads require `leads:assign` to change owner. Other entities let any `crm:write` role reassign ownership within the workspace. It stays within the tenant (the owner must be a member), so it's a role-policy gap, not isolation.
- **Remediation (recommended):** apply the same `leads:assign` check, if product agrees agents shouldn't reassign.
- **Status:** **Open** (product decision).

### F-16 — P3 — Webhook verify token compared with `===`
- **Location:** `GET /api/webhooks/whatsapp`.
- **Problem:** Not a constant-time comparison. Exploitation over the network is impractical, and the token only allows Meta's subscription handshake.
- **Status:** **Open** (low value).

### F-17 — P3 — bcrypt cost 10
- **Location:** seeds and `scripts/perf-http.ts`.
- **Recommendation:** cost 12 for new hashes. Existing hashes keep working.
- **Status:** **Open.**

### F-18 — INFO — Audit log mutable at the DB layer
- **Problem:** The app DB role can `UPDATE`/`DELETE` `"AuditLog"`, and a workspace delete cascades to its audit rows. No API path does either.
- **Recommendation:** INFRA-5 (`REVOKE UPDATE, DELETE ON "AuditLog" FROM <app_role>`). Consider exporting security events to an append-only sink.

### F-19 — INFO — No retention jobs
- **Problem:** `RateLimitBucket`, `WebhookEvent`, expired `AuthSession` rows and soft-deleted CRM rows grow forever.
- **Recommendation:** add a scheduled purge (e.g. buckets > 1 day, sessions expired > 30 days, soft-deleted PII after the retention period the business defines).

### F-20 — INFO — Data minimisation
- **Problem:** `User.phone` and `User.image` are never set or read. Soft-deleted leads and contacts keep full PII indefinitely.
- **Recommendation:** drop the unused columns in a future migration, and define a hard-delete / anonymise policy for soft-deleted PII.

### F-21 — INFO — Cross-tenant FK integrity is app-enforced only
- **Recommendation:** composite `(workspaceId, id)` unique keys and composite FKs, or PostgreSQL Row-Level Security keyed on a per-transaction `app.workspace_id`, as a second layer. This is a large migration and was not performed.

### F-22 — INFO — Verified-safe areas
- **SQL injection:** only parameterized tagged-template raw SQL. `orderBy` is allow-listed.
- **Mass assignment:** Zod strips unknown keys. Tests exist.
- **XSS:** no `dangerouslySetInnerHTML` outside a dev-only static script. No markdown/HTML rendering. URL fields (`website`, `logoUrl`, `attachmentUrl`) are rendered as text, never as `href`/`src`. Notification links are server-generated paths.
- **Open redirect:** the login form always pushes `/dashboard`. Auth.js restricts `callbackUrl` to same-origin by default.
- **CSV formula injection:** `escapeCsvCell` neutralises `= + - @ \t \r` prefixes.

---

## 14. Remediations completed

| Finding | Change | Files |
|---|---|---|
| F-01 | Every page gates on `requireAppAccess()` (React-`cache`d DAL) and uses its `workspaceId`/`userId` | `src/lib/app-access.ts`, 17 × `src/app/(app)/**/page.tsx` |
| F-02 | `AuthSession` table; random `sid` per sign-in; `getActiveSession()` enforced for API and pages; sign-out revokes; member removal revokes all of the user's sessions; 12h absolute cap; deleted users rejected | `prisma/schema.prisma`, `prisma/migrations/20260927000000_auth_sessions/`, `src/lib/auth.ts`, `src/lib/api.ts`, `src/types/next-auth.d.ts`, `src/app/api/workspace/members/[userId]/route.ts` |
| F-03 | Trusted client IP (`X-Real-IP`, then rightmost XFF); three login buckets; all signin/callback POSTs limited | `src/lib/security/request.ts`, `src/lib/rate-limit.ts`, `src/app/api/auth/[...nextauth]/route.ts` |
| F-05 | Same-origin check for `/api/*` mutations | `src/lib/security/request-guards.ts`, `src/proxy.ts` |
| F-06 | 1 MB body cap (2 MB CSV), `proxyClientMaxBodySize`, 10k-char field backstop, `q`/`sort` caps | `src/proxy.ts`, `next.config.ts`, `src/lib/validations/common.ts`, `src/app/api/search/route.ts` |
| F-07 | `CSV_EXPORTED`, `USER_LOGOUT` audit events | schema, migration, `src/app/api/leads/csv/route.ts`, `src/lib/auth.ts` |
| F-08 | `'unsafe-eval'` dev-only | `src/lib/security/headers.ts` |
| F-09 | `Cache-Control: no-store` on `/api/*` | `src/proxy.ts` |
| F-10 | Dummy bcrypt compare for unknown or deleted users | `src/lib/auth.ts` |
| F-11 | First-line-only error logging. Malformed JSON bodies now return 400 instead of 500 | `src/lib/api.ts` |
| F-12 | Audit `action` filter enum-validated | `src/app/api/audit/route.ts` |
| F-13 | `!.env.example` in `.gitignore`. Documented `OPENAI_API_KEY`, `OPENAI_MODEL`, `GOOGLE_REFRESH_TOKEN` | `.gitignore`, `.env.example` |
| F-14 | `middleware.ts` → `proxy.ts` | `src/proxy.ts` |
| Tests | Updated the WhatsApp inbox contract test to assert the DAL call instead of the JWT claim | `tests/security/inbox-contracts.test.ts` |

**Schema change:** additive only. It adds the `AuthSession` table (FK → `User`, cascade) and the `AuditAction` values `USER_LOGOUT` and `CSV_EXPORTED`. No existing column, row or constraint is altered. It was applied to the local database with `prisma migrate deploy`.

**Deploy impact:** every existing session is invalidated once. Old tokens have no `sid`, and the cookie name changed, so all users sign in again after deploy.

**Verification (2026-09-27):**
- `npm test`: 229/229 pass (24 new tests in `tests/security/session-hardening.test.ts`).
- `tsc --noEmit`: clean. `eslint`: clean. `next build`: succeeds (Proxy registered).
- Live HTTP attack harness against the dev server: 49/49 pass (see the API matrix).
- Not performed: an interactive browser/mobile-viewport session. No browser automation was available in this environment. Login, logout, session persistence, protected routes and cookie attributes were exercised over HTTP instead.

## 15. Production infrastructure requirements (cannot be verified from code)

| ID | Requirement | How to verify |
|---|---|---|
| INFRA-1 | **Database network exposure:** Postgres reachable only on Railway's private network. No public TCP proxy, or if one exists, IP-restricted and TLS-only. | Railway → Postgres service → Networking: no TCP proxy / public domain. The app's `DATABASE_URL` uses the `*.railway.internal` host. |
| INFRA-2 | **Encryption at rest** for the database volume and backups. | Railway documentation / support confirmation for the plan in use. Record the answer here. |
| INFRA-3 | **Backups enabled**, frequency ≥ daily, retention ≥ 7–30 days. | Railway → Postgres → Backups tab. |
| INFRA-4 | **Restore tested** against *production* backups (the DR drill so far only ran against dev). | Run `DISASTER_RECOVERY.md` §1 against production into a scratch DB. Record date and row counts. |
| INFRA-5 | **Least-privilege DB role:** the app connects as a non-superuser that owns no roles, has no `CREATEDB`/`CREATEROLE`, has DML on app tables only, and has no `UPDATE`/`DELETE` on `"AuditLog"`. Migrations run as a separate owner role. | `SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user;` → all `false`. Railway's default `postgres` user **is** a superuser, so a dedicated app role must be created. |
| INFRA-6 | **Secrets** held only in Railway variables (or a secret manager). Access restricted to maintainers. `AUTH_SECRET` ≥ 32 random bytes and unique per environment. | Railway → Variables. Rotate `AUTH_SECRET` if it was ever shared (this logs everyone out; with this change `AuthSession` rows can also be bulk-revoked). |
| INFRA-7 | **TLS to the database** where the connection leaves the private network. | If a public URL is ever used: `?sslmode=require` on `DATABASE_URL`. |
| INFRA-8 | **Production HTTPS** on every domain. HSTS is emitted when `NODE_ENV=production`. Don't set `DISABLE_HSTS`. | `curl -sI https://<domain>` shows `strict-transport-security`. Confirm `AUTH_URL`/`NEXTAUTH_URL` use `https://`. |
| INFRA-9 | **Client-IP header trust:** confirm the Railway edge *overwrites* (does not pass through) a client-supplied `X-Real-IP`. | Send a request with `X-Real-IP: 1.2.3.4` and log `clientIp()` output on a staging deploy. If it passes through, set the trusted source accordingly. |
| INFRA-10 | **Railway access:** MFA on every Railway/GitHub account with deploy rights. Least team membership. | Railway team settings. |
| INFRA-11 | **Rate limiter backend:** multi-replica deploys need Upstash or the shared Postgres bucket (the default). In-memory fallback only runs in demo/test. | `DEMO_MODE` unset/`false` in production. |
| INFRA-12 | `DEMO_MODE` unset in production. `DEMO_SEED_PASSWORD`/`UX_AUDIT_PASSWORD` not present in production variables. | Railway → Variables. |

## 16. Remaining risks

- **R-01:** The session cookie is an encrypted JWE (user id, workspace id, role, email, name, `sid`), not a bare random id. It's opaque to the browser and can't be forged without `AUTH_SECRET`, and every request is re-validated against `AuthSession`. A pure opaque-id cookie would mean replacing Auth.js session handling, because the Credentials provider does not support the database session strategy. We don't recommend that.
- **R-02:** A 12h absolute session means a stolen cookie is usable for up to 12h unless a revocation event occurs. Users can't yet "sign out all devices" themselves.
- **R-03:** *(superseded by Batch 5)* scripts now require a per-request nonce; `style-src` still allows `'unsafe-inline'`.
- **R-04:** No MFA for CRM users.
- **R-05:** Per-email login limiting enables a mild lockout DoS (10 attempts / 15 min per email).
- **R-06:** F-04, F-15, F-16, F-17, F-19, F-20, F-21 are open as described.

## 17. Backup & recovery policy (production)

1. **Encrypted backups:** Railway-managed snapshots (INFRA-2/3). Any manual `pg_dump` is encrypted immediately (`age -r <recipient>` or `gpg -c`), never stored in a repo or synced folder, and deleted when its purpose ends.
2. **Access:** only the named maintainers (≤ 2) can download or restore backups. Record each download.
3. **Frequency:** daily snapshots minimum (RPO 24h, per `DISASTER_RECOVERY.md`). Take an extra snapshot before every migration deploy.
4. **Retention:** 30 days of daily snapshots. Pre-migration snapshots kept 90 days, then destroyed.
5. **Restore testing:** quarterly, and before go-live: restore into a scratch database, run `/api/health`, and compare row counts for `Lead`, `Contact`, `WhatsAppMessage`, `AuditLog`. Record the result in `DISASTER_RECOVERY.md`.
6. **Disaster recovery:** restore to a *new* database, verify, then switch `DATABASE_URL` (runbook in `DISASTER_RECOVERY.md` §2). After a suspected breach, also rotate `AUTH_SECRET`, bulk-revoke `AuthSession`, and rotate provider tokens.
