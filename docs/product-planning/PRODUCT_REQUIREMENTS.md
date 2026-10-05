# Product Requirements — US Lead-to-Sale CRM

Cross-references: entities/state machines → [SYSTEM_ARCHITECTURE_AND_DATA_MODEL](./SYSTEM_ARCHITECTURE_AND_DATA_MODEL.md); AI behavior → [AI_AGENT_BEHAVIOR_SPEC](./AI_AGENT_BEHAVIOR_SPEC.md); compliance → [US_MARKET_COMPLIANCE_AND_SECURITY](./US_MARKET_COMPLIANCE_AND_SECURITY.md); journeys → [USER_JOURNEYS_AND_WORKFLOWS](./USER_JOURNEYS_AND_WORKFLOWS.md); screens → [UX_AND_INFORMATION_ARCHITECTURE](./UX_AND_INFORMATION_ARCHITECTURE.md); tests → [ACCEPTANCE_TEST_PLAN](./ACCEPTANCE_TEST_PLAN.md); scope → [MVP_ROADMAP_AND_RELEASE_GATES](./MVP_ROADMAP_AND_RELEASE_GATES.md).

Conventions: requirement IDs `REQ-<area>-nn`; scope tags **P0** (pilot-blocking) · **P1** (win the niche) · **P2** (replacement) · **P3** (expansion). "Today" notes what exists in the repo (audit doc). Defaults are assumptions logged in the Decision Register (D-xx). Each area lists purpose, users, behavior, rules, AI role, states, audit, security, acceptance (see ACCEPTANCE_TEST_PLAN for Given/When/Then), and scope.

Global rules that apply to every area:
- **G1 Workspace scoping:** every query/mutation is scoped by `workspaceId` server-side; every new table carries `workspaceId`.
- **G2 No fake state:** nothing in the UI or reports may represent a simulated/unsent/unverified action as real. Statuses use the vocabulary in §Status vocabulary.
- **G3 Every state change is audited** with actor type (`USER|AI_AGENT|SYSTEM|WEBHOOK`), actor id, before/after, correlation id.
- **G4 Every automated outbound message passes the Send Gate** (REQ-CMP-01) — there is no code path to a provider that bypasses it.
- **G5 Four states for every async surface:** loading, empty, success, failure+retry.

### Status vocabulary (used in UI and reports)
Message: `DRAFTED → APPROVED → QUEUED → SENT (provider accepted) → DELIVERED (provider confirmed) → FAILED | UNDELIVERABLE | SUPPRESSED`; inbound: `RECEIVED`. "Contacted" = a human or AI message reached **SENT**, never DRAFTED. Appointment: `PROPOSED → CONFIRMED → COMPLETED | NO_SHOW | CANCELED | RESCHEDULED`. A calendar event is "created" only after the provider returns an event id. Integration: `NOT_CONNECTED | CONNECTING | CONNECTED | ACTION_REQUIRED | ERROR | DISCONNECTED`.

---

## REQ-ONB — Onboarding and workspace setup

**Purpose:** get a new agency from signup to first real lead handled in one sitting without configuring everything. **Users:** owner (primary), admin. **Today:** invite-only; no signup, verification, reset, wizard, or checklist (audit §3.1).

