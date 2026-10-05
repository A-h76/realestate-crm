# Lead-to-Sale CRM — Complete Product Remediation Master Plan

> **Historical record.** It describes the codebase as it was before the US-market conversion, so it still mentions the retired Pakistan market (PKR, MARLA/KANAL, Zameen, Roman Urdu). Those references are intentional context, not current behaviour.

**Audit date:** 2026-10-02
**Audited by:** Claude (5 parallel read-only research passes: security, data integrity, core workflow tracing, WhatsApp/automation, testing & release readiness), synthesized into this document.
**Scope:** Full repository at commit range ending `cf3895a`, including uncommitted working-tree changes shown in `git status` at audit time (notably: `middleware.ts` deleted / `src/proxy.ts` added, MANAGER role, `auth-sessions` migration).
**Rule followed throughout:** audit only — no application code, dependencies, or database state were modified. Build/lint/typecheck/tests were run read-only for verification.

---

## 1. Executive Summary

This codebase is in noticeably better shape than the audit brief assumed. There is **no confirmed P0 (active critical exposure)**. The things that look alarming in `git status` — `middleware.ts` deleted, `proxy.ts` added — are a correct, intentional Next.js 16 framework migration (`src/proxy.ts` reimplements the same auth gate, CORS/body-size guards, and security headers; verified no route lost protection).

The product's real gaps cluster in four places:
1. **One outdated dependency with a critical CVE** (Next.js, easily patched).
2. **A genuine data-integrity bug**: a sold/rented property's status is never updated when its linked Opportunity is won or lost (DATA-003) — a real double-booking risk.
3. **Missing automation infrastructure**: there is no scheduler/cron anywhere in the codebase, so "automated" inactive-lead follow-up only runs if a human happens to click a button (AUTO-002); automation rules themselves are hardcoded with no authoring UI (AUTO-001).
4. **Release-process gaps rather than code bugs**: no CI pipeline exists at all (OPS-001), there is no automated test proving cross-tenant data isolation despite this being a multi-tenant CRM (TEST-001), and the project's own disaster-recovery doc admits production Postgres backups have never been drill-tested (OPS-004).

Google Calendar "integration" performs zero real Google API calls (INTG-012) — it is a UI label over a local-only `CalendarEvent` table. This should be relabeled or implemented before it is described as a working integration to any customer.

Security fundamentals (auth/session lifecycle, RBAC, workspace tenant isolation at the API/query layer, webhook signature verification + replay protection, CSV formula-injection escaping, CSP/headers) were independently verified as solid. 234/234 automated tests pass; build, lint, and typecheck are all clean.

**Bottom line on production readiness:** not yet advisable for real customer data without completing Batch 1 below (the Next.js CVE patch, the property-status bug, confirming production backups, and adding the cross-tenant isolation test). After that, a **controlled pilot** is reasonable; **general availability** additionally needs the automation-scheduler and team-invite gaps closed.

---

## 2. Verified Current Architecture & Actual Product Capabilities

- **Stack:** Next.js 16 (App Router), Auth.js (Credentials provider only — no self-service signup), Prisma + PostgreSQL, deployed on Railway.
- **Multi-tenancy:** workspace-scoped via `workspaceId` on all tenant-owned models, enforced in application code (`src/lib/tenant.ts`, `src/lib/api.ts`) rather than via composite DB foreign keys. Verified consistently applied in every sampled route.
- **RBAC:** OWNER / ADMIN / MANAGER / AGENT / VIEWER roles (`src/lib/authz.ts`), with self-lockout and self-promotion guards.
- **Session security:** JWT + server-side `AuthSession` table (new `auth-sessions` migration) enabling real revocation on logout or member removal; 12h absolute cap, 8h rolling idle timeout; timing-safe login to prevent user-enumeration.
- **Core CRM:** Leads, Contacts, Accounts, Properties, Opportunities/Pipeline, Proposals, Tasks, Calendar/Site Visits, Activities, Audit Log — all CRUD paths traced and functioning against Postgres via Prisma.
- **Lead scoring & property matching:** real deterministic algorithms (`src/lib/scoring/score-lead.ts`, `src/lib/matching/properties.ts`), not stubs, used by 10+ call sites.
- **WhatsApp integration:** real Meta webhook signature verification (HMAC-SHA256, timing-safe) and real Graph API sender exist — but ship in **demo mode by default** (`DemoWhatsAppProvider`) until `WHATSAPP_BUSINESS_ENABLED=true` plus access token and phone number ID are set.
- **Requirement extraction / handoff detection:** deterministic Roman Urdu + English regex/keyword engines (not NLP/LLM) — genuinely functional for mixed-language input, but should not be marketed as "AI-powered extraction."
- **OpenAI usage:** a real, narrowly-scoped, cost-bounded (`max_tokens: 400`, 6s timeout) fallback used only when the deterministic engine finds nothing; off entirely unless `OPENAI_API_KEY` is set; never blocks or crashes the request path on failure.
- **Automation engine:** 9 hardcoded automation rules (trigger→conditions→actions), execution is fully synchronous within the HTTP request, no background job infrastructure, no scheduler — confirmed by grep, there is no cron package, `vercel.json`/scheduler config, or worker script anywhere in the repo.
- **Google Calendar "integration":** no real Google API calls anywhere in the codebase; purely a local DB-backed calendar labeled as if it syncs.
- **Health check:** real DB round-trip (`SELECT 1`), not a stub 200 — wired into Railway's deploy gate.
- **Demo mode:** fail-closed (`DEMO_MODE === "true"` exact match), gates reset/simulate endpoints, tested for no credential leakage into client bundles.

---

## 3. Audit Scope and Limitations

- Performed entirely via static code reading, grep/glob search, and non-destructive command execution (`npm run build/lint/typecheck/test`, `npx prisma migrate status`, `npm audit`) against a local dev database. No production system, credentials, or customer data was accessed.
- Existing repo docs (`docs/security/*.md`, `docs/product/*.md`) were read but **not trusted** — every claim in this report was independently re-verified against current code; where an existing doc was found accurate, that is noted explicitly (e.g., SEC-004 through SEC-009, DATA-009/010).
- Items requiring live production access, a running Meta/WhatsApp Business account, real Google OAuth credentials, or actual customer load are marked **UNVERIFIED** rather than assumed.
- E2E/browser tests (`e2e:*` scripts) and performance-audit scripts that require a live server were **not run** — out of scope for a read-only static audit; their absence of execution is itself noted as a gap where relevant (TEST section).
- No destructive commands, migrations, or database writes were performed.

---

## 4. Overall Readiness Assessment

| Dimension | Assessment | Evidence basis |
|---|---|---|
| Security fundamentals (authn/authz/tenancy/webhooks/CSRF/CSV) | **Solid** | Independently verified; see §7 |
| Dependency hygiene | **Needs immediate action** | 1 critical CVE (Next.js), confirmed via `npm audit` |
| Data integrity | **One real bug (P1), rest is defensive hardening** | Property-status bug confirmed by code trace; no cross-tenant data corruption found |
| Core workflow correctness | **Mostly solid, 2 P1 UX/metric gaps** | Dashboard metric divergence, no team-invite flow |
| WhatsApp/automation "real vs demo" | **Honestly engineered, but scheduler is entirely missing** | Confirmed via grep for cron/queue infra — none exists |
| Testing | **Green but has a real coverage hole** | 234/234 pass; zero tests prove tenant isolation |
| Release process | **Immature** | No CI pipeline exists at all; backups unverified against prod |

**Production-use verdict:** Not yet advisable for real customer data. Advisable for a **controlled pilot with synthetic/low-stakes data** once Batch 1 closes.

---

## 5. Complete Prioritized Findings Register

Legend: Priority P0 (critical/stop) · P1 (release blocker) · P2 (core product gap) · P3 (improvement) · P4 (future). Status: CONFIRMED / LIKELY / UNVERIFIED / NOT A DEFECT.

