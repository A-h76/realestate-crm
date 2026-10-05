# Implementation Backlog (ordered, dependency-aware)

Each item is small enough to implement and verify alone. Format: **ID** — task · deps · verify. Sizes: S ≤ 2 d, M ≤ 1 wk, L ≤ 2 wk. Follow the repo rule (AGENTS.md): **read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code**; this Next version (16.x) differs from older conventions. Do not start before D-01 and D-22 are closed ([decisions](./PRODUCT_DECISION_REGISTER.md)). Test IDs refer to [ACCEPTANCE_TEST_PLAN](./ACCEPTANCE_TEST_PLAN.md).

## Epic 0 — Baseline (do first)
- **B-001 (S)** Review and commit/split the 175 pending working-tree changes into logical commits; no behavior change. Verify: `npm test` 689 pass, typecheck, lint, build.
- **B-002 (S)** Add CI workflow (tests with Postgres service, typecheck, lint, build, `npm audit --audit-level=high`). Dep: B-001. Verify: CI green on main.
- **B-003 (S)** Run and record restore drill from existing `DISASTER_RECOVERY.md` against a scratch DB; store evidence. Verify: written record.
- **B-004 (S)** Operator closes INFRA-1…12 checklist items with evidence (non-code). Verify: checklist updated.

## Epic 1 — Market layer (US)
- **M-001 (M)** Add `Workspace.country/region` and US defaults (USD, `America/*` TZ); remove PK defaults from schema/validators/seeds; migrate existing workspaces without data loss. Dep: D-01. Verify: migration test on copy; T-UX-06 grep gate.
- **M-002 (S)** E.164 phone library (use a maintained lib such as libphonenumber-js — new dependency, justify in PR) replacing `normalizePkPhone`; fix webhook fallback `"+"+digits`. Verify: unit tests US/CA numbers, extension/invalid cases; `lead-dedup` tests updated.
- **M-003 (M)** US Property model: type enum, beds/baths/sqft, address parts, status, `lastVerifiedAt`, `source`; drop MARLA/KANAL from matching. Verify: matcher unit tests (T-AI-02 properties).
- **M-004 (S)** Replace `LeadSource` enum with `LeadSource` table (workspace-configurable) + data migration mapping. Verify: migration test; CSV import still maps.
- **M-005 (S)** Copy/branding cleanup (sidebar, Roman-Urdu reply templates → English baseline, date/currency formatting). Verify: T-UX-06.

## Epic 2 — Identity: Contact/Lead split
- **I-001 (M)** `ContactIdentity` table with unique `(workspaceId,type,valueNormalized)`; backfill from Lead/Contact phone/email. Dep: M-002. Verify: backfill report; duplicate rows listed not merged.
- **I-002 (L)** Move person fields from Lead to Contact (keep legacy columns read-compatible for one release); update create-lead, webhook, CSV, APIs, UI. Dep: I-001. Verify: existing lead/webhook/csv tests adapted and green; T-IDM-03.
- **I-003 (M)** `LeadInquiry` + repeat-inquiry rule (open lead attach vs new lead after terminal/90 d). Verify: scenario tests.
- **I-004 (M)** `DuplicateCandidate` queue + review UI + merge with snapshot/undo. Verify: T-DUP-01.

## Epic 3 — Consent and Send Gate (blocks all outbound)
- **C-001 (M)** `ConsentRecord`, `Suppression` tables + permissions (`consent:manage`). Verify: unit/RBAC tests.
- **C-002 (M)** `evaluateSendGate()` pure function + `enqueueOutbound()` as the only insert path to `OutboxMessage`; static test forbidding other inserts. Dep: C-001, V-001. Verify: T-CNS-04/05/07.
- **C-003 (M)** Inbound opt-out processor (keywords, priority job, confirmation, cancellations). Dep: J-001. Verify: T-CNS-02/06.
- **C-004 (S)** Import/API/bulk paths use suppression-preserving writer. Verify: T-CNS-03.
- **C-005 (S)** Recipient-local quiet hours (area-code/ZIP → TZ table) + state override config. Verify: T-CNS-05.

## Epic 4 — Conversation, outbox, jobs
- **V-001 (L)** `Conversation` entity (+ `controlMode/controlVersion`) replacing `lead:<id>` string; `Message` migration from `WhatsAppMessage`; inbox queries updated. Dep: I-002. Verify: existing inbox/webhook tests adapted; T-CON-02.
- **J-001 (L)** `Job` table + worker service (`SKIP LOCKED`, leases, backoff, DEAD) + `start:worker` script + Railway service config. Verify: T-JOB-01/02 with killed worker test.
- **J-002 (M)** `OutboxMessage` dispatcher with provider idempotency keys and status reconciliation. Dep: J-001, C-002. Verify: T-MSG-01, T-REL-01.
- **J-003 (M)** Move webhook post-processing (conversation turn, notifications, automations) from inline to jobs; webhook acks after persist. Dep: J-001. Verify: webhook p99 ack < 1 s; flow tests.
- **J-004 (S)** Admin "Failed automations/Jobs" page + oldest-pending metric + alert hook. Verify: T-REL-03.
- **V-002 (M)** Claim/return-to-AI endpoints with version check and pending-job cancellation. Dep: V-001, J-001. Verify: T-CON-01 randomized interleavings.
- **V-003 (M)** `Handoff` table replacing task-description tags; escalation chain timers. Dep: J-001. Verify: handoff persistence tests; Journey D.