**Behavior (minimum path, target ≤ 30 min):**
1. Signup (email+password or Google OAuth [P1]) → email verification link (required before workspace creation, P0) → create workspace: agency name, time zone (IANA, default from browser; US zones list first), state(s) of operation (drives compliance defaults), currency fixed USD.
2. Invite team (skippable): email, role (Manager/Agent/Viewer); email delivered by transactional provider (Today: no email delivery exists — P0 gap).
3. Default pipeline auto-selected (buyer/seller/renter templates; editable later). Default routing: **round-robin among active agents**, fallback to owner.
4. Connect first lead source (website form snippet / email forwarding address / API key). Must produce a **test lead** that traverses capture→dedupe→assign→notify. Step is "done" only after a test lead is observed.
5. Connect messaging: SMS number (provisioned via provider; 10DLC brand/campaign registration status shown honestly — `ACTION_REQUIRED` until approved). Until approved, workspace operates in **human-only/no-send** mode and the checklist says so.
6. AI agent: choose **Draft mode (default)**; set business hours, tone, escalation contact; run **sandbox test conversation** (messages marked SANDBOX, never sent).
7. Go-live checklist (all mandatory items green): verified owner email; ≥1 agent; ≥1 lead source tested; routing tested; notification channel tested (agent receives SMS/email for new lead); messaging connected *or* explicitly "human-only"; consent policy acknowledged; AI mode chosen.
**Advanced (deferred, optional):** calendar connection, inventory import/feed, contact/lead import (see REQ-MIG), team structure/territories, custom pipelines, SSO.
**Rules:** every integration card shows a real state (vocabulary above); API key saved ≠ Connected. "Next recommended step" is a computed value, not static copy. Checklist items have machine-checkable completion criteria; they cannot be dismissed, only "deferred with reason".
**Failure/retry:** each step idempotent; verification email resend with rate limit; provider errors surface text + diagnostics link.
**Audit:** `WORKSPACE_CREATED`, `MEMBER_INVITED`, `INTEGRATION_STATE_CHANGED`, `GO_LIVE_COMPLETED`.
**Acceptance:** a new owner can reach "first test lead assigned and agent notified" without support; checklist cannot show complete while any criterion unmet; no step displays CONNECTED without a successful provider handshake. **Scope:** P0 (signup+verify, invite with email, source test, checklist, human-only mode); P1 (sandbox AI test, calendar, Google sign-in); P2 (import wizard in onboarding).

## REQ-TODAY — Home / Today

**Purpose:** answer "what do I do next?" in seconds. **Users:** agent (own scope), manager/owner (team scope). **Today:** `/dashboard` is a metrics dashboard, not an action queue.

**Agent view (ordered, each row deep-links to the filtered record):**
1. *Needs reply now* — conversations where last inbound is unanswered or status `NEEDS_HUMAN`, sorted by SLA remaining.
2. *Handoffs awaiting you* — open handoffs assigned to me.
3. *Follow-ups due/overdue* — due today or past due, with lead + suggested action.
4. *Today's appointments*.
5. *Leads waiting* — leads where AI is awaiting customer or awaiting approval of a draft.
6. *Stalled opportunities* (no activity > N days by stage threshold).
Each row shows owner, age, source, one primary action button.
**Manager adds:** unassigned leads (count + oldest age); SLA at risk/breached (first-response target default 5 min, business-hours aware, configurable); overdue follow-ups by agent; AI failures and handoff backlog; showing progression; pipeline health; integration/data-quality alerts.
**Metric rule:** each tile has a definition entry (formula, window, source events, drill-down) in `docs/` metrics catalog (see REQ-RPT). Values are labeled **Actual / Estimated / Unavailable**; never fabricated; revenue shown only from recorded opportunity values with a "recorded, not forecast" label.
**States:** skeletons; empty = "Nothing needs attention" with link to checklist; failure = per-widget retry (one widget failing does not blank the page).
**Acceptance:** counts equal the drill-down list length at the same instant; role scoping verified; no widget requires horizontal scroll at 390 px. **Scope:** P0 minimal (needs reply, due follow-ups, unassigned); P1 full.

## REQ-INBOX — Inbox and conversation workspace

**Purpose:** the daily work surface. **Today:** WhatsApp-only inbox keyed by `lead:<id>`.

