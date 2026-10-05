# User Journeys and Workflows

Each journey: actor · starting conditions · numbered steps (U = user, S = system) · data changes · notifications · failure paths and recovery · acceptance. Requirement IDs refer to [PRODUCT_REQUIREMENTS](./PRODUCT_REQUIREMENTS.md); entities/states to [SYSTEM_ARCHITECTURE_AND_DATA_MODEL](./SYSTEM_ARCHITECTURE_AND_DATA_MODEL.md). Concrete numbers (SLA 5 min, quiet hours 8am–9pm) are default assumptions (D-14).

---

## Journey A — Agency owner signs up and goes live

**Actor:** owner. **Start:** no account; has a team, a lead source, a phone.
1. U opens marketing site → "Start pilot". S shows signup (email, password; Google [P1]); validates, rate-limits, creates unverified `User`.
2. S sends verification email (transactional provider). U clicks link → S marks `emailVerifiedAt`, signs in. *Failure:* link expired → "Resend" (limit 5/h); mail provider down → page says delivery delayed and shows support contact; account stays unverified (no workspace creation).
3. U creates workspace: name, time zone, state(s), team size. S creates `Workspace` (USD), default pipelines, default routing (round-robin, owner fallback), SLA 5 min, AI mode DRAFT, default notification preferences; audit `WORKSPACE_CREATED`.
4. S opens **Setup checklist** with computed "Next recommended step".
5. U invites agents (email+role). S creates pending `Membership`, sends invite email with 72 h single-use link (existing token logic). *Failure:* email bounce → invite row shows "Delivery failed – copy link" (owner can hand link manually, matching today's behavior).
6. U connects a lead source: picks "Website form" → S shows snippet + hosted-form URL; U submits a test lead. S processes through the real pipeline; checklist item turns green **only after** a lead with `source=<this form>` is created and assigned. *Failure:* no event within 10 min → "We haven't seen a test submission" with troubleshooting; email-forward option shows unparsed-format guidance.
7. U sets up SMS: S provisions number, shows brand/campaign registration status `ACTION_REQUIRED → CONNECTING → CONNECTED` as the carrier registry responds (can take days). Until approved: workspace shows "Human-only mode (SMS pending approval)"; email still works.
8. U configures AI (optional): hours, tone, escalation contact; runs **Sandbox conversation** (messages flagged SANDBOX, never sent).
9. U optionally imports contacts/leads (CSV wizard, see Journey H) and inventory (CSV).
10. S evaluates **Go-live checklist** (verified email, ≥1 agent accepted invite, source tested, routing tested, agent notification delivered, messaging state explicit, consent policy acknowledged, AI mode chosen). U clicks "Go live" → S writes `GO_LIVE_COMPLETED`, enables source webhooks for production leads.
11. S shows first **Today** screen (empty states with next steps; demo data never mixed — optional sample workspace is a separate, labeled sandbox workspace).
**Data:** User, Workspace, Memberships, IntegrationConnections, RoutingRules, AiAgentConfig v1, audit rows. **Notifications:** verification, invites, agent test notification, go-live confirmation to owner. **Acceptance:** owner reaches go-live with SMS pending and email-only without support; no step shows CONNECTED without handshake; abandoning mid-way and returning resumes at the computed next step.

## Journey B — Agent handles a new inbound lead

**Actor:** agent (Maya). **Start:** web-form lead arrives 6:42 pm; Maya on shift; AI in DRAFT mode.
1. S receives form POST → `LeadIntake` stored → job `PROCESS_INTAKE`.
2. S normalizes phone to E.164, finds no Contact → creates Contact+Lead+Conversation(SMS); source=form, UTM stored.
3. S routes: rule "Austin/under $500k → Team A round-robin" → Maya; `Assignment` row; `slaDueAt = receivedAt + 5 min`.
4. S notifies Maya: push/SMS/email + in-app "New lead: Jordan, Austin, 3BR ≤ $450k (form)". *Failure:* notification delivery fails → retry then escalate to backup agent at SLA/2.
5. S generates AI **draft** first reply (consent: form checkbox text stored as `ConsentRecord(SMS, GRANTED, evidence=form)` if present; otherwise Send Gate marks SMS unavailable and offers email/call only). Draft appears on Today → "Review AI draft (1)".
6. U opens lead from Today. Sees conversation, AI summary, extracted fields with provenance chips, 2 matched VERIFIED listings, consent banner.
7. U edits draft, clicks **Send** → S transaction: control-version check, Send Gate, Message QUEUED+Outbox → provider → status SENT (✓ "Sent") then DELIVERED. `firstResponseAt` set at SENT (by USER, with AI-assisted flag). *Failure:* provider error → "Not sent – retrying (2/5)"; after final fail → FAILED + Maya notified, SLA flagged "response not delivered", suggested alternative (call).
8. **Human-only path:** if AI is OFF or draft isn't useful, Maya writes from scratch or calls; logging a call (outcome) also sets `firstResponseAt` if connected/attempted per workspace definition (default: attempted call counts only when logged as *spoke with customer* or *left voicemail* — configurable, documented).
9. Customer replies "$450k max, need to move by December" → S extracts fields (STATED), AI drafts follow-up (or Maya replies). Stage → CONTACTED automatically upon SENT; → QUALIFIED when required fields are STATED/confirmed.
10. S creates next action: "Propose showing for 123 Oak St (verify availability first)" due +2 h (task, SUGGESTED→OPEN on accept). Lead shows **Next action** on Today.
**Data:** Contact/Lead/Conversation/Messages/ConsentRecord/QualificationFields/Assignment/Task/ReportEvents. **Acceptance:** from webhook receipt to agent notification p95 < 10 s; no lead without owner or visible "unassigned" flag; `firstResponseAt` only from SENT.

## Journey C — AI qualifies a lead

**Actor:** AI agent (AUTO mode on a source after gating). **Start:** inbound SMS "Hi, I'm looking for a 3 bed house around Austin under 450k, next two months" from an unknown number (consent: customer-initiated inbound; scope limited to responding about their inquiry — see compliance doc).
1. S webhook persists inbound Message (dedupe), enqueues `AI_TURN(conversation, lastInboundMessageId, controlVersion)`.
2. S extracts fields (schema-validated) → STATED fields stored with `sourceMessageId`; contradictions flagged.
3. S decides next step by policy: missing location detail only → ask one question; no handoff triggers.
4. S runs Stage-1/2 match on VERIFIED_RECENT inventory (hard constraints from STATED fields only). 0 matches → no property claims.
5. S drafts reply → claim checker → policy classifier → Send Gate (hours OK, not suppressed, ≤ 3 consecutive AI msgs) → control-version verify → QUEUED → SENT.
6. Customer: "also is that area good for families with kids?" → policy classifier flags steering-sensitive → AI sends neutral template ("I can't weigh in on neighborhood demographics; I can share homes by price, size and location") **or** immediately hands off per workspace setting; conversation flagged `POLICY_FAIR_HOUSING` for manager review.
7. Customer: "Can I see 123 Oak St tomorrow?" → listing STALE (last verified 5 days) → AI does not confirm availability; creates handoff reason `VERIFY_AVAILABILITY`, replies "I'll confirm the home's availability and get back to you shortly" (permitted holding message).
8. Agent resolves; Journey E continues.
**Variants:** *Ambiguity* ("around 450" ) → asks "Do you mean $450,000?" *Provider failure* → Journey I. *Opt-out* ("stop texting me") → Journey I/§6.3, AI never sends again; *Human correction* → agent edits `bedsMin` from 3 to 4; correction stored; AI summary regenerated; subsequent questions skip beds.
**Acceptance:** zero must-never violations on red-team suite; every outbound AI message has an `AiExecution` with passing policy checks.

## Journey D — Agent takes over a conversation

**Actor:** agent. **Start:** AI active; customer writes "this is ridiculous, I want to talk to someone."
1. S detects handoff trigger (complaint + human request) → tx: lock conversation, `controlMode=HUMAN`, `controlVersion++`, cancel pending AI jobs/outbox, create `Handoff(OPEN)`, set Conversation `NEEDS_HUMAN`, priority top of inbox.
2. S optionally sends the customer a single holding message ("Thanks for your patience — <agent> will reply shortly") if workspace policy allows and Send Gate ALLOW.
3. S notifies assignee via push/SMS/email + in-app; starts handoff timer (default 10 min in business hours).
4. U opens conversation: banner "Handoff: customer requested a person – 3 min ago"; context pack (summary, fields, last messages, why).
5. U clicks **Claim** (auto when they send): `controllerUserId=U`, handoff → ACKNOWLEDGED. If another human already claimed: composer blocked, "Sam is handling this" with Request/Force (manager).
6. U replies; composer banner "AI paused – you have control".
7. U resolves handoff with outcome/note → Handoff RESOLVED. U chooses **Return to AI** (if policy allows) or keep control; return bumps version and posts a system message.
8. *No acknowledgement:* at T → escalate to backup agent, at 2T → manager and owner; each escalation audited.
**Failure:** assignee deactivated/absent → rule re-routes to team pool; notification failure → fall back channel. **Acceptance:** no AI message after claim (property test with concurrent jobs); handoff stays visible after new inbound messages.

## Journey E — Lead becomes a showing

**Actor:** agent (AI assists in permitted modes).
1. Lead QUALIFIED with STATED location/price/timeframe. S shows matches (Stage-1 pass/fail reasons visible). U selects listing 123 Oak St.
2. S checks `availabilityConfidence`; STALE → task "Verify availability" blocks the proposal button until U confirms (stores `lastVerifiedAt/By`).
3. U clicks **Propose showing** → S reads agent availability (calendar if CONNECTED else manual availability grid) → offers 3 slots → drafts message (or sends in AUTO if enabled and calendar real).
4. Customer replies "Saturday 11 works" → S parses; ambiguous → human; clear → `Showing PROPOSED` → agent **Confirm** (or auto-confirm if policy) → `CONFIRMED`.
5. S enqueues `CREATE_CALENDAR_EVENT` (idempotency key). Success → `syncStatus=SYNCED`; failure → retry, then `SYNC_FAILED` with "Add manually" and task. Opportunity → Showing Scheduled only at CONFIRMED.
6. S sends customer confirmation (consent-checked) and schedules reminders T-24h, T-2h; agent reminder T-1h.
7. After end time, S prompts agent: Completed / No-show / Canceled. Completed → feedback form (interest level, objections, next step); creates follow-up task; Opportunity → Showing Completed; metrics event. No-show → apology/reschedule task; Cancel → reschedule prompt.
**Failures:** double-click confirm → idempotent; customer reschedules → new Showing linked, old RESCHEDULED, calendar event updated; listing sold before showing → system flags affected showings on status change and notifies agent. **Acceptance:** no duplicate events on retry; "scheduled" never counted as "completed".

## Journey F — Opportunity progresses to an outcome

**Actor:** agent/manager.
1. Qualified lead with a showing → **Create opportunity** (side, linked property optional, value). Stage = first stage of side-pipeline.
2. U moves stage via drag **or** "Move to…" menu; S validates guard (e.g., Showing Completed needs a COMPLETED Showing; Offer needs value; Won needs close date; Lost needs reason).
3. Each change writes `stageEnteredAt`, audit, `ReportEvent`, may create tasks (e.g., Under Contract → "Schedule inspection follow-up").
4. Terminal: **Won** → Lead CONVERTED, Property status updated (existing logic generalized: SOLD/RENTED/PENDING), open sequences/tasks canceled, post-close nurture sequence offered. **Lost/Disqualified/Deferred** → reason; stop conditions fire; Deferred → nurture with resurfacing date.
5. Reopen by manager only; audited; re-enrolls suppressed sequences only on explicit action.
**Reporting drivers:** stage events, close dates, recorded value, lost reasons, time-in-stage. **Acceptance:** invalid transitions rejected server-side with explainable message; board/table/record agree after concurrent edits (optimistic version check).

## Journey G — Manager finds and fixes a conversion problem

**Actor:** manager/owner.
1. Today (manager view) shows "SLA breaches this week: 31 (↑)", with oldest unassigned lead 4 h.
2. U opens Reports → **Where leads are lost**: funnel by source with TTFR median/p90, % responded within SLA, contact rate. Source "Facebook" has TTFR p90 = 2 h 10 m, mostly 6–10 pm.
3. U drills to the list (filtered leads) → sees assignment to an agent whose hours end at 6 pm; routing rule has no after-hours branch.
4. U edits routing: after 6 pm → AI draft + on-call agent rotation; enables SMS notifications to on-call. Change audited with before/after rule.
5. S marks the change date on charts (annotation). U later compares 4-week windows pre/post with sample sizes and caveats (no causality claim; confounders listed: volume, season, source mix).
**Acceptance:** each number in the funnel opens a list with the same count; annotations don't alter data; report shows n and window; "Unavailable" shown when data insufficient.

## Journey H — Agency migrates from an incumbent CRM

Summarized here; full plan in [MIGRATION_AND_CRM_REPLACEMENT_PLAN](./MIGRATION_AND_CRM_REPLACEMENT_PLAN.md).
1. **Assessment:** owner exports from incumbent (FUB: people/contacts, notes, tasks, deals, tags, users via export or API with customer's credentials); Synas runs *Data Discovery* on files: counts, field coverage, duplicates, missing phones/emails, consent-evidence availability, history depth. Output: readiness report, what can/can't migrate.
2. **Mapping:** wizard proposes mappings (stage→stage, user→member, tags, source); U adjusts.
3. **Validation/dry-run:** no writes; report errors, dedupe candidates, suppression conflicts.
4. **Sample import** (≤ 200 records) into isolated staging workspace; U reviews in UI.
5. **Parallel operation (optional):** Synas receives new leads via forwarding/companion integration while incumbent remains system of record; daily diff report.
6. **Final import** (idempotent by `ExternalRef`), then **reconciliation report**: source count, imported, merged, skipped with reasons, unsupported fields list, consent state distribution.
7. **Training + acceptance checklist** (agents complete 5 tasks in sandbox; manager verifies reports); **cutover**: switch lead sources to Synas, set incumbent read-only, keep rollback window (14 days) with export-back option.
**Failure:** import job fails mid-way → resumable (checkpoint), rollback via `importJobId`; never overwrites suppression; unsupported history is disclosed, not silently dropped.

## Journey I — Provider or automation failure

| Event | System behavior | User-visible |
|---|---|---|
| SMS provider outage | Sends stay QUEUED in outbox, backoff retries; threshold → integration state `ERROR`, owner alert; AI pauses auto-sends (switch to drafts) | Thread: "Not sent – retrying"; Integration Health red; banner in inbox |
| Duplicate webhook | `(provider, externalEventId)` claim fails → ack 200, no side effects | None (counter in diagnostics) |
| Out-of-order status | Forward-only transition; ignored if regress | None |
| Scheduled job fails | Retry w/ backoff; DEAD after N → "Failed automations" list + notification; dependent follow-up task auto-created for human | Owner sees failure with Retry/Cancel |
| Calendar event creation fails | `SYNC_FAILED`, manual fallback task; Showing remains CONFIRMED internally | Badge "Not on calendar – add manually" |
| AI cannot answer | Holding message or handoff; never guess | "Needs human" |
| LLM down | Baseline templates/drafts disabled; human work unaffected | AI badge "unavailable" |
| DB down | Health 503; providers retry webhooks | Maintenance banner |
| Worker down | Oldest-pending-age alert; UI shows "Automations delayed" | Banner to admins |
**Acceptance:** each row has a test (ACCEPTANCE_TEST_PLAN §Failure).

## Journey J — Agent joins or leaves

**Join:** owner invites → agent accepts (set password/OAuth) → role applied → onboarding for agent: notification preferences (phone), availability hours, sample Today tour (sandbox), "send test notification" must succeed. S adds agent to round-robin only after availability + notification test complete.
**Leave:** owner/manager clicks Deactivate → S shows impact (N open leads, M tasks, K conversations, P upcoming showings) → U chooses reassign target(s) (pool, round-robin, specific agent) → S in one transaction: reassign leads/tasks/conversations/showings (creating Assignment history + audit), cancels agent-specific sequences or re-owns them, removes from routing rules, revokes all `AuthSession`s (existing capability), disables notifications, keeps `User` row and all authored records (audit actor remains resolvable; name retained, marked "former member"). Calendar connection tokens revoked; export of their personal data on request. *Failure:* partial reassign → transaction rolled back, nothing changed; deactivation blocked until open handoffs have owners. **Acceptance:** no lead owned by an inactive user after the operation; audit history intact; revoked session cannot call API (exists today, regression-tested).