## Epic 5 — Capture, routing, notifications
- **K-001 (M)** `LeadIntake` raw log + `/api/v1/leads` (API key per source, zod, rate limit) + processing job. Dep: J-001, I-002. Verify: T-CAP-01/02.
- **K-002 (M)** Hosted/embeddable web form with bot protection and consent-text capture. Dep: K-001, C-001. Verify: E2E form → lead.
- **K-003 (M)** Email-forward intake with parser framework + 2–3 named templates + "Unparsed" queue. Dep: K-001, P-002. Verify: fixture emails; unknown format NEEDS_REVIEW.
- **K-004 (M)** `RoutingRule` engine (conditions, round-robin cursor in tx, availability, caps, fallback, SLA timers). Verify: T-RTE-01, T-CAP-03.
- **K-005 (M)** Agent notifications via SMS/email/push (preference + test button + retry/escalation). Dep: P-001/P-002, J-001. Verify: T-NTF-01.

## Epic 6 — Providers and integration framework
- **P-000 (S, start day 1)** Submit 10DLC brand/campaign, buy number, configure email domain auth, start Google OAuth verification. Non-code, long lead.
- **P-001 (L)** SMS provider adapter (send, receive, status webhooks with signature validation + idempotency, STOP passthrough). Dep: D-03, J-002.
- **P-002 (M)** Email provider adapter (send, inbound parse, bounces/complaints → suppression). Dep: D-03.
- **P-003 (M)** `IntegrationConnection` + health checks + states + diagnostics page; sidebar lamps read from it (not env). Verify: T-MSG-02/03.

## Epic 7 — Accounts, onboarding
- **A-001 (M)** Self-signup, email verification, password reset, invite emails (existing token logic). Dep: P-002. Verify: auth tests, rate limits.
- **A-002 (M)** Setup checklist engine with machine-checkable criteria + go-live gate + human-only mode banner. Dep: P-003, K-001. Verify: Journey A E2E.
- **A-003 (S)** Deactivate-with-reassignment wizard (single transaction). Verify: Journey J tests.

## Epic 8 — Today, reporting
- **R-001 (M)** `firstResponseAt/By` capture from verified SENT events; `ReportEvent` fact table. Dep: J-002. Verify: T-LCY-01, T-RPT-02.
- **R-002 (M)** Metric catalog doc + implementation for TTFR, unassigned dwell, follow-up completion, handoff backlog with drill-downs. Verify: T-RPT-01/03.
- **R-003 (M)** Today screen (agent + manager bands). Dep: R-002, V-003. Verify: T-UX-02/03.
- **R-004 (S)** Server-side lead list filters/pagination/saved views (replace client-side cap). Verify: scale test 50k leads.

## Epic 9 — AI (DRAFT first)
- **AI-001 (M)** `AiAgentConfig` versions + `AiExecution` log + kill switch. Dep: V-001.
- **AI-002 (M)** US extractor baseline (beds/baths/price/city/ZIP/timeframe) with provenance fields (`QualificationField`). Dep: I-002. Verify: T-AI-01 golden set v0.
- **AI-003 (M)** Policy classifier v1 (steering, legal/financial, negotiation, PII) + refusal templates + claim checker. Verify: T-AI-04/05 on rules layer.
- **AI-004 (M)** Draft workflow UI (approve/edit/discard) + AI state banner in composer. Dep: V-002, AI-001.
- **AI-005 (M)** Two-stage matcher (hard constraints + ranking + exclusion reasons) with staleness gate. Dep: M-003. Verify: T-AI-02/03.
- **AI-006 (L, P1)** LLM extraction/drafting through validation pipeline + eval suite in CI. Dep: AI-003.
- **AI-007 (S, P1)** AUTO enablement checks (prereq checklist, evaluated-version check). Dep: AI-006, C-002, P-003.

## Epic 10 — Follow-up engine, showings, pipeline (P1)
- **F-001 (L)** Sequences/enrollments with execution-time stop conditions, business hours, approvals. Dep: J-001, C-002.
- **S-001 (M)** Showing entity + internal workflow + reminders (consent-checked). Dep: J-001.
- **S-002 (L)** Calendar OAuth (Google, then Microsoft), availability, event create with idempotency, sync states. Dep: P-000 verified.
- **L-001 (M)** Pipeline stage CRUD + transition guards + required fields + accessible "Move to…". Verify: T-PIP-01/02/05.

## Epic 11 — Compliance/security hardening
- **H-001 (M)** DSAR export/delete with minimal suppression retention; retention jobs. Verify: scenario tests.
- **H-002 (M)** Secrets envelope encryption for integration tokens; log-PII scan test (T-SEC-03/04).
- **H-003 (M)** MFA (TOTP) + breached-password check.
- **H-004 (M)** RLS on new tables; tenant matrix test generator (T-ISO-01).
- **H-005 (S)** Incident-response and provider-outage runbooks; alert definitions.
- **H-006 (S)** Schedule third-party pen test before first production pilot.

## Epic 12 — Migration (P2)
- **X-001 (M)** `ImportJob/ExternalRef/ImportChange` + resumable batch importer + dry-run. **X-002 (M)** Mapping UI + presets. **X-003 (M)** Staging workspace + sample import. **X-004 (M)** Reconciliation report + rollback. **X-005 (M)** FUB preset + companion integration (D-06). Verify: T-IMP-01…07.

## Suggested first ten, in order
B-001 → B-002 → P-000 (parallel, non-code) → M-001 → M-002 → I-001 → C-001 → V-001 → J-001 → C-002. Rationale: stabilize, start external lead times, then lay identity/consent/conversation/job foundations that every later feature depends on.
