# Production Readiness Checklist

Release: security hardening (AuthSession revocation, proxy guards, login rate limits). Verified locally on 2026-09-27.
Source audit: `docs/security/DATABASE-SESSION-SECURITY-AUDIT.md`. Nothing here has been deployed. No production system was accessed.

**Release status: NOT CLEARED.** The application checks pass. Every infrastructure item (INFRA-1 to INFRA-12) is still unverified, and the operator actions below are still open.

## Application Verification

| Check | Command | Result |
|---|---|---|
| Tests | `npm test` | **229/229 pass** (59 suites, 0 fail, 0 skipped) |
| Typecheck | `npm run typecheck` | **Pass** (exit 0) |
| Lint | `npm run lint` | **Pass** (exit 0, no warnings) |
| Build | `next build` | **Pass**. Proxy registered. `npm run build` also runs `prisma generate` first; that step was not re-run here, but the generated client is current (typecheck passes against `AuthSession`) |
| Security tests | `tests/security/*` (part of `npm test`) | **Pass**, including the 24 checks in `session-hardening.test.ts` |
| Live attack harness: dev (`next dev`, :3001) | HTTP harness, throwaway workspaces | **50/50 pass** |
| Live attack harness: production build (`next start`, `NODE_ENV=production`, `DEMO_MODE=false`, :3002) | Same harness plus production assertions | **54/54 pass**: `__Host-synas_session` with HttpOnly, Secure, SameSite=Lax, Path=/ and no Domain; CSP without `unsafe-eval`; HSTS sent; no forced HTTPS redirect on local HTTP; `no-store` on `/api/*`; login, logout, revocation, member removal, expiry, IDOR, CSRF, XSS, SQLi, rate limits |
| Browser QA | — | **Interactive browser/mobile QA not performed because browser automation is unavailable.** Login, logout, protected routes, session revocation and cookie attributes were verified over HTTP only. |

## Deployment Configuration

| Item | Evidence in repo | State |
|---|---|---|
| Railway startup | `railway.json` → `deploy.startCommand: "npx prisma migrate deploy && npx next start"` | Correct. Migrations apply before the app starts. If a migration fails, `&&` prevents the new app from starting |
| Build | Railpack builder, `package.json` `build: "prisma generate && next build"` | Config consistent. The actual Railway build command Railpack detects is **not verified** from the repo |
| Prisma migration | `prisma` and `@prisma/client` 6.19 are in `dependencies`, so `npx prisma` is available at runtime. 5 migrations; local DB up to date, no drift | Correct |
| New migration `20260927000000_auth_sessions` | `CREATE TABLE "AuthSession"`, index on `userId`, FK → `User(id)` `ON DELETE CASCADE`, `ADD VALUE IF NOT EXISTS` ×2 on `AuditAction` | Additive only: no drop, rename, truncate or alteration of existing columns. Uses the same enum pattern as the already-deployed `add_manager_role` migration. Applied locally only |
| Health endpoint | `healthcheckPath: "/api/health"`. Public in `src/proxy.ts`. Returns 200 `{"status":"ok"}` or 503 when the DB is unreachable | Verified locally in dev and in the production build |
| Production environment | `next start` sets `NODE_ENV=production`, which switches on the `__Host-` cookie, HSTS and a CSP without `unsafe-eval` | Verified locally. Production variable values are **not verified** (INFRA-6, INFRA-12) |

## Infrastructure Verification

None of these can be proven from the repository. All are **NOT VERIFIED**.