**Entity:** `Conversation` (one per contact×channel, see architecture). **List:** unified across channels; filters: Unread, Unassigned, Needs human, AI active, AI paused, Awaiting customer, Overdue (SLA), Mine, Resolved; search by name/phone/email/message text; sort default = *priority* (SLA breach > needs human > unread > recent), not chronology.
**Thread:** messages with channel icon, timestamp (workspace TZ + hover absolute), author type chip (**AI** / **Teammate name** / **Customer** / **System**) using text label + icon, not color alone; delivery status per outbound message; internal notes rendered distinctly ("Internal – not sent") and stored in a separate table so they can never be sent; failed/undelivered show reason + Retry; AI drafts show "Draft by AI – awaiting approval" with Approve / Edit & send / Discard.
**Context panel:** lead summary, qualification fields with provenance chips, matched properties, upcoming tasks/appointments, consent status per channel (blocking banner if SMS suppressed).
**Composer:** shows AI state banner: *AI active* / *AI paused (you have control)* / *AI awaiting your approval*. Sending as a human while AI active triggers **claim** (see lock). Attachments only if channel supports (MMS yes/no per provider).
**Ownership and lock (concurrency):** each conversation has `controlMode ∈ {AI, HUMAN, UNASSIGNED}` and `controlVersion` (monotonic int). Every outbound send — human, AI, or sequence — executes inside a DB transaction that (a) locks the conversation row `FOR NO KEY UPDATE`, (b) verifies `controlMode` and `controlVersion` equal what the sender observed (AI uses the version captured when it decided to reply), (c) runs the Send Gate, (d) inserts the outbound message as `QUEUED` in the **outbox**, committing atomically. A human claim bumps `controlVersion` and cancels pending AI/sequence outbox rows for that conversation in the same transaction. A stale AI send fails closed (`SUPPRESSED: control_changed`). Two humans: second sender gets "X is replying" and must claim explicitly (manager can force). This closes the audit's check-then-send race (audit §1.4).
**Return to AI:** the controlling human or a manager clicks "Return to AI" (allowed only if AI policy permits and no open handoff); sets `controlMode=AI`, bumps version, writes audit and a system message in thread.
**Provider events:** duplicate inbound webhooks deduped by `(provider, externalEventId)` claimed in the same transaction as the message insert (pattern exists today); out-of-order delivery statuses applied only forward (pattern exists); provider outage → outbox retries with backoff (REQ-FUP) and the thread shows "Not sent – retrying" then FAILED after max attempts + notification to owner.
**Resolve/reopen:** resolve requires choosing outcome (answered, no response, wrong number, opted out, converted); a new inbound reopens and re-triggers routing/SLA.
**Audit:** `MESSAGE_QUEUED/SENT/FAILED`, `CONVERSATION_CLAIMED/RELEASED/REASSIGNED/RESOLVED/REOPENED`, `AI_DRAFT_APPROVED/DISCARDED`.
**Mobile:** list ↔ thread as two screens; composer sticky; context panel as bottom sheet.
**Acceptance:** concurrent AI+human send test yields exactly one message and the stale one `SUPPRESSED`; duplicate webhook yields one message; opted-out contact cannot be sent SMS from composer (button disabled with reason, server enforced). **Scope:** P0 (unified list SMS+email, lock, notes, statuses); P1 (priority sort, saved views, drafts); P2 (shared inbox rules).

## REQ-LEAD — Lead management

**Purpose:** one operational record per prospect inquiry. **Today:** Lead model with PK-shaped preferences; no provenance/consent.

**Model decision (D-04):** `Contact` (person identity, durable, de-duplicated) 1—N `Lead` (an inquiry/engagement with a source) 1—N `Opportunity` (deal pursuit). A *returning* person creates a new Lead on the existing Contact when the previous Lead is closed or >90 days dormant; otherwise the new inquiry appends to the open Lead and records an additional `LeadInquiry` event with its source (so source attribution is preserved). Today identity lives on Lead; migrate identity fields to Contact (see MIGRATION doc).
**Fields (required to respond):** first name *or* a verified channel handle; one contact method (phone/email); source. Everything else optional. Required by intent: Buyer — location, budget, timeframe (for *qualified*, not for creation); Seller — property address, timeframe; Renter — location, budget, move-in date; Unknown — none.
**Provenance on every qualification field:** `{value, status: STATED|IMPORTED|INFERRED|UNKNOWN, confidence?, sourceMessageId?, setBy, setAt}`. INFERRED values never satisfy "qualified" or drive hard property filters until a human or customer confirms (REQ-AI).
**Duplicate detection:** deterministic keys: normalized E.164 phone, lowercased email (plus Gmail-dot/plus normalization **not** applied). Exact match → auto-attach to existing Contact (safe); name-only/fuzzy/shared-household candidates → **Possible duplicate** queue, never silent merge. Merge is manager-initiated, shows field-by-field winner selection, preserves all child records, writes `CONTACT_MERGED` with a reversible snapshot for 30 days.
**List:** columns limited to: Name · Source · Owner · Stage · Next action (+due) · Last activity · SLA flag; saved views; server-side filtering/pagination (Today: client-side, 100-row cap).
**Bulk:** assign, tag, archive (managers); delete = soft delete w/ 30-day restore, hard delete via privacy workflow (REQ-CMP). Import/export per permissions (export is audited and rate-limited).
**Lost/disqualified:** requires reason from configurable list. **Audit:** field-level changes for qualification fields.
**Scope:** P0 (Contact/Lead split, E.164 dedupe, server-side list, provenance structure); P1 (merge UI, saved views, bulk); P2 (custom fields).

