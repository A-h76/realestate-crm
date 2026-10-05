# Current-State Capability Audit (against the US Lead-to-Sale blueprint)

> **Historical record.** It describes the codebase as it was before the US-market conversion, so it still mentions the retired Pakistan market (PKR, MARLA/KANAL, Zameen, Roman Urdu). Those references are intentional context, not current behaviour.

Audit date: 2026-10-04. Branch `main`, working tree with **175 uncommitted changes** (112 modified files, +2,840/−1,262) on top of commit `cf3895a`. Findings describe the working tree, not the last commit.

## 0. Method and limits

**Directly verified this session:** `npm test` → **689 tests, 129 suites, 689 pass, 0 fail** (exit 0; tests run against a real Postgres); Prisma schema (all 1,013 lines); `webhooks/whatsapp.ts`, `conversation-orchestrator.ts`, `leads/identity.ts`, `leads/take-over.ts`, `handoff-event.ts` (head), provider mode/factory files, calendar provider, `authz.ts`, `invite-member.ts`, scheduled-automation script and doc, sidebar, `railway.json`, `env.ts` (head); grep sweeps for consent/opt-out and for Google/OAuth code.

**Relied on, not re-derived:** the existing audit `docs/product/CRM-CURRENT-STATE-AUDIT.md` (dated 2026-10-02) and `docs/security/*` (security audit dated 2026-09-27, "live attack harness 54/54"). Several of that audit's findings are **already stale** because of the uncommitted work (§2). Treat its remaining items as *probable*, not confirmed.

**Not done:** typecheck/lint/production build were not re-run; no browser/responsive QA; no deployed environment, Railway, Meta, or database-infrastructure access; no real provider traffic. Anything that needs those is marked accordingly.

Status legend: **IV** Implemented and verified · **IT** Implemented but insufficiently tested · **PI** Partially implemented · **MP** Mocked or placeholder · **MS** Missing · **BE** Blocked by external provider/config · **PD** Requires product decision.

## 1. Headline findings

1. **The product is a Pakistan market product.** Market assumptions (PKR, MARLA/KANAL, `+92`, Zameen, Lahore, Karachi TZ, Roman-Urdu) are embedded in schema enums, validators, matching, copy, and the sidebar ("Real Estate CRM · Pakistan"). 22 source files reference them. US launch requires a market-layer rewrite, not configuration.
2. **There is no consent, opt-out, or suppression model anywhere.** Grep for consent/opt-out/STOP/TCPA across `src/` finds nothing relevant (matches are CSV/"duplicate" noise). The AI conversation engine replies to every non-handoff inbound message without any consent, hours, frequency, or opt-out check. For US SMS this is a **P0 blocker**.
3. **The AI is deterministic rules with one optional LLM fallback.** `conversation-intelligence.ts` + `extract-requirement.ts` are regex/rule based; OpenAI (`gpt-4o-mini` default) is only called when intent is UNKNOWN and nothing was extracted. Honest and testable, but not "AI qualification" in the market's sense, and English-/Roman-Urdu-specific.
4. **Conversation and AI/human ownership are weak.** No `Conversation` entity (a string `lead:<id>` is the conversation key). "Human took over" is an Activity row with `metadata.conversationTakeover=true`; once set, auto-reply is **permanently** suppressed ("deliberately no release"). The check-then-send in `runConversationTurn` (`hasHumanTakenOver` → provider send) is **not atomic**: a take-over committed between the check and the send can still produce an AI message. No return-to-AI.
5. **No durable job system.** Auto-replies run inline in the webhook request; the only scheduled work is one daily inactive-lead script that must be wired to a Railway cron manually (not done by the repo). No outbox, retry/backoff queue, dead-letter view, or scheduled message sends.
6. **Reporting cannot answer the core questions.** No `firstResponseAt`, no time-to-first-response, no sent/delivered/replied funnel per lead, no follow-up completion metric, no source-to-stage attribution beyond the `LeadSource` enum. `insights.ts` has a WhatsApp "response rate" and funnel counts only.
7. **Security and tenancy foundations are strong** (RBAC re-checked from DB per request, revocable sessions, rate-limit buckets in Postgres, HMAC webhook verification, CSP with nonce, tenant-isolation tests, health check). These are the main reusable assets.
8. **Integration status is mostly honest** (WhatsApp mode machine: live / misconfigured / demo / disabled; calendar is explicitly internal-only) but "live" means *env vars present*, not *verified connection* — the sidebar lamp lights on configuration, not on a successful handshake.

## 2. Findings in the prior audit that are now resolved in the working tree

