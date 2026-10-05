# CRM Current-State Audit — Synas Labs Lead-to-Sale CRM

**Audit date:** 2026-10-02. **Method:** full read of application routes, pages, components, business-logic libraries, the Prisma schema, and the test suite, by five independent subsystem reviews plus direct inspection of the pre-existing security audit (`docs/security/*.md`, dated 2026-09-27). Read-only — no application code, schema, or data was changed to produce this audit. Branch: `main`, working tree as of the git status captured at audit start.

**Companion documents** (each is a standalone deep-dive; this document is the executive synthesis):
- [`CRM-FEATURE-TREE.md`](./CRM-FEATURE-TREE.md) — full hierarchical feature tree, status-coded, with Mermaid diagrams and a shared-service dependency map
- [`CRM-WORKFLOW-MAPS.md`](./CRM-WORKFLOW-MAPS.md) — six verified end-to-end workflows with sequence/flow diagrams and failure behavior
- [`CRM-DATA-MODEL-MAP.md`](./CRM-DATA-MODEL-MAP.md) — every Prisma model mapped to the feature(s) that own it, with usage classification
- [`CRM-ROLE-PERMISSION-MATRIX.md`](./CRM-ROLE-PERMISSION-MATRIX.md) — role-by-feature capability matrix with server-side evidence
- `docs/security/API-AUTHORIZATION-MATRIX.md`, `DATABASE-SESSION-SECURITY-AUDIT.md`, `COOKIE-POLICY.md`, `PRODUCTION-READINESS-CHECKLIST.md` — the pre-existing, independently thorough security audit (auth, sessions, RBAC enforcement, workspace isolation). **Not re-audited here** — referenced by finding ID (F-01…F-22) where relevant.

---

## 1. Executive summary — what this CRM can actually do today

Strip away the marketing name and the UI copy, and here is what the code actually does:

**A real lead pipeline exists and works.** A lead can enter the system three ways — a manual form, a CSV upload, or an inbound WhatsApp message — and all three converge on the same tested creation path. WhatsApp inbound is a genuine, HMAC-verified Meta Cloud API webhook integration, not a mock. Once a lead exists, a deterministic rules engine scores it and matches it against real property inventory; a second deterministic rules engine carries on a WhatsApp conversation with the customer, asking for missing requirements one at a time, showing real matching properties, and handing off to a human the moment it hits a question it can't safely answer (negotiation, an unavailable listing, or a request it doesn't understand). None of this uses a language model by default — it is well-engineered conditional logic over real CRM data, and it is honest about that in at least one place (the Insights page literally says "AI is not used for calculations").

**The product's name promises more than the code delivers end to end.** The lead→opportunity→proposal→won funnel is real but has a human-shaped gap in the middle: nothing automatically turns a promising WhatsApp conversation into an Opportunity — an agent has to do that by hand. And at the other end, winning a deal updates the Lead (to `CONVERTED`, correctly and idempotently) but never touches the linked Property's status — a real-estate CRM's most obvious "deal closed" automation doesn't exist.

**Several complete, permissioned, audited backend features are invisible to users.** This is the single most consistent pattern this audit found: Contacts and Accounts can be viewed but not created, edited, or deleted anywhere in the UI; Notes have a full API and zero UI; manual Activity logging and manual Task creation have no UI button anywhere; three of ten "AI" report types (and the entire AI-review/approval workflow) are reachable only by a direct API call. In every one of these cases the backend is not a stub — it's validated, workspace-isolated, and audit-logged — it simply has no door into it from the product.

**"AI" in this product means deterministic rules, with one narrow, optional exception.** Lead analysis, call prep, site-visit prep, follow-up/email/LinkedIn drafting, property-match explanations, opportunity summaries, lost-deal analysis, and proposal summaries are all template logic reading real CRM fields — not a model call. A real, working OpenAI integration exists in the codebase, but it is wired into exactly one place: a last-resort assist inside the WhatsApp conversation engine, used only when the deterministic extractor and intent classifier both come up empty, and only if `OPENAI_API_KEY` is configured.

**The Google Calendar "integration" does not integrate with Google.** Despite environment variables, a timeout constant, and a provider class that looks real, no code anywhere in the repository calls any Google API or implements OAuth. Site visits are always stored CRM-only; the only difference when "Google Calendar" is enabled is a cosmetic metadata label.