| ID | What must be verified | Where | Expected secure state | Status |
|---|---|---|---|---|
| INFRA-1 | Database network exposure | Railway → Postgres service → Networking. App `DATABASE_URL` host | No public TCP proxy (or IP-restricted + TLS). App connects via `*.railway.internal` | NOT VERIFIED |
| INFRA-2 | Encryption at rest (volume + backups) | Railway docs / support for the current plan | Encrypted at rest; answer recorded in the audit doc | NOT VERIFIED |
| INFRA-3 | Backups enabled, retention | Railway → Postgres → Backups | ≥ daily; ≥ 7–30 days retention; snapshot taken before this deploy | NOT VERIFIED |
| INFRA-4 | Production restore test | `DISASTER_RECOVERY.md` §1, run against a production backup into a scratch DB | Restore succeeds; `/api/health` ok; row counts match | NOT VERIFIED |
| INFRA-5 | Least-privilege app DB role | `SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user;` on production | App role is not superuser (all `false`). Separate role for migrations. No UPDATE/DELETE on `"AuditLog"` | NOT VERIFIED |
| INFRA-6 | Production secrets / `AUTH_SECRET` | Railway → Variables | Secrets only in Railway variables. `AUTH_SECRET` ≥ 32 random bytes, unique per environment. Access limited to maintainers | NOT VERIFIED |
| INFRA-7 | DB TLS where applicable | `DATABASE_URL` in Railway | Private network only; if a public URL is ever used, `sslmode=require` | NOT VERIFIED |
| INFRA-8 | Production HTTPS / HSTS | `curl -sI https://<prod-domain>`. Railway domain settings | HTTPS on every domain. `strict-transport-security` present. `AUTH_URL` uses `https://`. `DISABLE_HSTS` unset | NOT VERIFIED |
| INFRA-9 | Railway `X-Real-IP` trust | Staging deploy: send a request with a forged `X-Real-IP` and log `clientIp()` | Edge overwrites the client-supplied value (login rate limits depend on it) | NOT VERIFIED |
| INFRA-10 | Railway / GitHub MFA | Railway team settings; GitHub org/account security | MFA on every account with deploy or variable access. Minimal membership | NOT VERIFIED |
| INFRA-11 | Shared rate-limit backend | Railway variables / replica count | Postgres `RateLimitBucket` (default) or Upstash shared across replicas. No in-memory limiter in production | NOT VERIFIED |
| INFRA-12 | Demo mode off, demo credentials absent | Railway → Variables | `DEMO_MODE` unset or `false`. `DEMO_SEED_PASSWORD` and `UX_AUDIT_PASSWORD` not set in production | NOT VERIFIED |

## Local Operator Actions

### Production dump (audit F-04)

`synas-production-before-migration.dump` is **no longer present** in the working tree. A search of the repository found no `.dump` files, and none was ever committed (`*.dump` is gitignored). The repo can't show whether the file was securely deleted or moved, so **the operator must confirm its disposition**:

- **Option A: rollback copy still required.** Keep it only in approved encrypted backup storage, restrict access to named maintainers, and never place it in the repository or a synced development folder.
- **Option B: rollback copy no longer required.** Confirm it was securely deleted, including from any sync/backup copies and the recycle bin.

The decision belongs to the operator. Don't upload the dump anywhere, and don't commit it.

### Local `AUTH_URL` correction

- **Before:** local `.env` had `AUTH_URL` and `NEXTAUTH_URL` = `http://localhost:3000`. That port belongs to a different local project, and this CRM's dev server runs on :3001.
- **After:** both are set to `http://localhost:3001` in the local `.env` only. `.env` is still gitignored and not committed.
- **Verified with no command-line override:** protected-page redirect, sign-in redirect, successful login callback (→ `http://localhost:3001/dashboard`), failed login and sign-out all stay on `localhost:3001`.
- Production `AUTH_URL` is unaffected and must be the `https://` production origin (INFRA-8).

### Repository housekeeping (before merge)

- `.env.example` is no longer ignored (`!.env.example`) but is **untracked**. It needs `git add` in the release commit. It holds variable names and placeholders only.
- All hardening changes are uncommitted on `main` (see `git status`).

## Deployment Impact

- **Every existing session is invalidated once.** Tokens issued before this release carry no `sid` claim and the session cookie name changed (`__Host-synas_session`), so `getActiveSession()` rejects them.
- **All users must log in again** after deploy. Warn users before the deploy window.
- **The Prisma migration must run before the new application relies on `AuthSession`.** `railway.json` guarantees this: `prisma migrate deploy && next start`, and a failed migration stops the new app from starting. During a rolling deploy the old instance doesn't touch `AuthSession`, so the additive migration is safe while it's still serving.
- Take a database snapshot (INFRA-3) immediately before deploying.

## Remaining Non-Blocking Risks

These come from the security audit. None is a release blocker.

- R-01: Session cookie is an encrypted JWE (opaque to the browser, revalidated server-side), not a bare random id.
- R-02: A stolen cookie is usable for up to 12h unless revoked. There's no user-facing "sign out all devices".
- R-03: scripts now require a per-request nonce (Batch 5, SEC-010); `style-src` still allows `'unsafe-inline'` because React renders `style=""` attributes. Verified in headless Chrome by `npm run check:csp`; not yet observed in CI on GitHub.
- R-04: No MFA for CRM users.
- R-05: Per-email login limit allows a mild lockout DoS (10 attempts / 15 min).
- F-12 (partial): invalid `status`/`kind` filters on `/api/automations/executions` and `/api/intelligence` return 500.
- F-15: owner reassignment on opportunities/tasks/properties/accounts isn't gated by `leads:assign` (product decision).
- F-16: WhatsApp verify token compared with `===`.
- F-17: bcrypt cost 10 (12 recommended).
- F-18: `AuditLog` mutable at the DB-role level (see INFRA-5).
- F-19: no retention/purge jobs.
- F-20: unused `User.phone` and `User.image` columns; soft-deleted PII retained.
- F-21: cross-tenant FK integrity is enforced in app code only.