| Prior finding | Now | Evidence |
|---|---|---|
| PF-22 won deal doesn't update property status | Fixed: Won → SOLD/RENTED, reverse on un-win; hand-set RESERVED/WITHDRAWN respected | `src/lib/leads/convert-on-won.ts:11-14,69-70`; `tests/security/property-status-sync.test.ts` |
| PF-06 no duplicate detection | Fixed for leads: per-phone/email advisory locks, canonical phone match | `src/lib/leads/identity.ts`; `tests/security/lead-dedup.test.ts` — **but PK-phone-only** |
| PF-27 Google Calendar pseudo-integration | Removed; calendar declared internal, `isDemo=true` always | `src/lib/providers/calendar/index.ts` (INTG-012) |
| PF-32 no member invitation | Built: one-time 72h hashed link, **no email delivery** (link handed over manually) | `src/lib/workspace/invite-member.ts`; `tests/security/invite-member.test.ts`; `/accept-invite` |
| PF-17 non-idempotent automations | Addressed: `dedupeKey` on Task/Notification, migration `20261004000000_automation_idempotency` | schema `Task.dedupeKey`, `Notification.dedupeKey`; `tests/security/automation-idempotency.test.ts` |
| PF-16 inactive sweep never runs | Script + advisory lock exist; **still requires a manual Railway cron** | `scripts/run-inactive-lead-automations.ts`, `docs/ops/SCHEDULED-AUTOMATIONS.md` |
| Opportunity concurrency | Tested | `tests/security/opportunity-concurrency.test.ts` |
| Dashboard drift | Tested | `dashboard-api.test.ts`, `pipeline-metrics.test.ts` |

Still presumed open (not re-verified): contact/account/note/manual-task authoring UI gaps (PF-01–04, PF-26), pipeline-stage CRUD (PF-20), server-side lead-list filtering (PF-08), calendar-event edit/cancel UI (PF-28), AI review UI (PF-11). A grep of `method: "POST"` in `(app)` pages finds create actions only for calendar, opportunities, proposals, settings, and CSV; none for contacts, accounts, tasks, notes — consistent with the prior audit.

## 3. Capability matrix

Columns: capability · status · evidence · limitation / gap for the US product · how to verify.

### 3.1 Platform and security

| Capability | Status | Evidence | Gap | Verification |
|---|---|---|---|---|
| Auth (credentials), session, revocation | IV | `lib/auth.ts`, `session-hardening.test.ts`, security audit | **No self-signup, email verification, password reset, MFA, SSO** (invite only) | Tests; add signup tests when built |
| Workspace isolation | IV | `lib/tenant.ts`, `tenant-isolation*.test.ts`, `leakage.test.ts`, `workspace-integrity.ts` | Background jobs/reports/search isolation tested only where those suites touch them | Extend suite to every new job/import/export |
| RBAC (OWNER/ADMIN/MANAGER/AGENT/VIEWER) | IV | `authz.ts`, `rbac*.test.ts` | Roles are global-per-workspace; no team/territory scoping ("agent sees only own leads" absent) | `rbac-http.test.ts` |
| Audit log | IV (writes) / PI (UX) | `AuditLog`, `writeAudit`; ~47 action enums | Not tamper-evident; DB role can UPDATE/DELETE (INFRA-5 unverified); no AI/consent/send events | Audit assertions in tests |
| Rate limiting | IV | `RateLimitBucket`, `rate-limit.test.ts` | Postgres-bucket cost under load unmeasured | perf scripts |
| Webhook auth + idempotency (WhatsApp) | IV | HMAC `verifyHubSignature256`; `WebhookEvent` unique key claimed inside lead transaction; out-of-order status guard `STATUS_MOVES_FROM` | Provider-specific; SMS/email/forms need equivalents | `webhook*.test.ts` |
| Health check, env validation, structured logs | IV | `lib/health.ts`, `lib/env.ts`, `env-validation.test.ts`, `security-log.test.ts` | No alerting/metrics backend verified | Deployed smoke |
| Backups / restore | BE | `DISASTER_RECOVERY.md`; INFRA-3/4 "NOT VERIFIED" | Release status in repo docs: **NOT CLEARED** | Restore drill on production-like data |
| Infra items INFRA-1…12 | BE | `docs/security/PRODUCTION-READINESS-CHECKLIST.md` | All unverified | Operator checklist |

### 3.2 Lead lifecycle