**Security and session handling are the most mature layer of the product**, independently audited in detail (`docs/security/*.md`): 49–54 live attack-harness checks pass, role/permission enforcement is re-verified from the database on every request, and session revocation, rate limiting, and workspace isolation are all implemented and tested. This audit's new findings sit mostly one layer up, in product completeness rather than security.

---

## 2. Complete feature inventory

Full per-feature detail (UI entry point, API routes, services, DB models, tests, step-by-step flow) lives in the five source subsystem reports that fed this document and in `CRM-WORKFLOW-MAPS.md`. This table is the audit's inventory of record — status per the taxonomy below, one line of evidence, and a pointer to the relevant finding where one exists.

**Status taxonomy:** Implemented and verified (V) · Implemented, partially verified (PV) · Partially implemented (PI) · UI-only/placeholder (UO) · Demo/simulated (DS) · Configuration-dependent (CD) · Not implemented (NI) · Unknown/unverified (UNK)

| # | Feature | Role access | Status | Evidence | Finding |
|---|---|---|---|---|---|
| 1 | Authentication, session, logout | All | V | `docs/security/DATABASE-SESSION-SECURITY-AUDIT.md` | — |
| 2 | Workspace membership — role change/removal | OWNER/ADMIN | V | `src/app/api/workspace/members/[userId]/route.ts`, `scripts/e2e-rbac.ts:112-118` | — |
| 3 | Workspace membership — invite new member | n/a | **NI** | no `POST /api/workspace/members` exists, no UI | PF-32 |
| 4 | Workspace branding | OWNER/ADMIN | V | `src/app/api/workspace/route.ts`, `scripts/e2e-rbac.ts:99-101` | — |
| 5 | Lead manual creation | crm:write | V | `src/lib/leads/create-lead.ts:11-65` | PF-06 (no dedup) |
| 6 | Lead CSV import | csv:import | V (insert) / PI (automations) | `src/app/api/leads/csv/route.ts`, `tests/security/csv-automations.test.ts` | PF-07, PF-17 |
| 7 | Lead CSV export | csv:export | V | `src/app/api/leads/csv/route.ts`, `tests/security/csv.test.ts` | — |
| 8 | Lead via WhatsApp inbound | n/a (system) | V | `src/lib/webhooks/whatsapp.ts:95-263`, `tests/security/webhook-flow.test.ts` | — |
| 9 | Lead assignment — manual | leads:assign | PV | `src/app/api/leads/[id]/assign/route.ts` | — |
| 10 | Lead assignment — least-loaded auto | leads:assign | PV | `src/lib/assignment/assign-lead.ts` (no direct UI caller found) | — |
| 11 | Lead stage/lifecycle | crm:write | PV | `src/components/leads/lead-stage-control.tsx` | PF-06 (dual CONVERTED path) |
| 12 | Global search | search:use | PV | `src/app/api/search/route.ts`, no dedicated test found | — |
| 13 | Leads-list filter/search | crm:read | PI | `leads-table.tsx` — client-side only, capped at first 100 fetched leads | PF-08 |
| 14 | Human hand-off take-over | crm:write | PV | `src/lib/leads/take-over.ts` | — |
| 15 | Notes | crm:write | PI | API complete (`src/app/api/notes/route.ts`); zero UI callers found anywhere | PF-03 |
| 16 | Manual Activity logging | crm:write | PI | API complete (`src/app/api/activities/route.ts`); no "log activity" button exists | PF-04 |
| 17 | Contact create/edit/delete | crm:write/delete | PI | API complete; zero UI callers found | PF-01 |
| 18 | Account create/edit/delete | crm:write/delete | PI | API complete; zero UI callers found; owner-reassign not gated by leads:assign | PF-02 |
| 19 | Property CRUD | crm:write/delete | V | `src/app/api/properties/*` | — |
| 20 | Property matching algorithm | n/a (internal) | V | `src/lib/matching/properties.ts`, reused identically by 7 call sites | — |
| 21 | Property status on won deal | n/a | **NI** | no code path updates `Property.status` from an opportunity stage change | PF-22 |
| 22 | Lead scoring | scoring:run | V | `src/lib/scoring/score-lead.ts` — deterministic, no tests | PF-13 |
| 23 | Lead analysis / call-prep / site-visit-prep / drafts | intelligence:run | DS | `src/lib/ai/*.ts` — confirmed deterministic templates, not LLM calls | PF-09, PF-10 |
| 24 | Opportunity summary / lost-deal analysis / proposal summary | intelligence:run | PI | Implemented server-side; no UI entry point for any role | PF-11 |
| 25 | Intelligence review/approval workflow | intelligence:review | PI | `POST /api/intelligence/review` implemented; no UI for any role | PF-11 |
| 26 | Next-best-action | crm:read | V | Shown on lead page via direct server call; `/api/nba` route itself unused | PF-12 |
| 27 | Insights/Reports | crm:read | PV | Live SQL aggregates; explicitly labeled non-AI; zero test coverage of the math | PF-13, PF-30 |
| 28 | WhatsApp inbound webhook | n/a (HMAC) | V | `tests/security/webhook.test.ts`, `webhook-flow.test.ts` | — |
| 29 | WhatsApp outbound — Demo | whatsapp:send | DS | `src/lib/providers/whatsapp/demo.ts` (default) | — |
| 30 | WhatsApp outbound — real Meta Cloud API | whatsapp:send | CD | `src/lib/providers/whatsapp/business.ts` — real `fetch` to graph.facebook.com, confirmed by mocked-fetch unit test; off unless `WHATSAPP_BUSINESS_ENABLED=true` + 2 credentials | — |
| 31 | Conversation inbox | whatsapp:read | V | `src/lib/whatsapp/inbox.ts`, `tests/unit/whatsapp-inbox.test.ts` | — |
| 32 | Automated conversational reply engine | n/a (system) | V | `src/lib/whatsapp/conversation-orchestrator.ts`, `tests/security/conversation-flow.test.ts` | — |
| 33 | Requirement extraction | n/a (system) | V | `src/lib/whatsapp/extract-requirement.ts`, regex-based by design | — |
| 34 | Human hand-off detection | n/a (system) | V | `src/lib/whatsapp/detect-handoff.ts`, prioritized regex rules | — |
| 35 | Automation engine — 9 seeded rules | automations:read/execute/manage | PV | `src/lib/automation/engine.ts` — not idempotent per action | PF-17, PF-18 |
| 36 | `AUTOMATION_FAILED` trigger | n/a | **NI** | defined in schema, never fired by any code path | PF-14 |
| 37 | Custom automation authoring | n/a | **NI** | schema supports arbitrary `conditions`/`actions`; no UI or API to author one | PF-15 |
| 38 | Inactive-lead re-engagement sweep | automations:execute | PI | works via direct API call; no UI button, no cron | PF-16 |
| 39 | In-app notifications | notifications:read | V | `src/lib/notifications.ts`, 12s polling | PF-19 |
| 40 | Pipeline board (drag-drop) | crm:write | PV | `@dnd-kit`-based, `pipeline-board.tsx` | — |
| 41 | Pipeline stage configuration | n/a | **NI** | read-only display only; `GET /api/pipeline/stages` is the only route | PF-20 |
| 42 | Opportunity CRUD | crm:write/delete | PV | owner reassignment not gated by leads:assign | PF-21 |
| 43 | Won → Lead conversion | n/a (system) | V | `src/lib/leads/convert-on-won.ts`, `tests/security/lead-conversion.test.ts` — idempotent, tested | — |
| 44 | Proposal lifecycle (Draft→Sent→Viewed) | crm:write | PV | `src/app/api/proposals/[id]/route.ts` | — |
| 45 | Proposal view-tracking | n/a | DS | self-reported "Mark viewed" click, no public link/pixel | PF-23 |
| 46 | Proposal acceptance | n/a | DS | explicitly labeled in-product as simulated, not e-signature | PF-23 |
| 47 | Task status updates | crm:write | V | `tasks-client.tsx` Complete/Start buttons | — |
| 48 | Manual task creation | n/a | **NI** | no UI anywhere creates a Task by hand | PF-26 |
| 49 | Calendar — create Site Visit | calendar:write | DS | Demo provider; "Google" provider writes identically | — |
| 50 | Calendar — Google sync | n/a | **NI** | no OAuth flow, no Google API call anywhere despite env-var scaffolding | PF-27 |
| 51 | Calendar — edit/complete/cancel/delete | calendar:write | **NI** | full API exists; zero UI entry point | PF-28 |
| 52 | Dashboard | crm:read | V | live Prisma aggregates; two divergent metric code paths | PF-29 |
| 53 | Audit trail viewer | audit:read | V (writes) / PI (read UX) | all 6 named `AuditAction`s confirmed written; no pagination/filter UI | PF-31 |
| 54 | Demo mode gating | n/a | V | `tests/security/demo-mode.test.ts`, fails closed | — |
| 55 | Demo reset | demo:reset | V | `src/lib/demo/reset-demo.ts`; one dead duplicate component | PF-33 |
| 56 | Golden Path walkthrough | all (no gate) | DS/CD | real API calls end-to-end; inert outside Demo Mode, no warning | PF-34 |
| 57 | Health check | public | V | `tests/security/health.test.ts`, Railway-wired | — |

