# Performance Audit

**Product:** Synas Labs Lead-to-Sale CRM  
**Date:** 2026-09-19  
**Environment:** local Windows, PostgreSQL `leadtosale_crm` @ `localhost:5432`  
**Dataset at measurement:** demo workspace (~51–65 leads depending on leftover harness rows), 26 opportunities, 24 properties, 50 contacts, ~115–119 activities  
**Method:** instrument → in-process `npm run perf:audit` → authenticated HTTP harness `npm run perf:http` (3 warmup + 10 measured, real cookies, no auth bypass) → optimize from evidence → report  

Diagnostic thresholds (not SLAs): **FAST** <200ms · **NORMAL** 200–500ms · **SLOW** 500ms–1s · **VERY SLOW** 1–2s · **CRITICAL** >2s.

This report distinguishes **STATIC CODE ANALYSIS** from **ACTUAL RUNTIME MEASUREMENT**. Numbers below are measured unless the cell says otherwise.

## Executive Summary

Authenticated HTTP against `next start` on `:3010` was collected. Paginated CRM APIs are **FAST** (median **17–45ms**, P95 **19–72ms**). Login is **SLOW** on a cold credentials POST (**597ms**, bcrypt); a later unique-user login in the saved results file was **125ms**. CSV import is the scaling wall: **100 rows SLOW (546–671ms first run; one repeat 1091ms VERY SLOW)**, **250 VERY SLOW (1330–1452ms)**, **500 CRITICAL (2902–2983ms)** — automations dominate. Isolated volume at 100 / 500 / 1,000 leads stayed **FAST** for paginated list/search/dashboard/insights APIs.

Dashboard `/dashboard` cold HTML is **SLOW** (**712ms** before weather split, **649ms** after). Most of that is first RSC compile/render, not Open-Meteo on this run (219ms then 90ms). Weather **was** in the same `Promise.all` as CRM queries; it was moved into a `Suspense` child so an 800ms Open-Meteo miss cannot hold CRM HTML. `GET /api/dashboard` (no weather) is **FAST** (**59–74ms**).

Prisma `$on("query")` durations do **not** appear in `x-perf-summary` (`dbQueries=0`) because the query event fires outside `AsyncLocalStorage`. Auth/authz/csv spans and in-process Prisma timings remain valid. Security was not weakened.

The app is **not** production-performance-ready: CSV 500 is **CRITICAL**, RSC lists remain unbounded, and insights still load full ranges.

## Authenticated HTTP Measurements

Harness: `scripts/perf-http.ts`. Unauthenticated `GET /api/leads` → **307** (middleware). Login uses Auth.js credentials + CSRF cookies (no RBAC/HMAC/rate-limit bypass). Workspace isolation: isolated perf workspace returned only `Vol*` leads (`allVolPrefix: true`). Calendar/WhatsApp providers stayed local (no Graph/Google).