| Capability | Status | Evidence | Gap | Verification |
|---|---|---|---|---|
| Lead create (manual/CSV/WhatsApp) | IV | `leads/create-lead.ts`, csv + webhook tests | Only 8 `LeadSource` values, all PK-oriented (ZAMEEN, SIGNBOARD…); **no web form, email-parse, ad-form, or API-key endpoint** | Add ingestion tests |
| Duplicate handling | PI | `identity.ts`, `lead-dedup.test.ts` | PK phone canonicalisation only; no merge UI, no uncertain-match review queue; no Contact-level identity (Lead holds identity) | Unit tests for US E.164 |
| Lead ↔ Contact ↔ Account | PI | schema (`Lead.contactId`, `accountId`) | Lead stores name/phone/email itself *and* optionally links a Contact → duplicate identity. Account is B2B-shaped (company/industry/size) — wrong for US residential | PD-04 |
| Assignment | PI | `assign-lead.ts` (least-loaded), manual assign route | No rules (geo/source/hours/availability), no round-robin, no fallback/escalation, no SLA timer, no assignment history table (only audit) | New tests |
| Lead stage (NEW…ARCHIVED) | PI | `LeadStage`, `lead-stage-control.tsx` | Dual path to CONVERTED partially unified; no qualification stage logic; no lost/disqualified reason on Lead | State-machine tests |
| Qualification data model | PI | Lead pref fields (`budgetMin/Max`, `bedroomPref`, `preferredArea`, `timeline`) | No provenance, confidence, "missing info", consent; fields use `sizeUnitPref` MARLA/KANAL; no buyer/seller/renter-specific requirements; no per-field audit | PD / design |
| Lead scoring | IV (logic) | `scoring/score-lead.ts`, `lead-scoring.test.ts` | Heuristic; weights tuned for PK; must not be presented as predictive | Unit |
| Property matching | IT→IV | `matching/properties.ts`, `property-matching.test.ts` | One blended score (no hard-constraint stage vs ranking stage split documented/enforced); area match = substring + DHA-specific hack; no staleness/verification gating beyond status | Rewrite per REQ-INV |
| Next best action | IT | `automation/next-best-action.ts` | Only computed on lead page; no queue ("Today" view) | Tests |

### 3.3 Messaging and AI

| Capability | Status | Evidence | Gap | Verification |
|---|---|---|---|---|
| WhatsApp inbound webhook | IV | `webhooks/whatsapp.ts`, `webhook-flow.test.ts` | Text only; non-text stored as placeholder; US value low | Tests |
| WhatsApp outbound live | BE | `providers/whatsapp/business.ts` (graph.facebook.com) | Free-form text only; **no template-message support / 24-hour window logic** → sends outside window will fail at Meta; delivery states only via webhook | Sandbox against Meta |
| SMS / email / voice | **MS** | no provider code | Core US channels absent | n/a |
| Inbox | IV (WhatsApp) | `whatsapp/inbox*.ts`, `whatsapp-inbox.test.ts` | WhatsApp-only; no unified channel model; no filters beyond basic; no internal-note distinction in thread; no composer lock | New |
| Conversation model | **MS** | `conversationId = "lead:<id>"` string | No Conversation entity: no status, channel, assignee, lock, SLA, per-channel threads | PD-05 |
| Human handoff | IV (detection+task) / PI (control) | `detect-handoff.ts`, `handoff-event.ts`, `take-over.ts`, `take-over-http.test.ts` | Not atomic with AI sends (§1.4); permanent; no return-to-AI; no reassign-on-timeout; handoff persistence relies on task description tag `[handoff:REASON]` (string-matching) | Concurrency tests |
| AI conversational engine | IV (rules) / BE (LLM) | `conversation-orchestrator.ts`, `conversation-intelligence.ts`, `conversation-flow.test.ts` | No consent/hours/frequency gates; no policy/prompt versioning for the rule engine; reply languages = English/Roman-Urdu; LLM only as fallback; **no fair-housing guardrails**, no replayable execution log | Red-team suite |
| `IntelligenceRun` (AI artefacts) | PI | model has `promptVersion`, `confidence`, status/review | Outputs are templates (PF-09); review workflow API-only | Tests |
| Demo/simulated messaging | MP (by design) | `demo.ts` providers, `simulate-inbound` routes | Gated by Demo Mode; ensure never visible in prod UI | `demo-mode.test.ts` |

### 3.4 Automation, tasks, calendar, pipeline, reporting