---

## 3. Consolidated findings (product layer)

These extend, and are numbered separately from, the pre-existing security findings F-01…F-22 (`docs/security/DATABASE-SESSION-SECURITY-AUDIT.md`). "Impact" is a plain-English severity read for a product owner, not a security CVSS score.

| ID | Finding | Impact |
|---|---|---|
| PF-01 | Contacts: no create/edit/delete UI exists anywhere (API-only) | High — a core CRM entity can't be managed by any role through the product |
| PF-02 | Accounts: no create/edit/delete UI exists anywhere (API-only); owner reassignment also not gated by `leads:assign` | High |
| PF-03 | Notes: fully built backend, zero UI entry point; the three detail pages that fetch `noteEntries` never render them | Medium — the feature is invisible, not broken |
| PF-04 | Manual Activity logging: no "log activity"/"add note" UI; only system-generated activities ever appear | Medium |
| PF-05 | Two inconsistent audit conventions for soft-delete (Lead gets `LEAD_ARCHIVED`; Contact/Account use `*_UPDATED` + a metadata flag) | Low — cosmetic/consistency issue in the audit trail |
| PF-06 | Two independent code paths can set `Lead.stage = CONVERTED` with different audit metadata shapes; manual creation/WhatsApp-inbound have zero duplicate detection | Medium |
| PF-07 | CSV import: automations run post-commit, non-transactionally, with a documented duplicate-task-on-retry gap | Medium |
| PF-08 | Leads-list search/filter is client-side only, capped at the first 100 fetched leads; server-side filtering support is unused | Medium — invisible data loss risk as lead volume grows |
| PF-09 | Every "AI" lead/property intelligence feature is a deterministic template; the real OpenAI provider is wired into none of them | High — a direct expectation-vs-reality gap if leadership believes this is ML/LLM-driven |
| PF-10 | A specific seeded lead ID returns a fully hardcoded "AI" response regardless of live data | Low (demo-script artifact, but located in production code) |
| PF-11 | 3 of 10 intelligence report types, and the entire AI review/approval workflow, have no UI for any role | Medium |
| PF-12 | `GET /api/nba` has no UI caller | Low |
| PF-13 | Zero automated test coverage for scoring, matching, all AI functions, insights math, next-best-action | Medium — correctness is unverified, not necessarily wrong |
| PF-14 | `AUTOMATION_FAILED` trigger defined but never fired | Low |
| PF-15 | No automation-authoring UI/API exists; rules are fixed seed data, pause/resume only | Medium — limits the product's "automation" positioning |
| PF-16 | `LEAD_INACTIVE` sweep has no UI button and no cron wired to it | Medium — a designed feature currently never runs in practice |
| PF-17 | No automation action type is idempotent; `CREATE_TASK` demonstrably double-fires on retry (documented, unfixed) | Medium-High — duplicate tasks/notifications on any retried trigger |
| PF-18 | Automation execution isn't transactional with its trigger; one unguarded lookup can 500 an otherwise-successful mutation | Low-Medium (narrow: DB-outage window only) |
| PF-19 | Notifications are 12-second polling, not push | Low — UX/scale note, not a defect |
| PF-20 | No pipeline-stage CRUD exists; stages are fixed seed data despite schema support | Medium |
| PF-21 | Owner-reassignment gap (F-15 in the security audit) confirmed to extend to Opportunities, Tasks, Proposals, and Calendar events, not just Accounts/Properties | Medium |
| PF-22 | Winning an Opportunity never updates the linked Property's status | High for a real-estate product specifically — the most natural "deal closed" automation is missing |
| PF-23 | Proposal view-tracking and acceptance are self-reported, not real tracking/e-signature (clearly labeled in-product) | Low — honestly disclosed, but worth leadership awareness |
| PF-24 | `Attachment` model is completely dead — no route, no code reference | Low |
| PF-25 | Several enum values are never set by any code path (`ProposalStatus.NEGOTIATION/REJECTED/EXPIRED`, `TaskStatus.CANCELLED`, `CalendarEventStatus.COMPLETED/CANCELLED/NO_SHOW`) | Low-Medium |
| PF-26 | No manual task-creation UI exists anywhere | Medium — a basic collaboration primitive is backend-only |
| PF-27 | "Google Calendar integration" never calls any Google API or implements OAuth — cosmetic label only | High — directly contradicts what the feature name implies |
| PF-28 | No UI to edit/complete/cancel/delete a calendar event | Medium |
| PF-29 | Two independently-computed dashboard metric surfaces can drift | Low |
| PF-30 | Zero test coverage of Reports/Insights math | Medium |
| PF-31 | Audit trail page bypasses its own API, no pagination/filter UI, hard 200-row cap | Low |
| PF-32 | No member-invitation UI/API exists; new members require direct DB/seed access | Medium — a real operational gap for onboarding a new teammate |
| PF-33 | Dead code: an unused duplicate "Reset Demo" component | Low (cleanup) |
| PF-34 | Golden Path is reachable by every role/environment with no `DEMO_MODE` pre-check; fails immediately and silently outside demo mode | Low |
| PF-35 | `DEMO_MODE` (env var) and `workspace.isDemo` (DB flag) are independent switches that can disagree | Low |

