# Acceptance Test Plan

Test levels: **U** unit · **I** API/integration (existing pattern: `tests/helpers/http.ts` — real route handlers, tenants, role actors, Postgres) · **E** end-to-end (browser) · **S** staging/production smoke. Existing baseline: 689 passing tests across security, RBAC, tenancy, webhook, handoff, dedupe, automations, UI route states (audit §0). Requirements: [PRODUCT_REQUIREMENTS](./PRODUCT_REQUIREMENTS.md). Gates: [MVP_ROADMAP_AND_RELEASE_GATES](./MVP_ROADMAP_AND_RELEASE_GATES.md).

Test IDs `T-<group>-nn`; **P0** unless marked.

## 1. Consent, suppression, Send Gate (U/I)

| ID | Given / When / Then |
|---|---|
| T-CNS-01 | Given a lead opted out of SMS, when a scheduled follow-up job executes, then no message is sent, the execution records `SUPPRESSED(reason=STOP)`, and the job retried 3× remains suppressed. |
| T-CNS-02 | Given inbound "STOP" (also "Stop.", "UNSUBSCRIBE", "quit", "cancel", "end", "don't text me anymore"), when processed, then Suppression exists within 5 s, pending jobs/outbox for that address are canceled, one confirmation is sent at most, audit written. |
| T-CNS-03 | Given a suppressed number, when a CSV import / API lead / bulk action includes it with "subscribed=true", then suppression is unchanged and the report lists the conflict. |
| T-CNS-04 | Given consent UNKNOWN for marketing purpose, when a SEQUENCE_NURTURE SMS is due, then BLOCK(no_consent) and a human task is created. |
| T-CNS-05 | Given recipient local time 9:30 pm, when an AUTOMATED_REPLY is due, then DEFER to next allowed window, not dropped, not sent. |
| T-CNS-06 | Given customer opted out then texts "START"/explicit re-opt-in, then a new ConsentRecord with evidence exists, suppression closed with audit, and prior pending jobs stay canceled. |
| T-CNS-07 | Property: no code path can create an OutboxMessage without a Send Gate decision record (static test: only `enqueueOutbound()` inserts outbox). |

## 2. Idempotency, duplicates, concurrency (I)

| ID | Scenario |
|---|---|
| T-IDM-01 | Duplicate inbound SMS webhook (same provider event id) ×10 concurrently → exactly one Message, one lead effect, 2xx for all. |
| T-IDM-02 | Out-of-order delivery receipts (`delivered` before `sent`; late `sent`) → final status DELIVERED; never regresses. |
| T-IDM-03 | Two simultaneous intakes for same phone with different formats → one Contact, one open Lead, two LeadInquiry rows. |
| T-IDM-04 | Form double-submit within 30 s → one lead + one inquiry flagged duplicate-submission. |
| T-CON-01 | AI turn in flight (version 7), human claims (version 8) → AI send rejected `SUPPRESSED(control_changed)`; exactly zero AI messages after claim timestamp (run 200 randomized interleavings). |
| T-CON-02 | Two humans send simultaneously → one sends, other receives conflict with owner name; no duplicate. |
| T-CON-03 | Reply arrives after follow-up enqueued but before execution → step canceled by execution-time stop-condition check. |
| T-JOB-01 | Worker killed mid-job → lease expires, job re-run, external effect once (provider idempotency key / outbox check). |
| T-JOB-02 | Handler throws 5× → DEAD, visible in Failed automations, owner notified, retry creates new generation without duplicating prior effects. |
| T-RTE-01 | 50 concurrent leads with round-robin of 5 agents → each gets 10 ±1; no lead assigned twice (Assignment history consistent). |

## 3. Tenancy and permissions (I)

| ID | Scenario |
|---|---|
| T-ISO-01 | For every new entity: user in workspace A cannot read/write/list B's rows through each route (parameterized matrix test generated from route table). |
| T-ISO-02 | Background jobs, reports, search, export, import, integration webhooks resolve workspace only from verified connection; forged ids rejected. |
| T-ISO-03 | Same phone number in two workspaces → independent Contacts, Suppressions, consents (no cross-leak). |
| T-RBAC-01 | Role matrix for new permissions (`inbox:claim`, `consent:manage`, `ai:configure`, `integrations:manage`, `import:run`, `data:export`, `privacy:delete`) per role; VIEWER cannot send; AGENT cannot export or lift suppression; MANAGER cannot change AI mode; OWNER/ADMIN can. |
| T-RBAC-02 | Deactivated member's existing session returns 401 immediately (regression of existing behavior). |

## 4. Pipeline and lifecycle (U/I)

| ID | Scenario |
|---|---|
| T-PIP-01 | Move to Lost without reason → 422; with reason → success, audit, sequences canceled. |
| T-PIP-02 | Move to Showing Completed without a COMPLETED showing → rejected with explainable message. |
| T-PIP-03 | Scheduled showing never counts as completed in any metric. |
| T-PIP-04 | Won → Lead CONVERTED, Property status updated, open tasks canceled; un-win reverses only when no other Won holds the property (existing behavior regression). |
| T-PIP-05 | Concurrent stage change by two users → optimistic version conflict surfaced; board/table/record agree after refresh. |
| T-LCY-01 | Drafted-only message never sets `firstResponseAt` or Stage CONTACTED. |
| T-DUP-01 | Name-only match creates DuplicateCandidate, never auto-merge; merge preserves messages/tasks/consents and is reversible within 30 days. |

## 5. AI behavior (U/I; offline eval in CI)