Warm APIs below: 3 warmup + 10 measured. **Auth/Authz** are mean `auth.session` / `authz.membership` spans. **DB / External / Queries** from `x-perf-summary` are **0** (Prisma query events are outside the request ALS). Use in-process Prisma figures in [Database Performance](#database-performance) for query cost.

| Endpoint | Median | P95 | Max | Auth | Authz | External | Queries | Class |
|----------|--------|-----|-----|------|-------|----------|---------|-------|
| GET /api/leads | 27.6 | 31.3 | 31.3 | 5.0 | 1.9 | 0 | n/a (ALS) | FAST |
| POST /api/leads | 45.1 | 72.0 | 72.0 | 4.5 | 2.0 | 0 | n/a | FAST |
| GET /api/opportunities | 28.3 | 39.8 | 39.8 | 4.2 | 2.1 | 0 | n/a | FAST |
| GET /api/properties | 22.9 | 25.4 | 25.4 | 3.5 | 1.5 | 0 | n/a | FAST |
| GET /api/accounts | 22.7 | 29.1 | 29.1 | 3.4 | 1.8 | 0 | n/a | FAST |
| GET /api/contacts | 20.1 | 28.6 | 28.6 | 3.5 | 1.7 | 0 | n/a | FAST |
| GET /api/tasks | 25.1 | 27.9 | 27.9 | 3.3 | 1.9 | 0 | n/a | FAST |
| GET /api/activities | 21.4 | 24.4 | 24.4 | 3.8 | 1.7 | 0 | n/a | FAST |
| GET /api/proposals | 22.0 | 26.0 | 26.0 | 3.6 | 1.8 | 0 | n/a | FAST |
| GET /api/notifications | 16.7 | 19.3 | 19.3 | 3.7 | 1.5 | 0 | n/a | FAST |
| GET /api/dashboard | 41.6 | 53.4 | 53.4 | 4.0 | 4.3 | 0 | n/a | FAST |
| GET /api/search?q=dha | 29.8 | 34.0 | 34.0 | 3.9 | 2.5 | 0 | n/a | FAST |
| GET /api/insights?range=30d | 44.0 | 52.1 | 52.1 | 3.4 | 1.9 | 0 | n/a | FAST |
| GET /api/audit | 20.3 | 23.1 | 23.1 | 3.9 | 1.9 | 0 | n/a | FAST |
| GET /api/pipeline/stages | 19.6 | 30.3 | 30.3 | 3.5 | 2.1 | 0 | n/a | FAST |
| GET /pipeline (HTML) | 32.4 | 39.4 | 39.4 | n/a | n/a | 0 | n/a | FAST |
| GET /leads (HTML) | 33.2 | 41.4 | 41.4 | n/a | n/a | 0 | n/a | FAST |
| PATCH /api/leads/:id | 30.3 | 36.0 | 36.0 | 3.2 | 2.0 | 0 | n/a | FAST |
| PATCH /api/opportunities/:id | 35.7 | 42.4 | 42.4 | 3.4 | 1.8 | 0 | n/a | FAST |
| POST /api/intelligence | 40.0 | 50.6 | 50.6 | 3.7 | 1.8 | 0 | n/a | FAST |
| POST /api/scoring | 38.9 | 50.1 | 50.1 | 3.8 | 1.5 | 0 | n/a | FAST |
| POST /api/proposals | 24.5 | 32.7 | 32.7 | 3.3 | 2.0 | 0 | n/a | FAST |
| POST /api/calendar | 30.9 | 35.4 | 35.4 | 3.3 | 1.9 | 0 | n/a | FAST |
| POST /api/whatsapp/messages | 34.1 | 50.0 | 50.0 | 4.3 | 2.0 | 0 | n/a | FAST |

Dominant component on list GETs: remaining handler + Prisma + serialize after **~5ms auth + ~2ms authz**. POST /api/leads also runs `LEAD_CREATED` automations (span mean **19.7ms** on the warm set; in-process **35–36ms** per lead).

Credentials login: first complete HTTP run **596.7ms SLOW** (Auth.js POST **550ms**, bcrypt). Later login in that run **132.1ms**. Current results JSON (`2026-09-19T15:54:41Z`, unique harness user after `bcrypt.hash` in setup): **125.3ms**, status **302**.

## Cold vs Warm

Do not confuse **first process/RSC compile** with **application fetch cache**.

| Surface | Cold | Warm | What changed |
|---------|------|------|----------------|
| GET /api/leads | **62.9ms** (`coldHttpMs`) | median **27.6ms** / P95 **31.3ms** | DB + Node warmup, not an app cache |
| GET /api/search | **41.4ms** | median **29.8ms** | No app cache |
| GET /api/insights | **45.0ms** | median **44.0ms** | No app cache |
| GET /api/properties | **45.2ms** | median **22.9ms** | Warmup |
| GET /api/dashboard | **43.9ms** | median **41.6ms** | No weather on this route |
| GET /dashboard HTML | **712ms** TTFB **706ms** (before split) | **82–162ms** (Next fetch cache 2–9ms) | First RSC compile + weather vs cached weather |
| Open-Meteo | 219ms (HTTP run 1), 90ms (run 2), **701–821ms** in-process earlier | 0–9ms (`revalidate: 1800`) | **Next.js fetch cache**, not Postgres warmup |

## Data Volume Scaling

Isolated workspace (deleted after). `allVolPrefix: true`. Seed: 100 in **21.3ms**, 500 in **114.7ms**, 1000 in **269.2ms**. Paginated `pageSize=100`. 1 warmup + 3 measured. Numbers from `scripts/perf-http-results.json` (2026-09-19T15:54:41Z).

| Endpoint | 100 median / P95 | 500 median / P95 | 1000 median / P95 | Class |
|----------|------------------|------------------|-------------------|-------|
| GET /api/leads | 26.1 / 30.1 | 28.0 / 30.5 | 26.0 / 28.6 | FAST |
| GET /api/opportunities | 20.5 / 21.2 | 17.9 / 20.9 | 15.6 / 16.6 | FAST |
| GET /api/properties | 16.4 / 18.8 | 16.6 / 18.6 | 17.3 / 17.4 | FAST |
| GET /api/search?q=Vol | 21.7 / 22.7 | 28.0 / 39.2 | 23.5 / 26.1 | FAST |
| GET /api/dashboard | 18.8 / 21.2 | 20.8 / 20.9 | 20.2 / 22.2 | FAST |
| GET /api/insights | 19.2 / 24.9 | 27.2 / 29.4 | 29.9 / 30.6 | FAST |
| GET /api/pipeline/stages | 17.7 / 26.1 | 16.9 / 19.8 | 15.0 / 17.4 | FAST |
| GET /pipeline | 26.1 / 28.8 | 27.3 / 56.3 | 27.3 / 28.5 | FAST |
| GET /api/activities | 17.6 / 17.7 | 21.6 / 24.5 | 15.4 / 17.1 | FAST |
| GET /api/audit | 16.8 / 22.3 | 21.8 / 24.1 | 17.2 / 20.7 | FAST |

Paginated APIs did **not** slow materially from 100 → 1,000 leads. This does **not** prove unbounded RSC tables at 10k+. Insights rose slightly (**19.2 → 29.9ms** median) as expected with more in-range rows.

## CSV Scaling

Security cap unchanged (**500 rows / 1MB**). Automations still run after commit, concurrency 5. Wall-clock `csv.automations` from `[PERF]` logs (not the summed nested `auto=` header, which overcounts nested spans).

**First complete HTTP run** (parse / DB tx / automation wall from `[PERF]`):

| Rows | HTTP total | Parse | DB tx | Automations (wall) | Class | vs 500ms / 1s / 2s / 5s / 10s |
|------|------------|-------|-------|--------------------|-------|-------------------------------|
| 100 (3 runs) | **546, 604, 671ms** | 1–4ms | 36–42ms | **480–612ms** | SLOW | over 500ms, under 1s |
| 250 (1 run) | **1452ms** | 2ms | 88ms | **1333ms** | VERY SLOW | over 1s, under 2s |
| 500 (1 run) | **2983ms** | 3ms | 169ms | **2782ms** | CRITICAL | over 2s, under 5s |

**Repeat after weather split** (`perf-http-results.json`): 100 = **1091, 676, 663ms** (VERY_SLOW, SLOW, SLOW); 250 = **1330ms** VERY SLOW; 500 = **2902ms** CRITICAL. All HTTP 200. Do not raise the 500-row cap.

## Dashboard Timing

Weather is non-critical UI. `GET /api/dashboard` never called Open-Meteo.

| Condition | HTTP | TTFB | Open-Meteo | Notes |
|-----------|------|------|------------|-------|
| **Before split — cold** | **711.7ms** | **706ms** | **219ms** | Weather in same `Promise.all` as CRM queries; also first RSC compile |
| **Before split — warm** | 161 → 82ms | 157 → 78ms | **2–9ms** | Next `revalidate: 1800` cache |
| **Before split — weather fail** | **66.8ms** | **61.2ms** | **3ms** `ok=false` | Page already compiled; fail-fast |
| **Before split — API no weather** | **58.5ms** | **57.4ms** | none | CRM JSON only |
| **After split — cold** | **648.5ms** | **640.5ms** | **90ms** | First RSC compile still dominates; weather no longer in CRM `Promise.all` |
| **After split — warm** | 169 → 80ms | 165 → 75ms | **0–1ms** | Similar to before |
| **After split — weather fail** | **92.4ms** | **88.3ms** | **3ms** fail | FAST |
| **After split — API no weather** | **73.5ms** | **72.6ms** | none | FAST |

Node `fetch` waits for the streamed body, so HTTP total still includes later Suspense chunks. The important change is **CRM queries are no longer `await`ed with Open-Meteo**. An 800ms weather miss (measured in-process **701–821ms**) can no longer hold the CRM `Promise.all`. Cold HTML remains **SLOW** because of first RSC compile (~650ms), which is process warmup, not weather.

## Top 5 Bottlenecks

1. **CSV import automations** — 500 rows HTTP **2983ms CRITICAL**; `csv.automations` **2782ms**. Parse+DB are FAST.
2. **CSV 250 / 100** — **1452ms VERY SLOW** / **546–671ms SLOW**. Same cause.
3. **Credentials login** — **597ms SLOW** (bcrypt cost 10; intentional).
4. **Dashboard HTML cold** — **649–712ms SLOW** first RSC render of `/dashboard`.
5. **Open-Meteo on cache miss** — **90–219ms** this HTTP pass, **701–821ms** in-process earlier. No longer gates CRM queries after the Suspense split; still a third-party dependency.

## Optimizations Applied

This HTTP pass (evidence-based only):

- **Dashboard weather:** removed `lahoreTemperature()` from the CRM `Promise.all`; render via `<Suspense><LahoreTemperatureBadge /></Suspense>`. Weather still fetched; security unchanged.
- **Auth.js login:** do not rewrite Auth.js `Set-Cookie` headers; replay the credentials body after rate-limit email parse so CSRF `csrfToken` reaches Auth.js.
- **Prisma client:** cache the client on `globalThis` in production `next start` to avoid extra pools.

No list-query shape changes: volume tests did not show a FAST→SLOW regression at 1,000 leads.

## Before / After

**GET /dashboard cold (weather in `Promise.all` → Suspense child)**

- Before: HTTP **711.7ms**, TTFB **706ms**, Open-Meteo **219ms**, class **SLOW**
- Change: `Suspense` + async `LahoreTemperatureBadge`; CRM `Promise.all` is Prisma only
- After: HTTP **648.5ms**, TTFB **640.5ms**, Open-Meteo **90ms**, class **SLOW** (first RSC compile). Warm **~80ms FAST**. Weather-fail **92ms FAST**.

This is **not** an 800ms TTFB win on this machine’s HTTP runs (Open-Meteo was already 90–219ms). The split is still the correct isolation for the previously measured **701–821ms** Open-Meteo miss.

**POST /api/leads/csv 500**

- Before this product: N+1 insert (fixed in the prior pass)
- This pass: **no further CSV change**
- Measured: HTTP **2983ms CRITICAL** (repeat **2902ms**)

## Remaining Risks

- CSV `LEAD_CREATED` automations on the request (CRITICAL at 500).
- Unbounded RSC lists (Leads, Pipeline, Accounts, Contacts, Properties, Tasks) and insights `findMany` without `take`.
- Prisma query events not correlated into `x-perf-summary` (ALS).
- Dashboard cold HTML **SLOW** on first compile of a `next start` process.
- Live WhatsApp Graph / Google Calendar HTTP still unused; 8s timeouts reserved.
- Do not raise CSV 500-row cap.

## API Performance (in-process)

Instrumentation: `measuredRoute` + Prisma query events (durations only, **no SQL params**) + `x-request-id`. Nested spans: `auth.session`, `authz.membership`, `csv.*`, `webhook.*`, `ai.*`, `score.*`, `automation.*`.

**Authenticated HTTP totals** are in [Authenticated HTTP Measurements](#authenticated-http-measurements). **DB / CPU / external** times below were measured in-process (`npm run perf:audit`).

| Endpoint | Avg/Measured Time | DB | External | Status |
|----------|-------------------|----|----------|--------|
| GET /api/leads (page 20) | HTTP median **27.6ms**. DB findMany+include **22–33ms**. Serialize **1–2ms**. JSON **24,311 bytes** | Measured | none | Instrumented |
| POST /api/leads | HTTP median **45.1ms**. Membership **4–10ms**. LEAD_CREATED automation **35–36ms** in-process / **19.7ms** mean span on warm HTTP | Measured (components) | none | Instrumented; automations **block** the request |
| GET /api/leads/csv | Export query **3–11ms**. CSV generate **1ms** (51 rows) | Measured | none | Instrumented; capped at 500 rows |
| POST /api/leads/csv | HTTP 100 **546–671ms**, 250 **1452ms**, 500 **2983ms**. Parse 100 **2–3ms**. Batched insert 100 (rolled back) **28–34ms** | Measured | none | Instrumented; automations still run after commit |
| GET /api/opportunities | HTTP median **28.3ms**. Unbounded findMany **15–18ms** (26 rows, RSC comparison) | Measured | none | API is paginated (max 100) |
| GET /api/dashboard | HTTP median **41.6ms**. Query bundle **20ms**. **No weather** on this route | Measured | none | Instrumented |
| GET /api/search | HTTP median **29.8ms**. 8-entity `Promise.all` **13ms** (`contains 'a'`) | Measured | none | Instrumented; already parallel + `take` |
| GET /api/insights | HTTP median **44.0ms**. workspaceInsights 30d **29ms**. pipelineAging **31ms** | Measured | none | Instrumented; unbounded in range |
| GET /api/notifications | HTTP median **16.7ms**. `take: 40` in code | Measured | none | Instrumented |
| POST /api/webhooks/whatsapp | Signature **0.39ms** (unit) / **~0ms** (audit). Lookups **3–13ms**. Persist not HTTP-timed | Measured | none | Instrumented |
| POST /api/auth (credentials) | HTTP **597ms** first login. bcrypt compare **60–242ms** | Measured (bcrypt) | Upstash only if configured (800ms timeout) | Instrumented |
| POST /api/intelligence | HTTP median **40.0ms**. analyzeLead **60–80ms** (prep 33–40, analysis 3–7, persist 17–39) | Measured | none (local deterministic AI) | Instrumented |
| POST /api/scoring | HTTP median **38.9ms**. scoreLead **44–65ms** (prep 30–41, analysis 1ms, persist 13–22) | Measured | none | Instrumented |
| GET /api/accounts, contacts, properties, tasks, activities, proposals, audit | HTTP medians **16.7–25.1ms**. List APIs use `paginationSchema` (max pageSize 100) | Measured | none | Instrumented |
| Calendar / WhatsApp send | HTTP POST calendar **30.9ms**, WhatsApp **34.1ms**. Providers persist to Postgres; **no live Graph/Google HTTP** | Measured | **N/A until credentials + send path exist** | Instrumented |

## Database Performance

Measured on demo data:

| Operation | Duration | Notes |
|-----------|----------|--------|
| Parallel entity counts | 103–134ms | 9 `count` queries |
| `lead.findMany` page 20 + owner/account/contact | 22–33ms | Matches GET /api/leads default include |
| `lead.findMany` unbounded | 7–8ms | 51 rows |
| `opportunity.findMany` unbounded + stage/owner/lead | 15–18ms | 26 rows |
| Membership `findFirst` | 4–10ms | Same pattern as `requireWorkspaceAccess` |
| CSV duplicate `findMany` + `createMany` 100 rows (rolled back) | 28–34ms | After removing per-row `findFirst` |
| Webhook lead+contact lookup `Promise.all` | 3–13ms | |

**Slow queries at this size:** none (≥100ms Prisma query log would have fired; count bundle was 103–134ms total, not a single query).

**STATIC — will slow as data grows:**

- Insights `findMany` with no `take` for leads, opportunities, activities, tasks, proposals, WhatsApp, properties.
- Dashboard RSC loads all open opportunities and all proposals to sum in memory.
- CSV used to do N+1 `findFirst`+`create` per row inside a 30s transaction. **Fixed** to one lookup + `createManyAndReturn`.
- Lead PATCH does find → updateMany → find again (correctness, small extra read).

Indexes added this pass (query-pattern based, not speculative):

| Index | Query | Expected benefit | Write overhead |
|-------|-------|------------------|----------------|
| `Lead(workspaceId, email)` | CSV duplicate check `email IN (...)` | Index-only filter as imports grow | Extra index on lead writes |
| `Lead(workspaceId, phone)` | Webhook `phone` OR lookup | Complements existing `whatsappNumber` | Extra index on lead writes |
| `Contact(workspaceId, phone)` | Webhook contact match | Complements `whatsappNumber` | Extra index on contact writes |

Existing indexes already cover `workspaceId+deletedAt`, stage, owner, followUpDue, WhatsApp conversation, audit createdAt.

ILIKE `contains` search **cannot** use btree indexes; left as-is (capped `take` 5–6).

## External API Performance

| Provider | Endpoint | Method | Measured duration | Status | Timeout | Retry |
|----------|----------|--------|-------------------|--------|---------|-------|
| Open-Meteo | forecast `current=temperature_2m` (Lahore) | GET | **775ms, 821ms** (two runs) | 200 | **2500ms** (added) | none |
| Upstash Redis | REST `/pipeline` INCR+EXPIRE | POST | **Not exercised** (not configured locally) | — | **800ms** (added); timeout falls through to Postgres limiter | none |
| WhatsApp Graph | live send | POST | **Does not run.** Business provider stores QUEUED/FAILED locally | — | **8000ms reserved** in `FETCH_TIMEOUTS_MS` | none |
| Google Calendar | live events | — | **Does not run.** Provider writes CRM rows + metadata | — | **8000ms reserved** | none |
| n8n / email / object storage / OpenAI | — | — | **Not present** | — | — | — |

No API keys, tokens, or payloads are logged. External spans use `EXT:{provider}:{METHOD}`.

## AI/Intelligence Performance

AI is **in-process and deterministic** (no model HTTP).

Measured `analyzeLead`:

| Phase | Run A | Run B |
|-------|-------|-------|
| Input preparation (`loadLeadContext`, 8 parallel queries, properties `take: 80`) | 33ms | 40ms |
| Analysis | 7ms | 3ms |
| Persistence (intelligence row + audit) | 39ms | 17ms |
| **Total** | **80ms** | **60ms** |

Measured `scoreLead`:

| Phase | Run A | Run B |
|-------|-------|-------|
| Input preparation | 30ms | 41ms |
| Analysis | 1ms | 1ms |
| Persist (updateMany + reload + history + audit) | 13ms | 22ms |
| **Total** | **44ms** | **65ms** |

Synchronous and **blocks** the intelligence/scoring request. Duplication: qualifying a lead can run analysis + scoring + property match via automations. At current cost this is acceptable. Move to a worker only if context loading grows with unbounded WhatsApp/activity history (`take` already 40/40/80).

No queue added.

## Webhook Performance

| Phase | Measured | Notes |
|-------|----------|--------|
| Signature HMAC-SHA256 | **0.39ms** (unit) / ~0ms (audit) | Timing-safe; fail closed without secret |
| JSON parse | ~0ms on empty fixture | |
| Workspace resolve | **Not isolated**; included in unknown-phone test **119ms** (unit, includes DB) | |
| Lead + contact lookup | **3–13ms** | Now parallel |
| Persist transaction | **Not HTTP-timed** | Unique `(provider, externalEventId)` |
| Notify + audit | Sequential after persist | Single-row inserts; stay sync for correctness/idempotency |
| External API | none | |

Acknowledge-then-async is **not** required at measured cost. Keep signature + persist in the request for idempotency. If a future Graph call is added, do it **after** commit, with the 8s timeout, and do not retry non-idempotent sends.

## CSV Performance

Security cap remains **1MB / 500 rows / 2000 chars**. **1,000 / 5,000 / 10,000 row imports were not executed.**

| Test | Parse | DB | Automations | Total |
|------|-------|----|-------------|-------|
| 100 rows (~6.5KB) | **2–3ms** (audit), **6ms** (unit) | **28–34ms** batched insert (rolled back; no automations) | not run in rollback test | parse+DB **FAST** |
| 500 rows (~33KB) | **2–3ms** (audit), **9ms** (unit) | not inserted | — | parse FAST |
| 1,000+ | **Rejected** (`CSV_LIMITS.maxRows`) | — | — | by design |

Export (51 rows): query **3–11ms**, generate **1ms**. Memory: full string in process; cap 500 rows so this is bounded.

**N+1 removed:** per-row `findFirst` + `create` replaced with `email/whatsapp IN (...)` + `createManyAndReturn`.

**Still blocking after commit:** `LEAD_CREATED` automations. In-process **35–36ms** per lead. HTTP harness (committed, concurrency 5): 100 **546–671ms SLOW**, 250 **1452ms VERY SLOW**, 500 **2983ms CRITICAL** (`csv.automations` wall **2782ms**). No queue (would change delivery guarantees). **Safe maximum remains 500 rows.** Operators should not raise the cap without moving automations off the request.

Transaction timeout: 30s. No external calls inside the import transaction.

## Server Action Performance

**STATIC:** there are **no** `"use server"` actions in this repo. Mutations go through App Router route handlers. Important handlers are instrumented as APIs (lead create/update, pipeline PATCH, proposals, calendar, WhatsApp, intelligence, CSV).

## Page Performance

**STATIC analysis** of RSC data loading, plus authenticated HTML timings from `npm run perf:http`. Node `fetch` waits for the streamed body (TTFB ≈ HTTP total).

| Page | Fetch pattern | Risk |
|------|---------------|------|
| Dashboard RSC | CRM Prisma in `Promise.all`; weather in `<Suspense>` child (`LahoreTemperatureBadge`) | Cold HTML **649–712ms SLOW** (first RSC compile). Warm **~80ms FAST**. Open-Meteo **90–219ms** this HTTP pass / **775–821ms** in-process. Timeout 2.5s. `revalidate: 1800` |
| GET /api/dashboard | 12 parallel queries, `take` on lists | Bundle **20ms** on demo data |
| Leads | **Unbounded** `findMany` into client table; client-side filter/paging | 51 rows / **54KB**. Duplicate fetch avoided when `initialLeads` is set |
| Opportunities / Pipeline | Unbounded opportunities + relations | 26 rows **15–18ms** |
| Properties / Accounts / Contacts / Tasks | Unbounded | Will grow linearly |
| Calendar | events + leads/opps `take: 200` | Bounded |
| Proposals | proposals + related `take: 50` | Bounded |
| WhatsApp | messages `take: 80` | Bounded |
| Insights / Reports | full-range `findMany` | **29–31ms** now; no cap |
| Audit | `take: 200` page / API paginated | Bounded |
| Settings / Automations | small | Fine |
| App layout | `auth()` + membership + branding every navigation | Extra membership query; required for RBAC |

No UI redesign. Pagination was **not** bolted onto RSC tables because client search currently filters the loaded set (capping would hide rows).

## Query Count / N+1 Findings

| Finding | Type | Action |
|---------|------|--------|
| CSV import per-row `findFirst`+`create` | N+1 **measured/fixed** | Batch lookup + `createManyAndReturn` |
| Webhook lead then contact | Sequential → parallel | `Promise.all` |
| Insights `intelligenceRun.count` after other queries | Sequential → parallel | Moved into `Promise.all` |
| `loadLeadContext` | 1 lead + 8 parallel child queries | Already parallel; properties `take: 80` |
| Automation `ownerFor` extra lead/opp lookup per action | Repeat in one request | Small; left (depends on prior writes) |
| Dashboard RSC vs `/api/dashboard` | Two implementations | Duplicate **code**, not duplicate queries in one request |
| Per-record owner queries in loops | **Not found** in API list handlers; they `include` owner | — |

## Response Size Findings

| Payload | Records | Bytes (UTF-8 JSON) |
|---------|---------|---------------------|
| Leads pageSize 20 with owner/account/contact | 20 | **24,311** |
| All workspace leads with owner name | 51 | **53,986** |

APIs for leads/accounts/contacts/properties/tasks/activities/proposals/audit are paginated (max 100). RSC list pages and insights still return/process full collections.

Notifications API: 40 rows, no `count(*)` extra query (unread derived in memory).

## Timeout Findings

| Call | Before | After |
|------|--------|-------|
| Upstash rate-limit fetch | **none** (could hang) | **800ms**; on timeout use Postgres limiter |
| Open-Meteo | **none** | **2500ms**; dashboard catches and returns `null` |
| WhatsApp Graph / Google Calendar | no HTTP today | constants **8000ms** for when those paths are wired |
| CSV Prisma transaction | 30s | unchanged |

`fetchWithTimeout` uses `AbortController`. Provider timeouts are **not** a single global value.

## Retry Findings

| Mechanism | Behavior |
|-----------|----------|
| Application retries | **None** for fetch/SDK/webhooks |
| `AutomationExecution.retryCount` | Incremented on failure; **no retry loop** |
| Rate limit 429 | `Retry-After` header only |
| Prisma / P2002 on webhook | Treat as duplicate, do **not** re-insert |
| CSV | Duplicates skipped, not retried |

Do not retry WhatsApp sends, lead creates, or proposal writes. Current code does not.

## Memory Findings

| Area | Assessment |
|------|------------|
| CSV parse | Full file in a string; capped 1MB |
| CSV export | `toCsv` in memory; capped 500 rows |
| Insights | Loads all matching rows into arrays | **P1 as data grows** |
| Dashboard open opps / all proposals | In-memory reduce | OK at 26 opps |
| WhatsApp thread | `listMessages` unbounded per conversation in provider; page uses `take: 80` | Provider helper itself has no take |
| `JSON.stringify` of huge objects | Lead page 20 is 24KB; unbounded 51 leads 54KB | |
| Notifications polling | Client `setInterval` **12s** | Extra load, not a memory leak (`clearInterval` on unmount) |

## Bottlenecks

Measured on this dataset (slowest component named):

| Workflow | Breakdown | Bottleneck |
|----------|-----------|------------|
| Login | bcrypt **60–242ms** + user lookup unmeasured | **Password hashing (intentional)** |
| Dashboard RSC (cache miss) | DB bundle ~20ms + weather **775–821ms** | **Open-Meteo** (non-critical UI) |
| Lead create | DB create + audit + automation **~36ms** | Automation (task+notify+audit), still FAST |
| Lead scoring | prep 30–41 / analysis 1 / persist 13–22 / total 44–65 | Context load |
| Lead analysis | prep 33–40 / analysis 3–7 / persist 17–39 / total 60–80 | Context load + persist |
| WhatsApp inbound | HMAC ~0 / lookups 3–13 | DB lookups; FAST |
| CSV import 100 (DB only, rolled back) | parse 3 + tx 28–34 | **FAST** after batching |
| CSV import 100 / 250 / 500 HTTP | parse 1–4 / DB tx 36–169 / auto wall 480–2782 | **SLOW / VERY SLOW / CRITICAL** (automations) |
| Search | 13ms | FAST |
| Insights 30d | 29 + 31ms | FAST at 51 leads |

No operation was made asynchronous where correctness/idempotency required the write to finish in-request.

## Recommended Optimizations

### P0 — severe

1. **CSV import 500 HTTP 2983ms CRITICAL.** `LEAD_CREATED` automations on the request (`csv.automations` **2782ms**). Product decision: skip automations on CSV, or run them later. No queue added. Do not raise the 500-row cap.

### P1 — important

1. **CSV 100/250** — **546–671ms SLOW** / **1452ms VERY SLOW**. Same automation cause as P0.
2. **Unbounded RSC lists** (Leads, Pipeline, Accounts, Contacts, Properties, Tasks) and **insights `findMany` without take**. Paginated APIs stayed FAST at 1,000 leads; RSC tables were not re-shaped. Do not cap silently (breaks in-memory search).
3. **WhatsApp `listMessages` provider** has no `take`; the page passes 80 only on its own query. Align the provider.
4. **Prisma `$on("query")` vs ALS** — HTTP `dbQueries=0`. Correlate query events if operators need per-request DB totals.

### P2 — optimization

1. Dashboard RSC and `/api/dashboard` duplicate metric logic — one query module.
2. Lead PATCH double-read after `updateMany` — return `updateMany` count only where the client does not need the full include.
3. `scoreLead` reload after `updateMany` — use `findFirst` once or `update`+select if workspace scope is already guaranteed.
4. Postgres rate-limit row is a write on every mutation; Upstash is the intended high-QPS path (800ms timeout).
5. Layout membership query every navigation — required for RBAC; do not cache across users.
6. First `/dashboard` RSC compile **~650ms SLOW** on a fresh `next start` process — process warmup, not an application cache.

### P3 — future

1. ILIKE search → `pg_trgm` only after search latency is measured as slow (HTTP search median **29.8ms** at demo size / **23.5ms** at 1,000 `Vol*` leads).
2. Stream CSV export if the 500-row cap is ever raised.
3. Wire Graph/Google HTTP with the reserved 8s timeouts; never retry non-idempotent sends.

## How to re-measure

```bash
npm test
npx tsc --noEmit
npx eslint .
npm run build
npm run perf:audit
npm run perf:http
```

`perf:http` starts `next start` on `:3010` with `PERF_HTTP_HEADERS=true`, logs in with a unique harness OWNER (does not reuse the demo password against the login rate limit), writes `scripts/perf-http-results.json` (gitignored). Unauthenticated check expects **307**. Isolated volume workspace is deleted after the run.

Watch server logs for:

```
[PERF] requestId=… operation=GET /api/leads duration=XXms threshold=… dbQueries=… db=…ms
```

Do not enable Prisma stdout SQL logging in production. Query events record **verb + duration** only when ≥100ms. They currently fire **outside** request ALS, so HTTP headers report `dbQueries=0`.

## Production readiness (performance)

Paginated CRM APIs are **FAST** on this machine at demo size and at 1,000 isolated leads. The app is **not** production-performance-ready: CSV 500 is **CRITICAL**, RSC lists remain unbounded, insights still load full ranges, and dashboard cold HTML is **SLOW** on first compile. Do not claim production performance readiness from this dataset.