---

## 4. Product maturity assessment

| Area | State | Basis |
|---|---|---|
| Core CRM functionality (Leads/Properties) | **Implemented** | Full CRUD, workspace-isolated, audited, reasonably tested |
| Core CRM functionality (Contacts/Accounts/Notes/Activities/Tasks authoring) | **Partial — backend-complete, UI-absent** | PF-01, PF-02, PF-03, PF-04, PF-26 |
| Lead ingestion | **Implemented** | Manual + CSV + WhatsApp converge on one tested path; no dedup on two of the three paths |
| Sales pipeline | **Partial** | Opportunity/proposal/pipeline mechanics work; stage config, manual tasks, calendar management, and won→property-status are all missing |
| Intelligence & matching | **Demo-only, with one configuration-dependent exception** | Scoring/matching are real deterministic engines; all "AI" labels are templates; OpenAI is wired into one narrow WhatsApp fallback only |
| WhatsApp communication | **Implemented (inbound); configuration-dependent (outbound-live)** | Real Meta webhook + real Meta send code exist; demo is the default |
| Automation | **Partial** | Reliable but non-idempotent, non-configurable, with one dead trigger and one unreachable sweep |
| Team collaboration | **Partial** | Strong RBAC; no invite flow; no manual activity/task/note authoring |
| Reporting | **Implemented, partially verified** | Live data; the computation logic itself is untested |
| Security and access control | **Strong** (not re-audited here) | `docs/security/*.md`, 229+ tests, live attack harness 54/54 |
| Reliability and recovery | **Partial** | Webhook/CSV-insert are transactional and idempotent; automation execution is neither |
| Performance and scalability | **Unverified by CI** | `scripts/perf-*.ts` are manual, not part of `npm test` or any CI gate found |
| External integration readiness | **WhatsApp: configuration-dependent, real. Google Calendar: not implemented despite appearing configurable** | PF-27 is the standout correction here |
| Testing and release readiness | **Strong at the security/session layer; weak at the business-logic layer** | Session/RBAC/webhook paths are thoroughly tested; scoring, matching, AI templates, insights, and most pipeline routes have little-to-no dedicated test coverage |