| ID | Title | Priority | Status | Batch |
|---|---|---|---|---|
| SEC-001 | Next.js critical RCE (GHSA-vcvr-r3jv-pc5j) in `next/og`, pinned 16.3.5 | P1 | CONFIRMED | 1 |
| SEC-002 | High-severity transitive deps via Prisma CLI (`deepmerge-ts`, `effect`) | P3 | CONFIRMED | 5 |
| SEC-003 | `clientIp()` trusts `X-Real-IP` without verified proxy-trust boundary | P2 | LIKELY | 2 |
| SEC-004 | `proxy.ts` correctly replaces `middleware.ts`, no protection regression | — | NOT A DEFECT | — |
| SEC-005 | RBAC / MANAGER role correctly scoped | — | NOT A DEFECT | — |
| SEC-006 | Workspace tenancy isolation at query layer (sampled routes) | — | NOT A DEFECT | — |
| SEC-007 | CSV formula-injection escaping present and correct | — | NOT A DEFECT | — |
| SEC-008 | WhatsApp webhook signature + replay protection | — | NOT A DEFECT | — |
| SEC-009 | Session lifecycle / auth hardening | — | NOT A DEFECT | — |
| SEC-010 | CSP allows `'unsafe-inline'` for scripts | P3 | CONFIRMED | 5 |
| SEC-011 | Duplicate CSV import retry double-fires automation side effects | P3 | CONFIRMED | 5 |
| DATA-001 | No duplicate-lead protection on manual/WhatsApp lead creation | P2 | CONFIRMED | 2 |
| DATA-002 | TOCTOU race in WhatsApp-inbound lead dedup (= INTG-002) | P2 | LIKELY | 2 |
| DATA-003 | `Property.status` never updated when linked Opportunity is Won/Lost | **P1** | CONFIRMED | 1 |
| DATA-004 | Opportunity stage-change pipeline not transactional | P2 | CONFIRMED | 2 |
| DATA-005 | Lead-conversion read-then-write not atomic | P3 | LIKELY | 5 |
| DATA-006 | No DB-level composite tenant FKs (app-layer isolation only) | P2 | CONFIRMED (known/tracked) | 2 |
| DATA-007 | Soft-delete not cascaded; stale parent data can surface via `include` | P3 | CONFIRMED | 2 |
| DATA-008 | Unbounded `findMany` queries in `insights.ts` | P3 | CONFIRMED (file) / UNVERIFIED (repo-wide) | 7 |
| DATA-009 | Migration safety review (all 5 migrations) | — | NOT A DEFECT | — |
| DATA-010 | Workspace-scoped IDOR spot-check at data layer | — | NOT A DEFECT (partial coverage) | — |
| INTG-001 | Webhook signature validation real and correct | — | NOT A DEFECT | — |
| INTG-002 | Dedup race on concurrent first-contact messages (= DATA-002) | P3 | CONFIRMED | 2 |
| INTG-003 | Requirement extraction is deterministic regex, not NLP/LLM (mislabel risk) | P3 | CONFIRMED | 4 |
| INTG-004 | OpenAI fallback real, bounded, last-resort only | — | NOT A DEFECT | — |
| INTG-005 | Lead/contact resolution by phone number, correct | — | NOT A DEFECT | — |
| INTG-006 | Conversation history preserved, explicitly bounded window | — | NOT A DEFECT | — |
| INTG-007 | Handoff flow real & idempotent; UI panel is read-only display only | P3 | CONFIRMED | 3 |
| INTG-008 | Demo WhatsApp provider ships by default; real Meta API behind 2 env vars | P2 | CONFIRMED | 4 |
| INTG-009 | No retry/backoff on outbound Graph API send | P3 | CONFIRMED | 4 |
| INTG-010 | Delivery/read/failed status handling real via Meta callbacks | — | NOT A DEFECT | — |
| INTG-011 | `simulate-inbound` demo endpoint bypasses real extraction/handoff pipeline | P3 | CONFIRMED | 3 |
| INTG-012 | Google Calendar "integration" makes zero real Google API calls | **P1** | CONFIRMED | 1 |
| AUTO-001 | Automation rules hardcoded in code; UI is pause/enable only | P2 | CONFIRMED | 2 |
| AUTO-002 | No scheduler/cron exists; inactive-lead automation only runs on demand | **P1** | CONFIRMED | 1 |
| AUTO-003 | `CREATE_TASK`/`NOTIFY` automation actions not idempotent on retry | P2 | CONFIRMED | 2 |
| AUTO-004 | Partial-failure handling isolated, no rollback, no silent success | — | NOT A DEFECT | — |
| AUTO-005 | Fully synchronous automation execution; no background job infra | P2 | CONFIRMED | 2 |
| CORE-001 | Dashboard page and `/api/dashboard` compute divergent metrics for the same figures | **P1** | CONFIRMED | 1 |
| CORE-002 | No way to invite/add a workspace member through the product UI | **P1** | CONFIRMED | 1 |
| CORE-003 | Backend routes with no UI entry point (`/api/scoring/history`, `/api/nba`, `/api/intelligence/review`, `/api/activities`) | P2 | CONFIRMED | 3 |
| CORE-004 | No `loading.tsx`/`error.tsx`/`not-found.tsx` anywhere in the app router | P2 | CONFIRMED | 3 |
| CORE-005 | Proposal "Accepted" has no real client-facing acceptance mechanism | P3 | NOT A DEFECT (self-documented, flagged for product visibility) | — |
| CORE-006 | `middleware.ts` → `proxy.ts` migration is a correct Next 16 rename, not a regression | — | NOT A DEFECT | — |
| TEST-001 | No automated test proves cross-tenant (workspace) data isolation | **P1** | CONFIRMED | 1 |
| TEST-002 | RBAC permission matrix tested in isolation, not enforced at HTTP boundary | P2 | CONFIRMED | 2 |
| TEST-003 | No unit tests for lead-scoring / property-matching algorithms | P2 | CONFIRMED | 5 |
| TEST-004 | No race-condition/concurrency tests; minimal `$transaction` usage | P2 | LIKELY | 2 |
| TEST-005 | `leakage.test.ts` is a trivial string-match test mislabeled as "security" | P4 | NOT A DEFECT (cosmetic) | 5 |
| OPS-001 | No CI pipeline exists at all | **P1** | CONFIRMED | 1 |
| OPS-002 | Two env vars used in code but undocumented in `.env.example` (`DISABLE_HSTS`, `PERF_HTTP_HEADERS`) | P3 | CONFIRMED | 5 |
| OPS-003 | No centralized runtime env validation (fails deep, not fast) | P3 | CONFIRMED | 5 |
| OPS-004 | Production Postgres backup existence/retention unverified (project's own docs admit this) | **P1** | UNVERIFIED | 1 |
| OPS-005 | No automated rollback mechanism; rollback is a manual runbook | P2 | CONFIRMED | 2 |

**Root-cause links:**
- DATA-002 and INTG-002 are the same underlying race — tracked once, fixed once.
- SEC-011 and AUTO-003 are the same underlying gap (automation actions aren't idempotent) seen from two angles (CSV retry vs. generic retry) — one fix (idempotency key per action execution) closes both.
- DATA-006 restates a gap already tracked in `docs/security/DATABASE-SESSION-SECURITY-AUDIT.md` (F-21); not a new discovery, listed for completeness of the data-integrity picture.

---

## 6. Release-Blocker Checklist

**1. Must fix before any real customer data is used:**
- [ ] SEC-001 — patch Next.js to ≥16.3.8
- [ ] DATA-003 — fix Property.status not updating on Opportunity Won/Lost
- [ ] OPS-004 — run the disaster-recovery restore drill against actual production Postgres and confirm backup retention
- [ ] TEST-001 — add an automated cross-tenant isolation test

**2. Must fix before a controlled pilot:**
- [ ] CORE-001 — reconcile dashboard vs `/api/dashboard` metric definitions
- [ ] CORE-002 — add a team member invite flow
- [ ] OPS-001 — stand up a CI pipeline (typecheck/lint/build/test on every PR)
- [ ] INTG-012 — relabel or remove "Google Calendar integration" claims until real, or implement it
- [ ] AUTO-002 — add a real scheduler so inactive-lead automation runs without a human clicking a button
- [ ] SEC-003 — confirm (and document) that `X-Real-IP` is trustworthy in the actual deployment topology, or stop trusting it unconditionally

**3. Must fix before general availability:**
- [ ] DATA-001/DATA-002 — lead dedup + race fix
- [ ] DATA-004 — transactional opportunity stage changes
- [ ] AUTO-001/AUTO-005 — decide and document automation's intended operating model (code-only vs. self-serve; sync vs. background)
- [ ] AUTO-003/SEC-011 — idempotent automation actions
- [ ] TEST-002/TEST-004 — RBAC-at-HTTP-boundary and concurrency test coverage
- [ ] CORE-003/CORE-004 — wire or remove dead endpoints; add route-level error/loading boundaries
- [ ] OPS-005 — exercise/script the rollback runbook at least once

**4. Can be deferred until after validation (customer feedback justifies the work):**
- INTG-007 (explicit claim/release handoff UI), INTG-009 (retry/backoff on WhatsApp send), INTG-011 (align simulate-inbound with real pipeline), TEST-003 (scoring/matching unit tests), SEC-010 (CSP nonce migration), OPS-002/OPS-003 (env docs/validation), DATA-007 (soft-delete cascade), DATA-005 (lead-conversion atomicity)

**5. Can wait until there is evidence of a scaling bottleneck:**
- DATA-008 (unbounded insights queries), SEC-002 (Prisma CLI transitive deps — major-version bump), AUTO-005's full background-queue migration beyond the minimum scheduler added in Batch 1

---

## 7. Data Integrity and Security Findings (Detail)

### DATA-003 — `Property.status` never updated on Opportunity Won/Lost (P1, CONFIRMED)
- **Files:** `src/app/api/opportunities/[id]/route.ts:35-121` (`applyStageChange`), `src/lib/leads/convert-on-won.ts`, `prisma/schema.prisma:477,579`.
- **Evidence:** on `stage.isWon`, only `convertLeadOnOpportunityWon` runs; no `prisma.property.update` call exists anywhere in the won/lost code path (confirmed by repo-wide grep).
- **Expected vs actual:** Expected — Won moves `Property.status` to `SOLD`/`RESERVED`; Lost/reopened reverts it to `AVAILABLE`. Actual — status never changes from either direction.
- **Impact:** A sold or rented property can continue to be shown as available and matched/pitched to other leads, or double-booked across concurrent opportunities.
- **Fix direction:** in `applyStageChange`, when `stage.isWon`/`stage.isLost` and `linkedPropertyId` is set, update `Property.status` in the same transaction as the stage write.
- **Acceptance criteria:** moving an opportunity with a linked property to a Won stage sets the property to unavailable; moving it to Lost (or reopening) restores availability; regression test added.
- **Regression tests required:** integration test covering Won, Lost, and reopen transitions against `Property.status`.
- **Effort:** M.

### CORE-001 — Dashboard vs `/api/dashboard` metric divergence (P1, CONFIRMED)
- **Files:** `src/app/(app)/dashboard/page.tsx:80-228`, `src/app/api/dashboard/route.ts:77-84,174-178,210`.
- **Evidence:** the dashboard page computes `wonThisMonth` from `stageEnteredAt >= monthStart`; the API route computes all-time `wonRevenue` with no date filter. Weighted-pipeline math also differs (`page.tsx` falls back to `stage.probability` when `o.probability` is unset; the API route does not).
- **Impact:** the Golden Path demo walkthrough (the only consumer of `/api/dashboard`) will show a different "Won revenue" figure than the dashboard itself for the same workspace once there's more than one month of history — undermining the Insights page's own claim that "every figure is database-derived."
- **Fix direction:** single source of truth — one aggregation function parameterized by date range, used by both the dashboard page and the API route.
- **Acceptance criteria:** dashboard and `/api/dashboard` return identical won-revenue and weighted-pipeline figures for the same workspace/time window.
- **Regression tests required:** unit test on the shared aggregation function; snapshot comparison between the two call sites.
- **Effort:** M.

### SEC-001 — Next.js critical RCE (P1, CONFIRMED)
- **File:** `package.json` (`next@16.3.5`). `npm audit --omit=dev` reports GHSA-vcvr-r3jv-pc5j (critical, RCE in `next/og` ImageResponse), fixed in 16.3.8.
- **Note:** the app does not call `next/og`/`ImageResponse` directly (grep returned 0 hits), which lowers but does not eliminate exposure since the vulnerable code ships inside the framework regardless.
- **Fix direction:** bump to `next@>=16.3.8` (patch release per the advisory, non-breaking).
- **Acceptance criteria:** `npm audit` reports 0 critical vulnerabilities; build/test suite stays green.
- **Effort:** S.

### AUTO-002 — No scheduler/cron (P1, CONFIRMED)
- **Files:** `src/lib/automation/engine.ts:510-540` (`evaluateInactiveLeads`), `src/app/api/automations/route.ts:53-61` (its only caller, repo-wide).
- **Evidence:** no cron package, `vercel.json`/Railway cron config, or worker script exists anywhere (grep across `src`, `package.json` scripts).
- **Impact:** inactive-lead re-engagement — a feature central to the "automated lead-to-sale" value proposition — never fires unless a logged-in user happens to trigger the automations endpoint.
- **Fix direction:** add a real scheduled job (Railway cron service or equivalent) invoking `evaluateInactiveLeads` per workspace on an interval.
- **Acceptance criteria:** inactive leads receive the configured follow-up action without any user interaction, verified over a simulated time window in a test environment.
- **Effort:** M.

### INTG-012 — Google Calendar is a placeholder (P1, CONFIRMED)
- **File:** `src/lib/providers/calendar/google.ts` — every method only reads/writes the local `CalendarEvent` table; `syncMeta()` checks for the *presence* of OAuth env vars and emits a cosmetic "configured" label without ever calling Google's API.
- **Impact:** any claim that the product "syncs with Google Calendar" is false as shipped; this is the one outright false-advertising risk surfaced by the audit.
- **Fix direction:** either relabel this as an internal calendar (remove Google-specific naming/env scaffolding) until a real OAuth + Calendar API client is built, or build the real integration.
- **Effort:** S (relabel) / L (real implementation).

### TEST-001 — No cross-tenant isolation test (P1, CONFIRMED)
- **Evidence:** grep across all of `tests/security/*.ts` for "other workspace"/"cross-tenant"/similar returns zero matches, despite every route correctly scoping queries by `workspaceId` in the code itself.
- **Fix direction:** seed two workspaces in a test, assert workspace A's session gets 403/404 against workspace B's lead/opportunity/contact/property via every relevant API route.
- **Acceptance criteria:** test fails if any route handler's `workspaceId` filter is ever accidentally removed.
- **Effort:** M.

### OPS-001 — No CI pipeline (P1, CONFIRMED)
- **Evidence:** no `.github/workflows/` directory exists. `npm run typecheck`, `lint`, `build`, and `test` all currently pass but are only run manually.
- **Fix direction:** add a workflow running `typecheck && lint && build && test` on every PR, plus a Prisma migration-diff/shadow-DB check.
- **Effort:** S.

### OPS-004 — Production backups unverified (P1, UNVERIFIED per the project's own docs)
- **Evidence:** `DISASTER_RECOVERY.md` explicitly states the restore drill was last run against **local dev only** (2026-09-22) and flags that this "proves the procedure works, not that production backups are enabled."
- **Fix direction:** run the documented restore drill against the actual Railway production database before any pilot goes live; confirm snapshot frequency/retention in the Railway dashboard.
- **Effort:** S (process action, not code).

---

## 8. Core Workflow Gap Analysis

| Workflow step | Classification |
|---|---|
| Customer inquiry / inbound capture | Simulated-or-demo-dependent (real dual-mode system, demo by default) |
| Lead creation | Fully implemented & verified |
| Requirement extraction | Fully implemented & verified (deterministic, not NLP) |
| Lead qualification | Fully implemented & verified |
| Property matching | Fully implemented & verified |
| Agent conversation (WhatsApp) | Implemented but demo-dependent |
| Follow-up / task | Fully implemented & verified |
| Site visit | Fully implemented & verified |
| Opportunity | Fully implemented & verified |
| Proposal | Implemented but partial — acceptance is self-documented as simulated, no real e-signature |
| Won/lost outcome | Fully implemented & verified, with the DATA-003/CORE-001 caveats above |

Team member management (invite flow) is the one full product area found **missing an entry point entirely** (CORE-002) — not partial, not simulated, simply absent from the UI and API.

---

## 9. Missing, Simulated, and Unverified Functionality

- **Simulated/demo-by-default:** WhatsApp send (until 2 env vars set), proposal client acceptance (always `acceptedVia: "demo_simulation"`), `simulate-inbound` endpoint (bypasses the real extraction/handoff pipeline — INTG-011).
- **Placeholder/no real backing:** Google Calendar integration (INTG-012).
- **Missing entirely:** team member invite flow (CORE-002), any scheduler/cron (AUTO-002), CI pipeline (OPS-001).
- **Built but unreachable from the UI:** `/api/scoring/history`, `/api/nba`, `/api/intelligence/review`, `/api/activities` (CORE-003).
- **Unverified (needs production/live access):** actual Railway edge `X-Real-IP` trust behavior (SEC-003), production Postgres backup retention (OPS-004), real-world WhatsApp/Meta delivery behavior at scale, real Google OAuth flow (since none exists to test).

---

## 10. Dependency-Aware Remediation Batches

### Batch 0 — Audit prerequisites (this document)
Complete. No code changes made. Findings registered above.

### Batch 1 — P0/P1 security, data integrity, release blockers
**Findings:** SEC-001, DATA-003, INTG-012 (relabel path), AUTO-002, CORE-001, CORE-002, TEST-001, OPS-001, OPS-004.
**Dependencies:** none block each other; can run in parallel across different engineers. OPS-001 (CI) should land first in practice so the rest of this batch is verified automatically as it merges.
**Expected outcome:** no critical dependency CVE, no property double-booking, no false integration claims, a working invite flow, consistent dashboard numbers, a CI gate, confirmed production backups, and a tenant-isolation test as a permanent regression guard.
**Acceptance criteria / tests:** see per-finding sections above; `npm audit` clean of critical/high in direct deps; new cross-tenant test passing; CI green on a test PR.
**Deployment required:** yes, for SEC-001/DATA-003/CORE-001/CORE-002; OPS-004 is a Railway dashboard/runbook action, not a deploy.
**Gate to Batch 2:** all Batch 1 items merged and verified in a staging/pilot-like environment.

### Batch 2 — Critical workflow correctness and reliability
**Findings:** DATA-001, DATA-002/INTG-002, DATA-004, DATA-006 (documentation/acceptance, no schema change forced), DATA-007, SEC-003, AUTO-001 (decide + document operating model), AUTO-003, AUTO-005 (scope: move inactive-lead batch loop off the request thread, not a full queue rewrite), TEST-002, TEST-004, OPS-005.
**Dependencies:** AUTO-002's scheduler (Batch 1) should land before AUTO-005's loop-off-request-thread change so they're tested together.
**Acceptance criteria:** lead creation rejects/merges duplicates; opportunity stage changes are atomic; automation actions are idempotent under retry; RBAC and concurrency have automated test coverage; a rollback has been dry-run at least once.
**Deployment required:** yes.

### Batch 3 — Essential missing UI and product functionality
**Findings:** CORE-003, CORE-004, INTG-007, INTG-011.
**Dependencies:** none on earlier batches besides general stability.
**Acceptance criteria:** every API route has a UI consumer or is explicitly removed; route-segment error/loading boundaries exist; handoff has a real claim/release UI action; simulate-inbound exercises the same pipeline as the real webhook.
**Deployment required:** yes.

### Batch 4 — Integration completion and failure recovery
**Findings:** INTG-003 (copy/marketing-language fix), INTG-008 (document the demo-vs-real default clearly in onboarding), INTG-009, INTG-012 (full implementation, if the business decides to build real Google Calendar sync rather than relabel it in Batch 1).
**Dependencies:** INTG-012 full build only proceeds if Batch 1's relabeling decision was "we will build it" rather than "we will remove the claim."
**Acceptance criteria:** outbound WhatsApp sends retry transient failures with backoff; onboarding copy accurately describes demo vs. live mode.
**Deployment required:** yes.

### Batch 5 — Tests, monitoring, performance, operational readiness
**Findings:** SEC-002, SEC-010, SEC-011, DATA-005, TEST-003, TEST-005, OPS-002, OPS-003.
**Dependencies:** none blocking.
**Acceptance criteria:** scoring/matching algorithms have table-driven unit tests; CSP no longer needs `'unsafe-inline'`; all used env vars are documented and validated at boot.
**Deployment required:** yes (low-risk, additive changes).

### Batch 6 — Validated customer-requested improvements
No findings currently queued here — deliberately left empty pending actual pilot/customer feedback, per the audit brief's instruction not to invent future work.

### Batch 7 — Scaling work justified by measured evidence
**Findings:** DATA-008 (unbounded insights queries — revisit once a workspace has measured thousands of leads/activities), SEC-002's major Prisma-version upgrade, any further AUTO-005 queue infrastructure beyond the minimum scheduler.
**Condition to revisit:** real latency/memory measurements from a workspace at meaningful scale, not assumed future load.

---

## 11. Recommended Testing and Acceptance Criteria

- **Mandatory new tests before Batch 1 closes:** cross-tenant isolation (TEST-001), Property.status transition on Won/Lost (DATA-003).
- **Mandatory new tests before Batch 2 closes:** lead-dedup behavior, opportunity stage-change atomicity under simulated failure, automation-action idempotency under duplicate trigger, RBAC enforcement at the HTTP boundary (not just the pure permission-matrix function), one concurrency test exercising a race on a unique constraint.
- **Mandatory before Batch 5:** unit tests for `computeLeadScore` and `filterAndScoreProperties` covering edge inputs (null budget, missing activity, zero matches).
- **General:** every new finding's "Regression tests required" line above is binding — do not close a finding without its named test.

---

## 12. Production Verification Checklist

- [ ] `npm audit` shows 0 critical/high in direct (non-dev) dependencies.
- [ ] Restore drill executed against actual production Postgres, not just local dev (OPS-004).
- [ ] CI pipeline green on `typecheck`, `lint`, `build`, `test` for the release commit.
- [ ] Health check (`/api/health`) returns 200 with real DB round-trip in the target environment.
- [ ] `X-Real-IP` trust assumption (SEC-003) confirmed accurate for the actual Railway edge configuration in use.
- [ ] Demo mode (`DEMO_MODE`) confirmed unset/false in the production environment variables.
- [ ] WhatsApp Business credentials and Meta webhook verify-token confirmed configured if live messaging is expected (otherwise the system silently runs in demo send mode).
- [ ] Google Calendar labeling resolved per Batch 1 decision (relabeled or implemented) before customer-facing copy references it.

---

## 13. Deferred Scaling Decisions and Evidence Needed to Revisit

| Deferred item | Evidence needed to act |
|---|---|
| DATA-008 unbounded `insights.ts` queries | A workspace with measured thousands of leads/activities showing real latency or memory pressure |
| SEC-002 Prisma major-version upgrade | Scheduled maintenance window; currently low practical risk since these are CLI-time, not request-path, dependencies |
| Full background job queue beyond AUTO-002's minimum scheduler | Automation volume/latency measurements showing requests timing out under real load |
| Full Google Calendar OAuth implementation | A business decision that real calendar sync is a committed roadmap item, not just a label |

---

## 14. Final Ordered Implementation Checklist

1. SEC-001 — bump Next.js to ≥16.3.8.
2. OPS-004 — run the disaster-recovery drill against production; confirm backup retention.
3. OPS-001 — stand up CI (typecheck/lint/build/test on every PR).
4. TEST-001 — add cross-tenant isolation test.
5. DATA-003 — fix Property.status on Opportunity Won/Lost, with regression test.
6. CORE-001 — unify dashboard and `/api/dashboard` metric computation.
7. CORE-002 — add team member invite flow.
8. INTG-012 — decide and execute: relabel or implement Google Calendar.
9. AUTO-002 — add a real scheduler for inactive-lead automation.
10. SEC-003 — confirm or fix the `X-Real-IP` trust boundary.
11. Proceed to Batch 2 (DATA-001/002/004/006/007, AUTO-001/003/005, TEST-002/004, OPS-005) only after 1–10 are verified in a staging/pilot environment.
12. Proceed to Batches 3–5 per §10 once Batch 2's acceptance criteria are met.

---

*This document should be revised in place with a dated changelog entry (not overwritten) the next time this audit is re-run, per the audit brief's instructions.*

**Revision history:**
- 2026-10-02 — Initial master plan created (this version).
- 2026-10-02 — Batch 1 implemented. See §15 below for completed work, evidence, tests, and what's still open.
- 2026-10-03 — Batch 1 re-verified against the code; several §15 claims were found overstated and were fixed. See §16 (supersedes §15 where they differ).
- 2026-10-03 — Batch 2 implemented (data integrity, automation safety, RBAC/concurrency tests, rollback runbook). See §17. It also found that migrations could not build a fresh database (fixed with a baseline migration).
- 2026-10-04 — Batch 3 implemented (UI coverage, route boundaries, role-aware controls, team and dashboard states). See §18.
- 2026-10-04 — Batch 4 implemented (integration truthfulness: WhatsApp mode, send retries, simulation, handoff). See §19.
- 2026-10-04 — Batch 5 implemented (tests, dependencies, CSP, environment validation, logging, health, performance baseline, release runbook). See §20.

---

## 15. Batch 1 Completion Report (2026-10-02)

All nine Batch 1 findings were re-verified against current code before any
change, then addressed. `npm run typecheck`, `npm run lint`, `npm test`
(257/257 passing, up from 234), and `npm run build` are all clean as of this
revision, against a real local Postgres with all migrations applied.

| ID | Status | What changed |
|---|---|---|
| SEC-001 | **Done** | `next`/`eslint-config-next` bumped 16.3.5 → 16.3.8. `npm audit --omit=dev` now reports 0 critical (previously 1 critical RCE). Remaining 4 high-severity findings are SEC-002 (Prisma CLI transitive deps), correctly deferred to Batch 5 — unrelated dependency, requires a Prisma major-version bump. |
| DATA-003 | **Done** | New `syncPropertyStatusOnStageChange()` (`src/lib/leads/convert-on-won.ts`), called from `applyStageChange()` in `src/app/api/opportunities/[id]/route.ts` whenever a stage transition enters or leaves a won/lost state on an opportunity with `linkedPropertyId` set. Won → `SOLD`/`RENTED` (by `Property.purpose`); Lost or reopened → `AVAILABLE`. An ordinary move between two open stages is untouched. Writes `PROPERTY_STATUS_CHANGED` audit rows, idempotent (no-op/no duplicate audit if the status is already correct). Tests: `tests/security/property-status-sync.test.ts` (6 cases: sale-won, rent-won, lost-reverts, reopen-reverts, open-to-open no-op, audit dedup). |
| CORE-001 | **Done** | New `getPipelineMetrics()` (`src/lib/metrics/pipeline.ts`) is now the single source for pipeline value, weighted pipeline, and won revenue — used by both `src/app/(app)/dashboard/page.tsx` and `src/app/api/dashboard/route.ts`. `/api/dashboard`'s won-revenue is now month-to-date (matching the dashboard page) instead of all-time, and both use the same probability-fallback logic for weighted pipeline. Test: `tests/security/pipeline-metrics.test.ts`. |
| CORE-002 | **Done** | New `POST /api/workspace/members` (`src/app/api/workspace/members/route.ts`, logic in `src/lib/workspace/invite-member.ts`), gated on the existing `members:manage` permission. Since this product has no self-service signup or email sending anywhere, adding a brand-new person creates their account with a one-time generated temp password (returned once in the API response, shown once in the Settings UI for the admin to share out of band); adding an existing user's email just creates the membership. New `MEMBER_INVITED` audit action (schema + migration `20261002000000_member_invited_audit_action`). UI: new "Add a team member" form on the Settings → Team tab, gated on `members:manage`. Test: `tests/security/invite-member.test.ts` (new account + temp password, existing-user reuse, duplicate-membership rejection). |
| INTG-012 | **Done (relabeled, not implemented)** | Decision: relabel, since no real Google OAuth/Calendar integration was approved for this batch. The UI (`calendar-client.tsx`, `/api/calendar`) already said "no Google Calendar sync" accurately; the one misleading string was Settings → Integrations' "Google architecture armed", which implied working readiness even though `GoogleCalendarProvider` makes zero real Google API calls regardless of env flags. Changed to "internal calendar — no external Google sync is implemented," true in every configuration. No code behavior changed; `GoogleCalendarProvider`/env vars (`GOOGLE_CALENDAR_ENABLED`, etc.) are left in place as inert scaffolding, not removed, since ripping them out was not requested and isn't required to stop the false claim. |
| AUTO-002 | **Partially done — code shipped, production wiring is a manual action** | `evaluateInactiveLeads()` now skips any lead that already received a `LEAD_INACTIVE` action within the 14-day cutoff (prevents a daily cron from re-creating the same follow-up task every day; full per-action idempotency keys remain AUTO-003/Batch 2). New `scripts/run-inactive-lead-automations.ts` (`npm run automations:scheduled`) loops every workspace. Deployment approach: Railway Cron Job (native overlap protection, confirmed via Railway's docs), cadence daily — documented in `docs/ops/SCHEDULED-AUTOMATIONS.md` along with the exact manual dashboard steps. **Not done:** actually creating that Cron Job service in the real Railway project — this requires access to the live Railway project and is explicitly a manual, production-side action per the task's constraints. Until that's done, inactive-lead automation still only runs when a user manually hits the automations button. |
| SEC-003 | **Confirmed, documented, hardened** | Verified via Railway's own technical-specifications docs that `X-Real-IP` is an edge-set header (listed alongside `X-Railway-Edge`/`X-Railway-Request-Id`), and this app is only reachable through Railway's edge (no direct container ingress), so the header cannot be client-spoofed in this deployment topology. Documented inline in `src/lib/security/request.ts` with the citation. Hardened `clientIp()` to reject a malformed/non-IP header value instead of trusting it verbatim (defense in depth for rate-limit bucketing). Tests added to `tests/security/session-hardening.test.ts`. |
| TEST-001 | **Done** | New `tests/security/tenant-isolation.test.ts`: seeds two real workspaces and proves `assertResourceInWorkspace`/`assertRelationsInWorkspace` (`src/lib/tenant.ts`) — the shared guard every CRM route uses to validate client-supplied related-record ids — reject every cross-workspace reference (lead, account, contact, property, opportunity, task, pipeline stage, and member ids) and accept the same ids when scoped correctly. This fails the moment a `workspaceId` filter is ever dropped from that shared function. |
| OPS-001 | **Done** | New `.github/workflows/ci.yml`: runs on every PR and push to `main`, spins up a real Postgres 16 service container, runs `prisma migrate deploy`, then `typecheck`, `lint`, `test`, `build` in that order. Not yet run against the real GitHub repo/remote (that happens on the first push/PR after this change merges) — the workflow file itself was validated by manually running every one of its steps locally against a real Postgres, as reported above. |
| OPS-004 | **Not done — explicitly out of scope for this change** | No production Railway access was available or used. `DISASTER_RECOVERY.md` already honestly states the last restore drill (2026-09-22) was against local dev only, not production — that claim is unchanged and still accurate. **This remains a required manual action before any pilot with real customer data**: run the restore drill in `DISASTER_RECOVERY.md` §1 against the actual production Postgres and confirm Railway's backup retention settings. Per the task's explicit constraints, this report does not and must not claim that action has happened. |

### Unresolved items / remaining manual actions after Batch 1

1. **OPS-004** — production restore drill has not been run; do this before any pilot with real customer data.
2. **AUTO-002** — the Railway Cron Job service itself has not been created; `docs/ops/SCHEDULED-AUTOMATIONS.md` has the exact steps. Until done, inactive-lead automation remains manual-trigger-only in production.
3. **OPS-001** — the CI workflow has not yet run against GitHub Actions (no push/PR has happened since it was added); confirm it goes green on the first real PR.
4. **INTG-012** — `GoogleCalendarProvider` and its env vars were left in place as inert scaffolding rather than removed; if the business later decides to actually build Google Calendar sync (Batch 4), start there — if not, a future cleanup pass could remove the dead code, but that wasn't required to close this finding.
5. Everything in Batch 2 (DATA-001/002/004/006/007, AUTO-001/003/005, TEST-002/004, OPS-005) is unchanged and remains queued — do not start it without separate instruction, per the task's scope limit.

### Acceptance criteria status

- [x] `npm audit` — 0 critical/high in **direct** dependencies (`next` is now clean; the 4 remaining high findings are transitive, via `prisma`/SEC-002, correctly deferred).
- [ ] Restore drill executed against actual production Postgres — **not done, manual action required (OPS-004)**.
- [x] CI pipeline definition added and its steps verified locally; not yet observed green on GitHub Actions itself (no PR run yet).
- [x] New cross-tenant isolation test passing (`tenant-isolation.test.ts`).
- [x] `Property.status` transitions on Won/Lost/reopen, with regression tests.
- [x] Dashboard and `/api/dashboard` now share one computation for pipeline/weighted/won-revenue figures.
- [x] Team member invite flow exists end to end (API + UI), with tests.
- [x] Google Calendar labeling resolved (relabeled, per INTG-012's own stated options).
- [ ] Inactive-lead scheduler **code** is done; the live Railway Cron Job is **not** — manual action required (AUTO-002).
- [x] `X-Real-IP` trust assumption confirmed and documented for this deployment topology (SEC-003).

---

## 16. Batch 1 re-verification and hardening (2026-10-03)

Every Batch 1 finding was re-checked against the code instead of trusting section 15. Several earlier "Done" claims did
not hold up; they are corrected here. **Where section 15 and this section differ, this section is current.**

### Results of the final run (local dev Postgres, Node 24.15)
| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | exit 0 - 469 tests, 83 suites, 469 pass, 0 fail, 0 skipped (section 15 reported 257) |
| `npm run build` | exit 0 (includes `prisma generate`) |
| `npm audit --omit=dev --audit-level=critical` | exit 0 - 0 critical; 4 high remain, all SEC-002 (Prisma CLI transitives `deepmerge-ts`, `effect`; Batch 5) |
| `prisma migrate deploy` + `migrate diff` (schema vs DB) | applied cleanly, "No difference detected" |
| Smoke test against `next start` | `/accept-invite` 200 without login; bad token 400 generic; protected pages still redirect to login; `/api/health` ok |

Not run: browser/E2E scripts (`e2e:*`, `perf:*`), anything against production or Railway, GitHub Actions itself.

### Per-finding status
| ID | Status | What was found and changed |
| --- | --- | --- |
| SEC-001 | **Fixed, verified** | `next` and `eslint-config-next` are 16.3.8 (`npm ls next` shows one deduped version). `npm audit --omit=dev` lists no `next` advisory. Build and tests green. |
| OPS-004 | **Open - requires production verification** | No change possible from the repo. Exact checklist (backup config, restore drill with pass condition, baseline caveat for the 7 migrations) in `docs/ops/BATCH1-OPERATOR-CHECKLIST.md` section 1. |
| OPS-001 | **Done in repo; not observed green on GitHub** | `ci.yml`: Node 24, Postgres 16 service, `prisma generate`, `migrate deploy`, schema-drift check, typecheck, lint, test, build, production audit with a critical gate. Throwaway CI values only, no repository secrets, `permissions: contents: read`, concurrency cancel. Each step fails the job on non-zero exit. Still required: a first real run, and marking the check required in branch protection. |
| TEST-001 | **Done (was weaker than claimed)** | Section 15's test only exercised the `tenant.ts` guard functions. New `tests/security/tenant-isolation-http.test.ts` (183 tests) calls the real route handlers across the HTTP boundary with real RBAC and DB: 8 resource types x 5 roles x GET/PATCH/DELETE against another workspace's records, list endpoints, cross-workspace linking (opportunity/task/proposal/assign), CSV export, search, dashboard/audit/stages, member PATCH/DELETE, forged `workspaceId` session claims, unauthenticated. Mutation check: removing the `workspaceId` filter from `findOpportunity` made 5 tests fail. Harness: `tests/helpers/http.ts` (only the session lookup is injected; needs `--experimental-test-module-mocks`, set in `npm test`). |
| DATA-003 | **Fixed (earlier fix had real defects)** | The earlier code was not transactional and freed a property when a *different* opportunity on it was lost or reopened. Now: stage write + property status + audit in one transaction with row locks (opportunity, then properties in id order); status is recomputed from active Won opportunities; a second Won opportunity on a sold/rented property is rejected 409; deleting a Won opportunity, re-linking it, and creating directly in a Won stage are handled; manual RESERVED/WITHDRAWN are never overridden. Lifecycle is documented in `convert-on-won.ts`. `tests/security/property-status-sync.test.ts` (12 tests via HTTP) includes 5x concurrent double-Won and 6x races of Won vs Lost/reopen. |
| CORE-001 | **Fixed, verified; page parity by construction only** | Both call `getPipelineMetrics` with a month-to-date window. `tests/security/dashboard-api.test.ts` compares `/api/dashboard` with the shared function and hand-computed figures (stage-probability fallback, soft-delete and tenant scoping, all roles). The dashboard page is a server component and is not rendered in tests; its parity rests on the shared call, not an executed comparison. |
| CORE-002 | **Reworked (earlier version returned a plaintext password)** | The server no longer generates or returns a password. New accounts get an unusable random hash plus a 72h single-use setup link (only its SHA-256 is stored; token in the URL fragment; never audited or logged). New public page `/accept-invite` and `POST /api/auth/accept-invite` (IP rate-limited, atomic single-use, 12+ char password, revokes sessions, audit `MEMBER_INVITE_ACCEPTED`). Existing user: membership only, no data about them returned. Re-inviting a not-yet-set-up member re-issues the link. Migration `20261003000000_account_setup_tokens` (additive; rollback = drop the table). 16 HTTP tests. **Limitation:** no email delivery exists, so the admin must hand the link over; the link is a credential visible to that admin once. |
| INTG-012 | **Done (earlier relabel was incomplete)** | Removed `GoogleCalendarProvider`, the `GOOGLE_CALENDAR_ENABLED` switch, the Google env vars in `.env.example`, the `googleCalendarEnabled` flag, the unused Google fetch-timeout, and API/UI strings that still implied Google sync. The calendar is labelled "Internal CRM calendar". Provider key stays `demo` (the UI's demo-lamp semantics are unchanged). No Google integration built. |
| SEC-003 | **Code hardened; production behaviour UNVERIFIED** | Section 15 called this "confirmed" on the strength of Railway's docs, which is not evidence about the live service. The comment in `request.ts` now says so. Added an operator test (rotating forged `X-Real-IP` against the webhook rate limit, with pass/fail criteria) in the checklist section 3. Existing code ignores non-IP-shaped values and never uses the leftmost `X-Forwarded-For`. |
| AUTO-002 | **Code done and hardened; production wiring is manual** | Required-ness evidence and every rule (cadence, timezone, coverage, eligibility, cap, idempotency, retry) are in `docs/ops/SCHEDULED-AUTOMATIONS.md`. Fixed two real gaps: overlapping runs were unprotected (now a per-workspace Postgres advisory lock, tested by holding the lock from another connection; the test fails with the guard removed), and FAILED executions suppressed a lead for 14 days (now retried). The script isolates per-workspace failures and exits non-zero. The default rule is renamed "follow-up task" because it never sent WhatsApp. The Railway Cron service does not exist yet. |

### Still blocking a controlled pilot (all operator actions)
1. **OPS-004** - production backup and restore drill not done. Hard stop for real customer data.
2. **AUTO-002** - create and verify the Railway Cron service.
3. **SEC-003** - run the forged-header rate-limit test against the live edge.
4. **OPS-001** - observe CI green on GitHub and require it on `main`.
5. Apply migrations `20261002000000` and `20261003000000` (and the earlier uncommitted ones) with `prisma migrate deploy` after a backup; see checklist 1c for the baseline caveat.
6. Set `AUTH_URL` to the public https origin in production (used to build setup links).

### Known remaining risks (not Batch 1 scope)
- Opportunity stage change is only partly atomic: lead touch/conversion and automations still run after the transaction (DATA-004, Batch 2). Concurrent changes to the same opportunity are serialized by the row lock, but there is no optimistic-version check.
- `PATCH /api/properties/:id` can still set a property's status by hand, which can contradict its Won opportunity (the next stage change on that property re-reconciles it).
- Automation actions are not idempotent per action (AUTO-003); the scheduler's lock and skip list narrow, but do not remove, the crash-window duplicate.
- Tests rely on Node's experimental `mock.module`; CI pins Node 24. Revisit if that API changes.
- The member list screen shows no pending or expired invitation state (Batch 3 reviews that UI).

---

## 17. Batch 2 report - data integrity, automation safety, authorization (2026-10-03)

All findings were re-verified against the code first. Batch 2 also found and fixed two defects that Batch 1 had missed
(a migration history that cannot build a database from scratch, and a deadlock in the new stage-change locking).

### Final run (local dev Postgres, Node 24.15)
| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | exit 0, run twice: 522 tests, 94 suites, 522 pass, 0 fail, 0 skipped (Batch 1: 469) |
| `npm run build` | exit 0 |
| `npm audit --omit=dev --audit-level=critical` | exit 0; 4 high, all SEC-002 (unchanged, Batch 5) |
| Fresh database: baseline + 8 migrations, then `prisma migrate diff` vs `schema.prisma` | applied, "No difference detected" |
| `npm run integrity:check` (dev DB) | 39 relations checked, no cross-workspace references |

Not run: browser/E2E, GitHub Actions, anything against production. The new "Create anyway" duplicate prompt in the leads
screen is type-checked and built but **not exercised in a browser**.

### Per-finding status
| ID | Status | Evidence |
| --- | --- | --- |
| DATA-001 | **Fixed** | Rules in `src/lib/leads/identity.ts`: a COMPLETE PK mobile (any spelling: +92/92/0/bare) or an exact e-mail (case-insensitive) matches; names, partial numbers and area never do; workspace-scoped; soft-deleted ignored. Manual create returns 409 + `duplicateOf` unless `allowDuplicate`; editing a phone/email onto another lead is refused the same way; CSV import uses the same rules; WhatsApp attaches to the matching lead. Phones are stored canonical (+92...). `tests/security/lead-dedup.test.ts` (18 tests). Known false positive: two people sharing one e-mail, resolved by the override. |
| DATA-002 / INTG-002 | **Fixed (code-enforced, not a unique index)** | Per-identity Postgres advisory locks serialize find-or-create across instances; the webhook event is now claimed *before* any lead is created (a concurrent replay could previously leave an orphan duplicate lead); lead + message + event are one transaction. Tests: 8 simultaneous manual creates -> 1 lead; 6 simultaneous first messages -> 1 lead, 6 messages; 5 simultaneous replays of one event -> 1 message, no orphan; double concurrent CSV import -> each person once. Mutation check: with the lock disabled 3 of these tests fail. **No unique constraint** because existing workspaces may hold duplicates; report query in ROLLBACK-RUNBOOK section 7. |
| DATA-004 | **Fixed** | Stage change = one transaction: stage, activity, audit, property status, lead touch and lead conversion; a failure after the stage write rolls everything back (proved with a DB trigger that forces the last write to fail). Per-opportunity row lock; optional `expectedStageId` returns 409 + `currentStageId` for a stale client; an identical concurrent move is applied once; inactive/foreign/unknown stages rejected. Permitted transitions: any active stage to any other active stage (reopen and Won<->Lost correction are intentional product behaviour), so there is no forward-only rule. Automations run after commit and are retry-safe. Field edits (name, value...) remain last-write-wins. `tests/security/opportunity-concurrency.test.ts`. |
| DATA-005 | **Fixed** | Conversion locks the lead row, then checks and writes, inside the stage transaction; concurrent or repeated conversions yield one transition and one audit row (6 parallel -> 1; two Won deals of one lead -> 1). |
| DATA-006 | **Documented decision + detection; no schema change** | Composite FKs rejected for now (39 relations, `SET NULL` on composite keys, existing-data risk, Prisma drift): `docs/security/WORKSPACE-INTEGRITY-DECISION.md`. Added read-only `npm run integrity:check` derived from the Prisma schema; tested by planting a cross-workspace row with raw SQL. The database still *accepts* such a row; the checker only reports it. |
| AUTO-003 / SEC-011 | **Fixed for CREATE_TASK and NOTIFY** | `Task.dedupeKey` / `Notification.dedupeKey` with unique indexes (migration `20261004000000`); key = automation + action index + `eventKey`. Callers pass stable keys: lead-created (once per lead), stage change (per transition), proposal sent/viewed (once per proposal), site visit completed (per event), scored-high / strong-match / lead-qualified (once per lead per UTC day), inactive sweep (per lead per 14-day window). Replays are recorded as SKIPPED. Triggers without a key (none of the above) are treated as genuine new occurrences. Tests incl. 6 concurrent triggers -> 1 task, simultaneous proposal SENT, site-visit COMPLETED and lead creation over HTTP; mutation check fails 5 tests. **Not covered:** RUN_AI_ANALYSIS / RUN_SCORING / RUN_PROPERTY_MATCH are recomputations and still run each time. |
| AUTO-005 | **Improved within the current architecture (no queue added)** | Per-action timeout (20s) recorded as FAILED; at most 50 actions per event; the inactive-lead sweep has a time budget (20s over HTTP, 4 min in the cron script) and reports `truncated`; failures stay isolated; duplicates prevented as above. A timed-out action is only abandoned, not cancelled, and may still finish: with an `eventKey` a retry is safe, without one it is not. Durable queue deliberately not introduced (no measured need; Batch 7). |
| TEST-002 | **Done** | `tests/security/rbac-http.test.ts`: 27 operations x 5 roles through the real handlers against a hand-written expected table (not derived from `authz.ts`), plus 401 for all, plus privilege-escalation cases (self role change, ADMIN vs OWNER, removed member refused, OWNER not assignable). Mutation check (granting AGENT `audit:read`) fails. Excluded: `POST /api/demo/reset` (demo-mode gated). |
| TEST-004 | **Done** | Deterministic concurrency tests for lead creation, WhatsApp intake, CSV import, lead conversion, opportunity updates and automation side effects (above). Synchronization is by real DB locks and a held advisory lock, not sleeps; loops of 3-6 rounds per race. |
| OPS-005 | **Runbook written; reversible parts tested; production untested** | `docs/ops/ROLLBACK-RUNBOOK.md` (compatibility table, app rollback, down-scripts in `prisma/rollback/`, recovery checklist). Drill on a disposable DB: rollback removed the columns/table, all rows survived, re-apply succeeded. |

### Defects found while doing Batch 2
1. **Migrations could not build a database from scratch.** The first migration alters tables that only existed because the project used `db push`. A fresh `migrate deploy` failed with `relation "Workspace" does not exist`. This means the Batch 1 CI workflow would have failed on its first run, and a disaster-recovery rebuild from migrations was impossible. Fixed with `20260101000000_baseline` (full schema minus the few non-idempotent objects later migrations create); a fresh database now equals `schema.prisma` exactly. **Existing databases must run `prisma migrate resolve --applied 20260101000000_baseline` once before the next deploy.**
2. **Deadlock** in the first version of the stage-change locking (`FOR UPDATE` conflicting with foreign-key share locks from concurrent activity inserts), caught by the new concurrency tests; fixed with `FOR NO KEY UPDATE`.
3. A UI dead end: after DATA-001 the Leads screen would have shown an error with no way forward; it now links the existing lead and offers "Create anyway".

### Deployment sequencing (must be followed in this order)
1. Take a backup (OPS-004 is still unverified; do not deploy to a database with real data until it is).
2. On every existing database: `npx prisma migrate resolve --applied 20260101000000_baseline`, then `npx prisma migrate status`. **Skipping this makes `migrate deploy` try to run the baseline against existing tables and fail.**
3. `npx prisma migrate deploy` applies, as applicable, `20260927000000`, `20261002000000`, `20261003000000`, `20261004000000`. Deploy the new code together with (not before) this: it writes `dedupeKey`.
4. Verify `/api/health`, then `npm run integrity:check`.
5. Rollback path: ROLLBACK-RUNBOOK section 3 (redeploy the previous build; the schema changes are additive).

### Remaining race and integrity risks
- No database unique constraint on lead identity; correctness rests on advisory locks that every lead-creating code path must use (manual, WhatsApp, CSV do; any future path must too). Legacy duplicates are not cleaned up.
- Advisory locks use a 32/64-bit hash of the key; a collision only causes extra waiting, never a wrong merge.
- A very large CSV takes one advisory lock per distinct phone/email in a single transaction (500-row cap keeps this to about 1,500); not load-tested.
- Post-commit steps (automations, WhatsApp audit/notify/handoff/auto-reply) are not part of the transaction: if the process dies right after commit, a replayed webhook is rejected as a duplicate and those steps are lost for that message.
- Field edits are last-write-wins; only stage changes have optimistic concurrency.
- `PATCH /api/properties/:id` status edits can still contradict a Won opportunity (Batch 1 note, unchanged).
- Timed-out automation actions may complete after being marked FAILED.
- Cross-workspace references are detectable but not prevented by the database (DATA-006).
- Batch 1 operator items are unchanged: OPS-004, the Railway Cron service, the SEC-003 live check, CI observed green on GitHub.

---

## 18. Batch 3 report - UI coverage, route states, accessibility (2026-10-04)

### CORE-003: API routes without a UI (decision per route)

| Route | Decision |
| --- | --- |
| `POST /api/intelligence/review` | **UI built.** Approve/Reject plus a "Review: ..." status line on the lead intelligence panel (OWNER, ADMIN, MANAGER). The permission existed but nothing let managers use it. Never mutates CRM records. |
| `POST /api/activities` | **UI built.** "Log an activity" under the lead timeline (`crm:write`). Contract tightened: only CALL, EMAIL, MEETING, NOTE, FOLLOW_UP are accepted; STAGE_CHANGE, SYSTEM, TASK, SITE_VISIT, WHATSAPP_MESSAGE now return 400 so system history cannot be forged. |
| `GET /api/activities` | Supported API, no new UI: lead, contact, account and opportunity pages already render timelines server-side. |
| `GET /api/scoring/history` | Left as API only: the lead page already shows the latest score change; no stated need for a history screen. |
| `GET /api/nba` | Left as API only: the lead page already renders the same computation server-side. |

Routes were not removed; they are small, authorised, workspace-scoped read APIs.

### CORE-004: boundaries
New `loading.tsx`, `error.tsx`, `not-found.tsx` under `(app)`, plus root `error.tsx`, `not-found.tsx`, `global-error.tsx`. They use `retry` (Next 16), show only the opaque `error.digest`, never the message or stack, announce via `role="alert"` / `role="status"`, and give a way back. Not-found says the same for "missing" and "not yours".

### Other screens
- **Role-aware controls** (new `PermissionsProvider`/`useCan`, fails closed; the server stays authoritative): leads, opportunities, proposals, tasks, calendar, pipeline, lead stage, WhatsApp take-over/composer, golden path, intelligence panel. Viewers no longer see buttons that return 403.
- **Pipeline**: every card has a labelled "Move to stage" select (drag was the only way, unusable by keyboard/touch); both paths send `expectedStageId`.
- **Team**: pending / expired invitation badges, "New setup link" for unfinished invitations (admins only), section nav labelled with `aria-current`.
- **Dashboard**: "This Month" no longer shows all-time data without saying so; explicit empty states; the delta is described as deal value opened vs last month.

### Intended users
Sales roles (OWNER, ADMIN, MANAGER, AGENT) for write controls; MANAGER and above for review; OWNER/ADMIN for invitations; VIEWER sees read-only screens with a note.

### Accessibility
Automated: `unlabelledControls()` over every modified screen for all five roles (it found and fixed unlabelled search/filter controls on Leads). Added labels, `aria-expanded`, `aria-current`, alert/status roles, `sr-only` text, `motion-safe` animation. **Not done:** contrast measurement, focus-order and screen-reader testing, real mobile viewport checks.

### Tests
`tests/ui/*` (route states, permission gating per role, dashboard/settings/team) and `tests/security/activities-review-http.test.ts` (roles, scoping, forged types, audit, invitation lifecycle). Final run: typecheck clean, lint clean, `npm test` 571 pass / 0 fail, `npm run build` ok, `npm audit --omit=dev --audit-level=critical` exit 0 with 4 high (SEC-002, Prisma CLI transitives, deferred to Batch 5).

### Limitations and remaining UI gaps
- **No live browser check was run** (Chrome extension not connected). UI tests are static server renders: they do not cover interaction, focus, closed modals, responsive layout or visual fidelity.
- No score-history screen or standalone activity feed.
- Pipeline drag-and-drop itself is untested; the select path is the accessible route.
- Settings integrations still show demo/simulated state where configured so (unchanged, Batch 4/5 scope).

---

## 19. Batch 4 report - integrations and workflow completion (2026-10-04)

### Classification of every integration
| Integration | Status | Evidence |
| --- | --- | --- |
| WhatsApp inbound (Meta webhook) | **Implemented, not live-verified** | Signature (HMAC-SHA256 on the raw body), fail-closed without app secret, unknown phone number rejected, per-message idempotency, unsupported types, forward-only delivery status: `tests/security/webhook.test.ts`, `webhook-flow.test.ts`. Never exercised against Meta. |
| WhatsApp outbound (Cloud API) | **Implemented, not live-verified** | Request shape, success, FAILED paths, bounded retry rules: `tests/unit/whatsapp-business-provider.test.ts` against a mocked `fetch`. No real credentials or customer were used. |
| WhatsApp demo provider | **Demo-only** | Records a labelled message in the CRM; nothing leaves the process. Used only in Demo Mode or non-production. |
| Simulate inbound (WhatsApp, Facebook lead) | **Demo-only** | Demo Mode + permission gated; WhatsApp one now runs the real inbound pipeline. |
| Human handoff / take-over | **Real (in-product), verified** | `tests/security/take-over-http.test.ts` (real DB). Nothing external involved. |
| Automation rules | **Real, fixed rules** | Not authorable; pause/resume work for all triggers (engine filters `enabled`/`paused`). |
| Scheduled inactive-lead follow-up | **Implemented, not live (deployment pending)** | Code and tests from Batch 1/2; the Railway Cron service still does not exist. |
| Google Calendar | **Not implemented (deferred)** | UI and README now say the calendar is internal and not synced. |
| Proposal acceptance | **Simulated, labelled** | Button reads "Simulate acceptance"; response and audit say "not a real client e-signature". No change needed. |

### Findings
- **INTG-008 fixed.** New `whatsappStatus()` decides one of `live | misconfigured | demo | disabled`. Previously `WHATSAPP_BUSINESS_ENABLED=true` with a missing credential silently fell back to the demo provider (fake "SENT"). Now: misconfigured and (production without Demo Mode, live not selected) both store FAILED with the reason and call nothing. Settings > Integrations, the WhatsApp thread badge ("Not connected") and the sidebar lamp reflect the real mode; the thread no longer assumes "Demo" before the server answers. Failed sends log the activity as "WhatsApp message not delivered". Messages show env var names only, never values.
- **INTG-009 fixed, with a stated limit.** Attempts are bounded (3, backoff with jitter, capped, honours Retry-After). The Cloud API has no idempotency key, so a send is retried only when it provably was not accepted: HTTP 429 or Meta throttling codes, or a connection that never opened. Timeouts, dropped connections, 5xx and "200 without message id" are **not** retried; they are stored FAILED with `deliveryUnknown: true` and the user is told to check the chat before resending. Permanent errors (auth, invalid number, 24h window) are never retried. Also fixed: Meta status callbacks could move a message backwards (late "delivered" over "read"); they are now forward-only.
- **INTG-011 fixed.** `/api/whatsapp/simulate-inbound` now calls the same `storeInboundMessage` as the webhook (lead match, extraction, handoff, conversation turn). It is refused outside Demo Mode, for read-only roles, and whenever a live provider is selected (the pipeline can auto-reply, which must never reach a real customer). Rows are tagged `provider: demo`, `simulated`, claimed under a separate event provider key so they cannot collide with real Meta ids, and audited with the acting user. The Facebook-lead simulator was already demo-gated and uses the real `createLead`; unchanged.
- **INTG-007: handoff is treated as an intended capability and hardened; release is NOT implemented.** Ownership rule applied is the one the product already uses for reassignment: unowned or own lead needs `crm:write`; a lead owned by someone else needs `leads:assign`. Take-over now runs in one transaction with a row lock: a concurrent second taker is refused (403), a repeat by the same person is a no-op, the audit row is written in the same transaction. UI hides the button when it would be refused. **Decision needed (not invented):** the automatic-reply suppression is permanent once anyone takes over, and there is no release/hand-back. Someone must define who may release, whether auto-reply resumes, and any idle timeout, and whether an agent may cover a colleague's lead.
- **AUTO-001.** Rules are fixed in code; no persisted configuration was added (no model support, and rule authoring is a product decision). The page now says so, and states that automatic WhatsApp replies are not a rule and are not controlled there (they stop only on take-over), and that scheduled follow-ups run only if the job is deployed. The unqualified "AI never sends outbound messages" line was removed. Toggle failures now show an error instead of failing silently.
- **AUTO-002.** Not changed. Required-ness, cadence and idempotency were implemented in Batches 1-2; the remaining step is the manual Railway Cron setup.
- **Google Calendar.** No integration was built (no approved OAuth/sync spec). Settings text and README corrected; the "Demo Mode" banner on the Workspace tab no longer shows when Demo Mode is off, and no longer says calendar credentials could enable anything.

### Tests
New: `tests/security/take-over-http.test.ts` (12), `tests/security/whatsapp-mode-and-simulation.test.ts` (16), 10 retry/classification tests, 2 status-order tests, UI tests for integrations tab, automations page, take-over gating and thread badge. Mutation checks, each of which made the matching test fail: removing the lead row lock; removing the live-provider guard; retrying on 5xx; removing the forward-only status condition (the first lock test did not catch the mutation and was rewritten to hold the lock from a second connection). Final: typecheck clean, lint clean, `npm test` 614 pass / 0 fail, `npm run build` ok, `npm audit --omit=dev --audit-level=critical` exit 0 (4 high, SEC-002, Batch 5). No test used real credentials or the network.

### Remaining limitations
- **Not live-verified:** no real Meta send, webhook, or delivery callback was tested. Do not call WhatsApp production-ready until done with a test number.
- **Durable queue:** sends are synchronous inside the request, retries can hold it up to roughly 20s, and a process crash mid-send loses the outcome. A queue (with a stored idempotent send record and reconciliation by the status webhook) is justified when any of these hold: sends must survive restarts, volume makes request-time retries a latency problem, or "delivery unknown" outcomes occur often enough to need automatic reconciliation.
- Webhook replay protection is per-message-id idempotency; Meta does not sign a timestamp, so an old validly-signed payload is deduplicated rather than rejected.
- Take-over, auto-reply suppression and the activity marker are keyed to a single "conversationTakeover" note; there is no release.
- Browser/visual checks of the changed screens were not run (static render tests only, as in Batch 3).

---

## 20. Batch 5 report - testing, monitoring, operational readiness (2026-10-04)

### Findings
| ID | Status | What was done |
| --- | --- | --- |
| TEST-003 | **Done** | `tests/unit/lead-scoring.test.ts` (16 tests) and `tests/unit/property-matching.test.ts` (25). Expected values are worked out by hand from the code's weights, with boundary cases for every threshold, missing/junk inputs, a frozen clock, a seeded 2,000-case range fuzz, monotonicity and determinism. One production change: `filterAndScoreProperties` now refuses a listing from another workspace (defence in depth; every caller already scoped its query). Mutations (a weight, the 35-point floor, the workspace guard) each failed tests. |
| TEST-005 | **Done** | `leakage.test.ts` was only string-presence checks. It is now honestly "repository hygiene": it scans every tracked and untracked-unignored file for private keys, OpenAI/Meta/AWS/GitHub/Slack tokens and database URLs with a real host and password (names the file and kind, never the value), proves the scanner flags real-looking samples and ignores placeholders, and asserts no `.env` is tracked. It found a fake credential in my own Batch 3 test, now assembled from parts. It cannot see git history or environment variables, and says so. |
| SEC-002 | **Partly fixed** | `prisma` and `@prisma/client` 6.19.0 -> 6.19.3 (supported patch). That bundles `effect` 3.21.0, which clears the `effect` advisory. **`deepmerge-ts` 7.1.5 is still flagged (<8.0.0) and cannot be fixed by a stable Prisma release** (7.10.0 bundles the same version; only the 8.0.0 release candidate moves). Audit: 4 high -> 3 high, all that one advisory. Judged low practical risk: it is a stack-exhaustion issue when merging deeply recursive objects, reached only through Prisma's own config loading at `prisma migrate` time, never with request data. No `overrides` were used. Verified: `prisma generate`, `migrate deploy`, schema drift check, typecheck, full tests, production build. Revisit when Prisma 8 is stable. |
| SEC-010 | **Improved, not fully strict** | Scripts now need a per-request nonce plus `'strict-dynamic'`; `'unsafe-inline'` is gone from `script-src` (`src/proxy.ts`, `src/lib/security/headers.ts`). The root layout reads request headers so every page renders per request (required for nonces; nothing was relying on static prerendering). **`style-src` still has `'unsafe-inline'`**: React renders `style=""` attributes, which a nonce cannot cover. Evidence: `npm run check:csp` loads /login and six signed-in pages in headless Chrome with the policy enforced (every `<script>` carries the nonce, no CSP violations, React hydrated) and passes on the final build; with the nonce removed it fails on every page. 7 unit tests cover the policy builder. A CI step now runs it; **that CI step has not yet been observed running on GitHub**. |
| OPS-002 | **Done** | `.env.example` now documents `DISABLE_HSTS`, `PERF_HTTP_HEADERS`, `PERF_HTTP_URL/PORT`, `BASE_URL`, `E2E_*`, `CHROME_PATH`, and the WhatsApp mode rules. Placeholders only. |
| OPS-003 | **Done** | `src/lib/env.ts` + `src/instrumentation.ts`. At start-up a production process exits 1 on: missing/non-postgres `DATABASE_URL`, `AUTH_SECRET` missing / under 32 chars / placeholder, missing `AUTH_URL`. Warnings (never fatal): http `AUTH_URL`, `DEMO_MODE` in production (reported as mode `demo`), `DISABLE_HSTS`, half-configured WhatsApp or Upstash. Messages name variable and rule, never the value (tested; also verified with a real `next start` using a short secret: exit 1, secret absent from output). Not run during `next build`. 13 tests. Note: any environment that runs `next start` with a placeholder `AUTH_SECRET` (including a local `.env`) will now refuse to start. |
| Logging | **Done** | `src/lib/log.ts`: one JSON line per event with `requestId`, redaction by key and by shape, errors reduced to name and first line, 300-char strings. Adopted for auth failures (masked email), webhook failures, automation failures, WhatsApp send failures, AI provider failures, unhandled API errors, render errors (`onRequestError`, with the digest users see), health failures and the start-up report. `[SECURITY]` lines are now `security_event` JSON (test updated). Catalogue: `docs/ops/OBSERVABILITY.md`. |
| Health | **Done** | `GET /api/health/live` (new: no dependencies, for uptime monitors) and `GET /api/health` (readiness: `SELECT 1`, bounded to 3 s; body now only `{status}`, no latency or database field; detail goes to the log). Railway's gate still points at `/api/health`. Deeper checks (migration state, Meta reachability) are deliberately not in the public endpoint: migrations are enforced by the start command and CI, and a third-party outage should not fail a deploy. |
| Performance | **Baseline recorded, local only** | `scripts/perf-http.ts` already measured p50/p95; it now stamps each result with its environment and limitations. Recorded run and caveats: `docs/ops/PERFORMANCE-BASELINE.md` (all measured routes 9-55 ms p50 locally; one machine, sequential, 10 samples, so p95 = slowest sample; says nothing about Railway or concurrency). |
| Runbooks | **Done, not rehearsed** | New `docs/ops/RELEASE-RUNBOOK.md` (rules, pre-deploy checks, deploy order, verification, smoke tests, failure table) and `docs/ops/OBSERVABILITY.md`; `ROLLBACK-RUNBOOK.md` cross-referenced. |

### Verification
typecheck clean; lint clean; `npm test` **689 pass / 0 fail** (was 614); `npm run build` ok (all routes now dynamic); `npm audit --omit=dev --audit-level=critical` exit 0 with 3 high (deepmerge-ts only); `npm run check:csp` passed on the final build in headless Chrome. No test used real credentials or the network.

### Not verified / still open
- **Monitoring and alerting do not exist.** Logs go to Railway stdout only. No uptime monitor, error tracker, metrics or alerts are configured; `OBSERVABILITY.md` lists suggestions and says so.
- The release and rollback runbooks have never been rehearsed on Railway. Railway keeping the previous release when a new one fails its healthcheck is from its documentation, not observed here.
- The CI CSP step is unobserved on GitHub (it needs the runner's Chrome).
- `style-src 'unsafe-inline'` remains; the policy is not "strict".
- `deepmerge-ts` advisory remains until a stable Prisma 8.
- Still manual from earlier batches: OPS-004 (backups and restore drill), the Railway Cron service, SEC-003 live check, a real Meta test-number verification.
- Performance figures are local and single-run; no load test was done.
- Other "security" tests are source-text contract checks (`tests/security/inbox-contracts.test.ts`, parts of `contracts.test.ts`). They are labelled as contracts, not behaviour; behaviour is covered by the HTTP-level tests. They were not rewritten.