| Capability | Status | Evidence | Gap | Verification |
|---|---|---|---|---|
| Automation engine | IV (9 seeded rules; idempotent) | `automation/engine.ts` (662 lines), tests | Action set = CREATE_TASK, RUN_AI_ANALYSIS, RUN_SCORING, RUN_PROPERTY_MATCH, NOTIFY. **No send-message, wait, branch, stop-condition, business-hours, sequence** | New engine |
| Durable jobs / scheduler | PI | daily script w/ advisory lock | No queue, no retries beyond "next day", cron not wired in repo | Deployed cron + job table |
| Tasks | PI | `Task` model, `tasks-client.tsx` complete/start | No manual create UI; no overdue escalation; no suggested-vs-done distinction; no cancel-on-condition | Tests |
| Calendar / showings | MP→PI | `CalendarEvent` (type SITE_VISIT…), internal only | No OAuth/availability, no confirmation flow, no reminders, no no-show/feedback, no idempotency key, edit/cancel UI absent | Provider sandbox |
| Pipeline / opportunities | PI→IV | `PipelineStage`, `Opportunity`, board+table, concurrency tests | Stages not configurable (no CRUD); buy-side/sell-side only (`DealSide`), no renter; lost reason is free text; no required-field gates; DnD (`@dnd-kit`) — keyboard-accessible stage change not verified | A11y test |
| Proposals | PI | `Proposal` model | Acceptance/view are self-reported (explicitly labeled). US replacement = offers/contracts, not "proposals" | PD |
| Dashboard | IV | `/api/dashboard`, tests | Not an operational "Today" view; no definitions doc | Metric tests |
| Reports | IT | `insights.ts`, `reports/page.tsx` | Missing response-time, follow-up completion, leakage; formulas undocumented | Metric spec tests |
| Notifications | IV (in-app, 12 s poll) | `notifications.ts` | No email/SMS/push to agents → an agent who isn't in the app **is never told** about a new lead | Add channel |

### 3.5 Data, migration, compliance

| Capability | Status | Evidence | Gap |
|---|---|---|---|
| CSV import | IV (insert) | `csv/leads.ts`, `csv*.test.ts` | Leads only; no mapping UI, dry-run, reconciliation, external-ID provenance, source-system presets, contacts/activities/notes |
| CSV export | IV | route + tests | No export audit trail beyond `CSV_EXPORTED`; no PII-export controls |
| Consent / suppression / retention | **MS** | — | Entire model |
| Data subject access/deletion | **MS** | — | Soft delete (`deletedAt`) only; no purge job |
| Billing/usage | **MS** | — | No metering of AI/SMS usage |
| Multi-provider integration framework | **MS** | Only `WhatsAppIntegration` (phoneNumberId) | No generic `IntegrationConnection` with state machine |
| Listing feed / IDX / MLS | **MS** | — | Inventory is manual/CSV (`Property`); no source/verification timestamp (`lastPriceUpdate`, `verificationStatus` exist but not sync-driven) |

## 4. Reusable assets vs rewrite list

**Keep & extend:** tenancy/RBAC/session/audit/rate-limit/health/env validation; webhook claim-then-process pattern; advisory-lock identity serialisation; `dedupeKey` idempotency pattern; handoff detection concepts; inbox UI shell; pipeline board; test harness (`tests/helpers/http.ts`: tenants, role actors, HTTP-boundary calls).

**Rewrite / replace for US:** property model (type/units/currency/location), phone/E.164 and US address handling, lead sources, copy/locale, matching staged algorithm, conversation engine language layer, notification channels, workspace defaults (USD, `America/*`).

**Build new:** consent+suppression, Conversation entity + lock, durable job/outbox, SMS+email providers, ingestion endpoints (form/email/API), integration-connection framework, response-time/sequence/metric events, onboarding, import wizard, AI policy/logging layer.

## 5. Risks surfaced by the audit

| # | Risk | Severity |
|---|---|---|
| R1 | AI/automation sends with no consent/opt-out/time-of-day/frequency check (legal exposure when SMS is added) | Critical |
| R2 | Non-atomic AI-vs-human send race; take-over irreversible | High |
| R3 | No notification outside the app → slow response regardless of automation | High |
| R4 | Uncommitted work: 175 changes unreviewed; risk of losing or shipping unreviewed changes | High |
| R5 | "Live" status derived from env presence, not a verified connection | Medium |
| R6 | Reporting math lacks response/follow-up truth; any ROI claim would be unsupported | Medium |
| R7 | PK assumptions leak into US data (e.g., `+92` fallback in webhook phone normalisation: `normalizePkPhone(...) ?? "+" + digits`) | Medium |
| R8 | Release status "NOT CLEARED" with 12 unverified infra items | High (for any production pilot) |

## 6. Recommended immediate action before design work proceeds

1. Review and commit (or split into reviewed commits) the 175 working-tree changes so the baseline is stable. 2. Decide D-01 (do we fork a US product line from this chassis, or retire the Pakistan product?). 3. Run typecheck/lint/build to confirm the green baseline matches the green tests.