**What works end to end today:** login → lead creation (any of 3 channels) → scoring → property matching → WhatsApp conversation with human handoff → manual opportunity creation → pipeline movement → proposal lifecycle → won → lead conversion. Each link in that chain is real; the chain has human-required joints (qualification, assignment, opportunity creation) by design, and two missing joints (property status, visit completion) not by design.

**What works only under specific configuration:** real WhatsApp message delivery (`WHATSAPP_BUSINESS_ENABLED=true` + access token + phone number ID); any AI-assist inside the WhatsApp conversation engine (`OPENAI_API_KEY`); the in-memory rate-limiter fallback (demo/test only, otherwise fails closed to a shared Postgres bucket or Upstash).

**What is demonstrated only in demo mode:** inbound lead simulation, WhatsApp inbound simulation, the Golden Path walkthrough, demo reset, and — by default, with no configuration at all — every WhatsApp send and every calendar event.

**What is incomplete:** Contacts/Accounts/Notes/manual-Task/manual-Activity authoring UI; pipeline stage configuration; calendar event management beyond creation; automation authoring; member invitation; won-deal property-status sync; lost-deal reason capture.

**What is missing for a coherent real-estate lead-to-sale workflow specifically:** the won→property-status link (PF-22) and a working Google Calendar sync (PF-27) are the two gaps most specific to this product's domain, as opposed to generic CRM gaps.