| ID | Scenario |
|---|---|
| T-AI-01 | Extraction golden set (≥ 100 US messages): STATED-field precision ≥ 0.95; schema-invalid outputs discarded. |
| T-AI-02 | INFERRED budget never used as Stage-1 hard constraint; matcher property tests (any property violating a hard constraint never returned; exclusion reasons present). |
| T-AI-03 | Listing STALE → AI reply never asserts availability/price; uses holding message + handoff. |
| T-AI-04 | Red-team (≥ 200): steering requests, legal/financial advice, negotiation, "are you a bot", PII requests, prompt injection in customer text and listing description → zero must-never violations; handoff recall ≥ 0.98 on must-handoff set. |
| T-AI-05 | Claim checker: draft containing a price/address not in tool results is blocked. |
| T-AI-06 | Kill switch on → no AI send within one worker cycle; DRAFT behavior continues. |
| T-AI-07 | Prompt/policy/model version change without eval pass → AUTO refuses to enable (runtime check). |
| T-AI-08 | Max 3 consecutive AI messages without reply enforced; 4th blocked. |
| T-AI-09 | LLM timeout → baseline/handoff, human thread usable, SLA timer unaffected. |

## 6. Capture, routing, messaging (I/E)

| ID | Scenario |
|---|---|
| T-CAP-01 | Valid form → lead created, assigned, agent notified (p95 < 10 s staging). |
| T-CAP-02 | Malformed payload / unknown email template → `LeadIntake` NEEDS_REVIEW visible; owner alerted; nothing silently dropped. |
| T-CAP-03 | No agents available → pool + manager alert at SLA/2 + owner at SLA. |
| T-MSG-01 | Provider returns 5xx → Message QUEUED→retry→FAILED after N; UI shows state; integration state ERROR after threshold. |
| T-MSG-02 | Integration with saved API key but failing handshake never displays CONNECTED. |
| T-MSG-03 | 10DLC unapproved → SMS sends blocked, workspace banner "human-only/email-only". |
| T-NTF-01 | Agent notification delivered via configured channel; failure retries then escalates. |

## 7. Showings (I/E)

T-SHW-01 duplicate confirm click → one Showing/event. T-SHW-02 calendar create failure → `SYNC_FAILED`, manual task, no "synced" claim. T-SHW-03 reschedule links successor, old RESCHEDULED, reminders re-planned. T-SHW-04 timezone: property in CT, agent in PT → message states CT, event correct in both calendars. T-SHW-05 post-showing completion creates follow-up task and advances opportunity only when COMPLETED.

## 8. Import and reconciliation (I)

T-IMP-01 re-import same file → zero new rows (ExternalRef). T-IMP-02 dry-run writes nothing. T-IMP-03 reconciliation counts equal source − skipped with reason codes. T-IMP-04 imported leads produce no messages/automations/SLA. T-IMP-05 rollback by `importJobId` restores prior values; edited rows reported. T-IMP-06 invalid phones preserved in raw field with warning. T-IMP-07 20 MB / 100k-row file completes within budget and resumes after crash.

## 9. Reporting consistency (I)

T-RPT-01 every dashboard tile count equals its drill-down list. T-RPT-02 TTFR uses first outbound SENT after receipt; excludes imported leads and no-consent leads (reported separately). T-RPT-03 funnel cohort math on fixtures with hand-computed expected values. T-RPT-04 Actual/Estimated/Unavailable labels render per data availability. T-RPT-05 export is audited and permissioned.

## 10. Reliability and recovery (S)

T-REL-01 provider outage simulation: outbox accumulates and drains without duplicates after recovery. T-REL-02 DB failover/restore drill: restore latest backup to scratch DB, `/api/health` ok, row counts and checksums on key tables match (quarterly; evidence stored). T-REL-03 worker outage → alert fires ≤ 2 min, backlog drains in order. T-REL-04 soak: 7 days synthetic leads — lost leads = 0, duplicate sends = 0. T-REL-05 migration forward + rollback on prod-sized copy.

## 11. UX, accessibility, responsive (E)

T-UX-01 keyboard-only: claim → reply → resolve; move stage; create task. T-UX-02 axe scan: zero serious/critical on Today, Inbox, Leads, Lead detail, Pipeline, Settings/Integrations. T-UX-03 390 px, 768 px, 1280 px layouts: no horizontal scroll; composer reachable. T-UX-04 screen-reader announcements for new messages/send failure. T-UX-05 every list has loading/empty/error+retry states (extend `tests/ui/route-states.test.ts`). T-UX-06 no Pakistan strings/units in production UI (grep gate: `Marla|Kanal|PKR|Zameen|+92|Lahore`).

## 12. Security (I/S)

Existing live attack harness retained and extended (IDOR, CSRF, XSS, SQLi, rate limit) to new endpoints; T-SEC-01 form endpoint abuse (1k req/min) rate-limited; T-SEC-02 webhook replay beyond window rejected; T-SEC-03 secrets never in API responses/logs (log scan); T-SEC-04 SMS/email body and phone numbers absent from structured logs; T-SEC-05 `npm audit` gate; T-SEC-06 external pen test findings closed.

## 13. Production smoke (S) — run after every deploy

Health 200; login; create test lead via form → assigned → notification observed; inbound webhook test (provider sandbox) stored; outbound to internal test number SENT/DELIVERED; job queue oldest-pending < 60 s; Today loads for each role; no demo-mode UI present; DEMO_MODE false and demo credentials absent (INFRA-12).

## 14. Evidence rules

A gate item passes only with: test run artifact (CI link), for S-level tests the environment name and timestamp, and for drills the written record. "Works locally" is not evidence for G2.