## REQ-CAP — Lead capture and routing

**Sources (P0):** hosted/embeddable web form (workspace key, spam protection: honeypot + rate limit + optional Turnstile), email-forward parser address per workspace *for specific named templates only* (validated, versioned parsers; unknown formats go to an "Unparsed leads" queue, never dropped), public API `POST /api/v1/leads` (API key per source, HMAC optional), manual entry, CSV. **P1:** SMS inbound, website chat (provider TBD), Meta/Facebook Lead Ads via official webhooks (requires app review — BE), call tracking provider webhook. **Not assumed:** Zillow/Realtor.com/Homes.com APIs (restricted; typically lead-email delivery or approved partner integrations — D-07). **Follow Up Boss as source/destination (P1 companion mode, requires verifying FUB's current API terms — BE/D-06).**
**Per-source pipeline:** receive → persist raw payload (`LeadIntake` row, immutable) → validate (zod) → normalize → dedupe → create/attach → route → consent evaluation → notify → first-response workflow. A failure at any step leaves `LeadIntake.status=FAILED|NEEDS_REVIEW` visible on an "Intake problems" list and alerts the owner; **no lead is dropped silently**.
**Attribution:** `source`, `sourceDetail` (form id, campaign, UTM), `receivedAt`, immutable raw payload; `LeadSource` becomes workspace-configurable rows, not an enum.
**Routing rules (ordered, first match wins):** conditions on source, property type, price band, ZIP/city/territory, language, time of day/business hours, team; target = agent | team round-robin | weighted | owner; respects agent availability (on/off, vacation, max open-lead cap). Fallback: unassigned pool + manager alert after `SLA/2`; escalation to owner at SLA breach. Round-robin cursor stored per rule and updated transactionally (no double-assign under concurrency).
**Notify:** assigned agent gets in-app + SMS/push + email according to preference (Today: in-app only → P0 gap).
**Acceptance:** form submit → lead visible, assigned, agent notified within target (p95 < 10 s, measured); duplicate submit within window attaches not duplicates; malformed payload lands in Intake problems; routing under 50 concurrent leads distributes within ±1.

## REQ-QUAL — AI lead qualification (behavior in AI spec)

Structured fields, provenance, confidence thresholds, clarifying-question policy, correction UI, and escalation conditions are specified in [AI_AGENT_BEHAVIOR_SPEC §3–4]. Product requirements: the original customer message is always preserved and linked from each extracted field; agent can accept/correct/clear any field (one click) and the correction is stored as feedback for evaluation; the qualifier asks only for fields needed for the *next operational step* (book showing / match) and stops asking when satisfied or after N=2 unanswered attempts. **Scope:** P0 rules-based extractor adapted to US vocab (beds/baths/price/city/ZIP/timeframe); P1 LLM-assisted extraction with schema-validated output and provenance.

## REQ-AGENT — AI conversation agent and handoff

See AI spec. Product requirements: three modes per workspace and per source — **Off**, **Draft (AI proposes, human approves)**, **Auto (AI sends within policy)**. Auto requires: owner explicit enablement, counsel-reviewed consent policy acknowledged, SMS campaign approved, passing sandbox evaluation, and per-conversation guard rails (max 3 AI messages without a customer reply; quiet hours; business hours). Default for all new workspaces: **Draft**. **Handoff:** triggers (customer asks for a person, complaint, negotiation, legal/financing question, fair-housing-sensitive request, repeated low confidence, high-value signal per rule, opt-out ambiguity, provider/policy error) create a `Handoff` record (open until resolved/reassigned — it does **not** close on new messages), set `controlMode=HUMAN`, cancel pending AI/sequence sends in the same transaction, notify the assignee via every enabled channel, and start a response timer; unacknowledged after T (default 10 min business hours) escalates to backup agent then manager. Context pack for the human: 3-line AI summary, extracted fields with provenance, last 10 messages, matched properties, why handoff fired. **Scope:** P0 handoff + draft mode; P1 auto mode (gated); P2 return-to-AI policies.

## REQ-FUP — Follow-up engine and automation

**Purpose:** follow-ups that execute durably and can be proven done. **Today:** 9 seeded rules creating tasks/notifications; daily inactive-lead script; no send actions.
**Model:** `Sequence` (versioned definition) → `SequenceEnrollment` (per lead) → `SequenceStep` executions → `OutboxMessage`/`Task`. Step types: send message (SMS/email, template), create task, wait (business-hours aware, TZ of lead else workspace), branch (replied? has appointment? stage?), notify, set field, end.
**Execution:** jobs stored in Postgres (`Job` table: `runAt`, `status`, `attempts`, `idempotencyKey` unique, `lockedBy/lockedUntil`, `lastError`) polled by a worker process (Railway service) using `FOR UPDATE SKIP LOCKED`; retry with exponential backoff (default 5 attempts), then `DEAD` visible in an admin "Failed automations" view with Retry/Cancel. Never depends on a browser tab. `idempotencyKey` = `enrollmentId:stepId:attemptGeneration`.
**Stop conditions (evaluated at enqueue *and* at execution time):** customer replied; opted out/suppressed; appointment booked; handoff opened / human controls conversation; lead stage ∈ closed/lost/disqualified/converted; contact merged; lead reassigned (re-evaluate rules); sequence paused by user; business-hours/quiet-hours violation (reschedule, not drop); consent missing for channel (SUPPRESSED + task for human). Evaluate-at-execution is mandatory so a reply that arrives after enqueue cancels the pending send.
**Controls:** pause/resume/cancel per enrollment and per sequence; "approval required" step flag (creates draft for agent).
**Follow-up objects** (task or sequence step requiring a human) carry `dueAt`, `status: OPEN|DONE|SKIPPED|CANCELED|OVERDUE`, `completedBy`, `completedVia` (sent message / call logged / manual); overdue escalates per rule.
**Acceptance:** retry of a job never double-sends (idempotency); reply cancels queued step; suppressed lead's scheduled job records `SUPPRESSED` and stays suppressed on retry; worker crash mid-job results in exactly-once effect (outbox + provider idempotency key where supported). **Scope:** P0 durable jobs + outbox + stop conditions + first-response flow; P1 sequences/branching; P2 builder UI.

## REQ-INV — Inventory and property matching

**Today:** `Property` with PK types/units; one blended score; manual/CSV only.
**US model:** listing id, MLS id/number (optional), address (line1, city, state, ZIP, geocode), status (`ACTIVE|PENDING|UNDER_CONTRACT|SOLD|OFF_MARKET|WITHDRAWN`), type (single family, condo, townhome, multi-family, land, rental), list price, beds, baths (full/half), sqft (+lot), year built, key amenities, listing agent (internal), `source` (`MANUAL|CSV|FEED:<name>`), `lastVerifiedAt`, `verifiedBy`, `availabilityConfidence` (`VERIFIED_RECENT|STALE|UNKNOWN`), URL, approved media refs (never hotlinked from unlicensed sources). Currency USD only.
**Sources:** manual, CSV, and — P2 — RESO Web API / MLS feed per customer's own MLS credentials (requires MLS license/IDX/VOW terms — BE/D-08). No scraping.
**Staleness:** a listing not verified in `staleAfterHours` (default 72; manual-inventory teams usually 24 h for "available now" claims) is `STALE`: it may appear in agent-facing suggestions with a warning but **AI may not assert availability/price to a customer** and may not offer it as a showing option without human verify.
**Matching, two stages (pure functions, deterministic):**
- *Stage 1 hard constraints* (all must pass, each exclusion recorded with reason): purpose (buy/rent), status ACTIVE, geography (selected city/ZIP/radius/polygon), property type if STATED, price ≤ max (if STATED; INFERRED budget → soft only), beds ≥ min if STATED.
- *Stage 2 ranking:* weighted soft preferences (beds exactness, baths, sqft band, amenities, price proximity, recency); output `{score, matchedReasons[], tradeoffs[]}`.
- *Output:* `{matches[], excluded[] with reasons}`; empty result returns explicit "No verified match" + next steps (widen budget/area, set saved search alert, ask agent).
AI may *explain* matches; it cannot add, remove or reorder them. **Fair housing:** matching inputs exclude any protected-class attribute and proxies (no demographic neighborhood data, no "family-friendly/safe/good schools" steering in AI text; objective criteria only).
**Acceptance:** property-based tests: any property violating a hard constraint never appears; stale listing never described as available by AI; exclusion reasons present. **Scope:** P0 US model + staged matcher; P2 feed.

## REQ-TASK — Tasks, next actions, ownership

Every non-terminal Lead has: an **owner** (agent or explicit "unassigned pool") and a **next action** (a Task/FollowUp with due date) *or* a recorded reason it needs none (`AWAITING_CUSTOMER`, `SNOOZED_UNTIL`, `NURTURE`). The "Today" and lead list surface leads violating this as **No next action** (data-quality flag). Task types: Call, Text, Email, Verify availability, Review AI qualification, Confirm showing, Post-showing follow-up, Update opportunity, Custom. Sources: manual, AI-suggested (status `SUGGESTED`, requires accept), automation (status `OPEN`, `dedupeKey`). A suggestion is not an action; a task is **DONE** only when completed by a person or auto-completed by a *verified* event (e.g. outbound SMS reached SENT for a "Text lead" task — configurable). Overdue: notify owner at due, manager at +SLA; reassign button. Task auto-cancel on stop conditions (opted out, closed, etc.). Team workload view: open/overdue per agent. **Today:** tasks have complete/start only; manual create UI missing. **Scope:** P0 create/complete/assign/overdue; P1 suggestions/auto-complete.

## REQ-PIPE — Opportunities and pipeline

**Definitions:** *Lead* = inquiry; *Contact* = person; *Opportunity* = an active pursuit of a transaction with a defined side (buyer/seller/renter/landlord) and value; *Showing* = appointment; *Transaction closed* = Opportunity in a Won stage with a recorded close date. Offer accepted ≠ closed; scheduled ≠ completed.
**Default buyer pipeline:** New → Contacted → Qualified → Property Matching → Showing Scheduled → Showing Completed → Offer/Negotiation → Under Contract → Closed Won; terminals: Lost, Disqualified, Deferred (nurture). Seller: New → Contacted → Appointment (listing consult) → Listing Agreement → Active Listing → Under Contract → Closed Won. Renter: New → Contacted → Qualified → Showing Scheduled → Application → Lease Signed (Won).
**Rules:** stage = `PipelineStage` rows (per workspace, per pipeline, per side); **transition matrix** configurable with defaults forbidding skipping *backward past Won* and requiring: Lost/Disqualified → reason; Showing Completed → linked completed Showing; Won → close date and value; reopening a terminal stage by manager only (audited). Time-in-stage = `now − stageEnteredAt`; stalled = time-in-stage > per-stage threshold with no activity. Forecast = Σ(value × stage probability) shown only for opportunities with values and labeled **Estimated**. Board, table, and record views read the same rows; stage change is available via a "Move to…" menu and keyboard, not drag-only. Permissions: configuration = OWNER/ADMIN; moving = AGENT on own, MANAGER on team. **Today:** fixed stages, stage CRUD missing, DnD board, `DealSide` only buyer/seller. **Scope:** P0 transition guards+reasons; P1 configurable stages; P2 pipelines per side/forecast.

## REQ-SHOW — Showings and appointments

State machine: `PROPOSED → CONFIRMED → COMPLETED | NO_SHOW | CANCELED`, with `RESCHEDULED` creating a successor linked by `rescheduledFromId`. Flow: agent (or AI in permitted mode) selects a **verified** listing → picks slots from the agent's calendar availability (if calendar connected) or from a manual availability grid → proposes ≤3 slots to the customer → customer reply (parsed; ambiguous replies go to human) or agent confirms → on confirm, create calendar event; event is marked `SYNCED` only after provider returns an id, else `SYNC_PENDING|SYNC_FAILED` shown honestly with manual fallback ("add to calendar manually"). Reminders: customer (SMS/email, consent-checked) at T-24 h and T-2 h; agent at T-1 h. Completion prompts agent after end time: Completed / No-show / Cancel with outcome note and interest level → creates follow-up task and advances opportunity (Showing Completed requires COMPLETED). Idempotency: unique `(leadId, listingId, startAt)` plus request key; retry cannot create duplicates. Time zones: stored UTC with IANA `timezone` of the property/market; customer-facing messages state the zone. **Today:** `CalendarEvent` internal only, no confirm flow, no reminders. **Scope:** P0 manual workflow (propose/confirm/complete/no-show/cancel, internal); P1 Google/Microsoft calendar with OAuth (BE: Google OAuth verification for sensitive scopes) + reminders.

## REQ-CONT — Contact management

Contact holds: names, multiple phones/emails (each with type, `isPrimary`, verified flags), mailing address, communication preferences, **ConsentRecord[]** (REQ-CMP), tags, relationships (spouse/co-buyer link, no inferred relationships), property interests, associated leads/opps/showings/conversations. Matching: exact E.164/email; fuzzy name+ZIP → possible-duplicate queue. Merge preserves history; audit snapshot. Access: agents see contacts they own or are linked to via their leads unless workspace setting "team-visible" (default on for ≤15-agent teams; configurable); managers all. Account entity (B2B-shaped) is deprecated for the residential ICP; retain only for builders/partners (P3). **Scope:** P0 Contact entity + multi-identity; P1 merge; P2 relationships.

## REQ-RPT — Reporting and manager insights

**Metric catalog (each documented with formula, population, window, source events, exclusions):**
| Metric | Formula (summary) | Notes |
|---|---|---|
| Lead volume by source | count(leads createdAt in window) by source | exclude spam-flagged/merged |
| Time to first response (TTFR) | `firstResponseAt − receivedAt`, where firstResponseAt = first outbound **SENT** by AI or human *after* receipt; also business-hours-adjusted variant | exclude leads w/o consentable channel (reported separately); median, p90, % within SLA |
| Contact rate | leads with ≥1 *customer reply or answered call* / eligible leads | |
| Qualification rate | leads reaching Qualified / eligible | definition of Qualified from pipeline config |
| Follow-up completion | follow-ups DONE by due date / follow-ups due in window; also late-completed, skipped, canceled | |
| Unassigned dwell | time between receipt and assignment | |
| Handoff backlog/latency | open handoffs; time to acknowledge | |
| Appointment funnel | proposed → confirmed → completed (+ no-show rate) | |
| Stage progression | % reaching stage N within D days of lead creation (cohort by created week) | cohort method; incomplete cohorts flagged |
| Lost reasons | distribution | |
| Opportunity aging | time-in-stage distribution | |
| Agent workload | open leads, overdue tasks, response median | |
| AI performance | drafts approved/edited/discarded, auto-sent, override rate, handoff rate, policy blocks, failures | |
| Integration reliability | send failure rate, webhook error rate, job dead count | |
Message funnel metrics keep separate counters: drafted, sent, delivered, replied. **Revenue** is shown only as recorded Won values (GCI/commission fields optional), labeled "recorded". No causal claims in UI; "changes since" comparisons show n and caveats. Every number drills down to records. **Today:** funnel counts + WhatsApp response rate, no TTFR. **Scope:** P0 TTFR, unassigned, follow-up completion, handoff backlog; P1 full catalog; P2 cohort/leakage report.

## REQ-INT — Integrations framework

`IntegrationConnection {provider, status, scopes, accountRef, lastSuccessAt, lastErrorAt, lastError, secretRef}` with state machine NOT_CONNECTED→CONNECTING→CONNECTED→ACTION_REQUIRED/ERROR→DISCONNECTED; status derived from **health checks** (periodic handshake/webhook-last-seen), not from saved credentials. Per integration specify auth, scopes, mapping, inbound/outbound paths, signature validation, idempotency, rate limits, retry, sync direction, conflict rule, disconnect behavior, diagnostics page. Priority for ICP: (1) web forms, (2) SMS provider (Twilio-class; 10DLC), (3) transactional/inbound email, (4) Google Calendar then Microsoft, (5) Follow Up Boss (companion), (6) Meta lead ads, (7) listing feed, (8) other CRM import formats, (9) voice (later, separately priced). Secrets encrypted at rest (KMS/app-level envelope) and never returned to client. Disconnect: stops jobs using it, marks dependent automations `BLOCKED`, notifies owner. **Scope:** P0 SMS+email+forms with real states; P1 calendar, FUB; P2 feed, Meta.

## REQ-MIG — Data import and migration

Specified in [MIGRATION_AND_CRM_REPLACEMENT_PLAN]. Requirements: staged import into `ImportJob` with dry-run, field mapping, validation report, dedupe preview, external-ID provenance (`ExternalRef{system, externalId}` unique per workspace), sample import into an isolated staging workspace, final import, reconciliation report (source count vs imported vs skipped with reasons), rollback by `importJobId` tag, and **suppression-preserving** semantics: an import can *never* clear a suppression/opt-out; imported consent must carry evidence or be imported as UNKNOWN. **Scope:** P1 generic CSV mapping + FUB export preset; P2 full wizard.

## REQ-CMP — Consent, suppression, send gate

Specified in compliance doc. Product requirements: `ConsentRecord` per contact×channel×purpose; `Suppression` global per workspace per address (phone/email) that overrides all; **Send Gate** function is the only path to enqueue outbound messages and returns ALLOW/BLOCK(reason). Inbound STOP/UNSUBSCRIBE/CANCEL/END/QUIT (and common variants, case-insensitive) auto-processed within seconds: suppress, confirm once, cancel pending jobs, audit. HELP auto-reply. Quiet hours (default 8am–9pm *recipient local time*, derived from area code/ZIP, fallback workspace TZ — conservative) enforced for automated texts. Scope: **P0**.

## REQ-TEAM — Team and workspace settings; audit and security UI

Invite (email), roles, deactivate (revokes sessions immediately; Today: supported), reassign-on-leave wizard (bulk reassign open leads/tasks/conversations to selected agents or pool; blocks deactivation until resolved or explicit override), business hours, routing rules, pipeline, templates, AI settings, integrations health, audit log viewer (filter by actor/entity/action/date, export), data export (full workspace export for offboarding), retention settings. Billing/usage: P2 (usage meter for SMS segments and AI tokens shown to admins; plan limits enforced softly with warnings before blocks). Roles: keep OWNER/ADMIN/MANAGER/AGENT/VIEWER; add **territory/team scoping** P2.

## REQ-UX — Navigation (summary)

Agent nav (5): **Today · Inbox · Leads · Pipeline · Calendar**; secondary: Contacts, Properties, Tasks (also surfaced inside Today). Manager adds **Reports**, **Team**. Admin area (Settings): Integrations, Automations & AI, Routing, Pipeline, Import, Audit & Security, Billing. Remove from primary nav: Golden Path, Accounts, Proposals, Insights/Reports duplication (merge into Reports). Detailed screen specs in the UX doc.