**What requires external accounts or operational infrastructure:** a Meta WhatsApp Business account + access token for live messaging; an OpenAI API key for the one AI-assist fallback; a Google Cloud OAuth client **and new code** (not just configuration) for any real calendar sync, since none exists today; Railway/Postgres infrastructure items already tracked as INFRA-1…12 in the security audit.

**What is not yet verified in a real deployed environment:** everything in this audit was verified by reading code and by test/script execution evidence from the repository — no production system was accessed. The security audit's own `PRODUCTION-READINESS-CHECKLIST.md` already states plainly that release is **NOT CLEARED** pending 12 infrastructure items.

---

## 5. Recommended next steps (evidence-based, neutral backlog)

Grouped as requested; this is a punch list derived directly from the findings above, not a feature pitch.

**Correctness gaps**
- Make automation actions idempotent, or add per-(trigger, entity) dedup like the handoff system already has (PF-17).
- Wrap the `prisma.automation.findMany` lookup in `runAutomations` in a try/catch so a DB hiccup there can't 500 an otherwise-successful mutation (PF-18).
- Reconcile the two dashboard metric code paths so they can't drift (PF-29).
- Pick one audit convention for soft-delete across Lead/Contact/Account (PF-05) and one authoritative path for `Lead.stage = CONVERTED` (PF-06).

**Missing core functionality**
- Build create/edit/delete UI for Contacts and Accounts (PF-01, PF-02) — the backend is ready.
- Build a manual task-creation UI and a "log activity"/note UI (PF-04, PF-26, PF-03) — same situation.
- Add a won-deal → Property-status update, and a lost-reason capture UI (PF-22, and the "lost" half of #6).
- Add calendar event edit/complete/cancel/delete UI — the API already supports it (PF-28).
- Add a member-invitation flow (PF-32).

**Usability improvements**
- Surface the AI review/approval workflow and the 3 orphaned intelligence report types in the lead/opportunity UI (PF-11), or retire them if they're not wanted.
- Show per-row CSV import detail (invalid/duplicate reasons) instead of just counts (Workflow 5).
- Add pagination/filtering to the audit trail UI to match its own API (PF-31).
- Make leads-list search/filter server-side so it isn't capped at the first 100 leads (PF-08).

**Integrations**
- Decide whether Google Calendar sync is still wanted; if so, it needs real implementation (OAuth + API calls), not configuration — none of the scaffolding currently does anything (PF-27).
- Decide whether real LLM-based intelligence (beyond the one WhatsApp fallback) is a goal; today's deterministic engines are solid but are not what "AI-powered" might imply to a buyer or investor (PF-09).

**Later / scalability**
- Add automation-authoring and pipeline-stage-configuration UI if multi-workspace customization becomes a goal (PF-15, PF-20).
- Add test coverage for scoring, matching, AI templates, and insights math before building more on top of them (PF-13, PF-30).
- Revisit the 12-second notification poll if concurrent-user counts grow (PF-19).

---

## 6. What this audit proves, and how to use it

**It proves:** exactly what the current codebase does, with file-and-line evidence for every claim, independently re-derived by five separate reviews that each read the relevant source files in full rather than inferring behavior from naming or documentation. Where a claim couldn't be backed by code or test evidence, it's marked unverified rather than assumed.

**It does not prove:** that any of this has been exercised against a live, deployed production environment with real customers, a real Meta WhatsApp Business account, or a real payment/e-signature system — none of those exist in this build. It also does not include a security re-audit; rely on the four existing `docs/security/*.md` documents for that, which were themselves verified against a live attack harness.

**How to use the feature tree for planning:** treat every node marked 🟢 V as safe to build on top of. Treat 🟠 PI nodes as "cheap wins" — in nearly every case the hard part (a validated, workspace-isolated, audited API) is already done, and what's missing is only the UI. Treat 🔴 NI and 🟣 DS nodes as places where the product's current behavior may not match what the name promises — worth a deliberate decision (build it for real, or adjust the claim) rather than an assumption either way.
