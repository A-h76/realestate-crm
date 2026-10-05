# Migration and CRM Replacement Plan

Goal: replace the incumbent CRM (most likely Follow Up Boss, Lofty, kvCORE/Command, Sierra, or spreadsheets) without the customer risking contacts, history, assignments, or consent state. Context: [PRODUCT_VISION_AND_POSITIONING](./PRODUCT_VISION_AND_POSITIONING.md), journeys in [USER_JOURNEYS_AND_WORKFLOWS §H](./USER_JOURNEYS_AND_WORKFLOWS.md), requirements REQ-MIG/REQ-INT.

Today: CSV import for **leads only**, insert-only, no mapping UI, no dry run, no external IDs, no reconciliation (audit §3.5). Everything below is new build.

## 1. Phased replacement strategy and exit criteria

| Phase | What happens | Integration/support | Exit criteria (all required, measured) |
|---|---|---|---|
| **A. Prove the workflow** (weeks 0–8) | Synas runs *beside* the incumbent for new inbound leads only (lead sources forward to Synas; Synas shows ownership, response, follow-up; incumbent stays system of record). Companion integration with FUB where permitted: lead-in via forwarding; write-back of notes/stage/owner **only if** the official API terms allow and we've implemented it (D-06). Limitations disclosed in writing (e.g., two places to look; no historical data in Synas). | Paid pilot, weekly review | ≥ 6 weeks of real traffic; ≥ 80% of new leads handled in Synas; baseline vs pilot TTFR and follow-up completion reported with n; no P0/P1 incident; ≥ 70% of agents active weekly; owner states which incumbent features they'd miss |
| **B. Become operationally trusted** (weeks 8–16) | Agents live in Synas daily; reports trusted by owner; data accuracy audits | Integration health green; support SLA | Weekly active agents ≥ 85%; data-quality audit (50 random leads) ≥ 95% field accuracy; owner uses reports weekly; < 2 hand-reconciliation incidents/month |
| **C. Replace the incumbent** (weeks 16–24) | Full migration (§3–§6), parallel run ≤ 2 weeks, cutover, incumbent read-only → canceled by customer | Migration engineer + training | Reconciliation signed off; all lead sources cut over; 10 business days with zero incumbent writes; rollback window passed (14 days) without invoking rollback; customer signs acceptance |
| **D. Expand** | Voice, more channels, deeper integrations, broker-level features | Driven by demand | ≥ 3 customers requesting same capability; unit economics measured |

A successful Phase A does **not** authorize Phase C automatically; each gate is a go/no-go decision with the customer.

## 2. What can and cannot be migrated (disclose per source)

| Data | CSV export | FUB (API with customer credentials, subject to FUB terms/limits — verify) | Notes |
|---|---|---|---|
| People/contacts (name, phones, emails, address, tags, source, stage) | Usually yes | Yes (expected) | Phones normalized to E.164; invalid kept in `rawValue` with flag |
| Ownership/assignments | Owner name/email column | Yes | Users mapped to invited members; unmatched → pool + report |
| Notes/tasks | Sometimes | Yes (expected) | Imported as `Note`/`Task` with original timestamps and `importedFrom` |
| Communication history (texts/emails/calls) | Rarely | Partially (provider-dependent) | May be summarized as read-only timeline entries; **not** re-sent, never triggers automation |
| Deals/opportunities | Sometimes | Yes (expected) | Stage mapping required |
| Consent evidence / opt-outs / DNC | Rarely | Sometimes (flags like "Do not text") | **Opt-out/DNC flags import as Suppression (always). Consent without evidence imports as UNKNOWN** |
| Smart lists, automations/action plans, templates | No | No | Rebuilt manually; provide a mapping worksheet |
| Files/attachments | No | Maybe | Out of scope unless requested |
Each migration produces a **Readiness Report** that lists unsupported items. Never claim "complete" without reconciliation.

## 3. Import architecture

- `ImportJob {id, workspaceId, sourceSystem, mode(DRY_RUN|SAMPLE|FINAL), mapping, status, counts, reportRef, createdBy, checkpoint}` with resumable checkpoints (batches of 500, each in its own transaction).
- `ExternalRef {workspaceId, system, externalId, entityType, entityId, importJobId}` unique → re-running creates **zero duplicates** and updates only fields marked importable (field-level `importPolicy: OVERWRITE_IF_EMPTY | NEVER_OVERWRITE | OVERWRITE`; default never overwrites human edits).
- **Dedupe preview:** deterministic matches (E.164/email) auto-link to the same Contact; fuzzy → `DuplicateCandidate` queue; report shows counts before commit.
- **Suppression safety:** the import pipeline calls the same Send-Gate-aware writer: it can *add* suppressions, never remove or ignore them; imported "subscribed/opted-in" flags without evidence → `UNKNOWN`.
- **No side effects:** imports do not fire automations, notifications, SLA timers, or messages; imported leads are flagged `imported=true` and excluded from TTFR/SLA metrics.
- **Staging:** SAMPLE and DRY_RUN runs write to an isolated **staging workspace** (copy of config) that can be discarded; FINAL writes to production workspace.
- **Rollback:** every created/updated row carries `importJobId`; rollback deletes created rows and restores prior field values from an `ImportChange` ledger; feasible until users edit the imported records (edited rows reported as "kept"). A full-workspace export is taken before FINAL.
- **Idempotent file handling:** file hash recorded; same file re-upload warns.

## 4. Wizard flow

1) Source selection (FUB / Lofty export / kvCORE export / Sierra export / generic CSV / spreadsheet) → 2) upload/connect (credentials stored encrypted, scoped read-only, revocable) → 3) **Discovery**: counts, field fill rates, duplicate estimates, invalid phones/emails, owners not matched, stages list → 4) **Mapping** (auto-suggest with confidence; user confirms; saved as template per source) → 5) **Validation**: errors per row downloadable, blocking vs warning → 6) **Duplicate review** → 7) **Sample import** to staging, side-by-side compare with source for 20 random records → 8) approval by owner (explicit) → 9) **Final import** → 10) **Reconciliation report** → 11) parallel-run diff (daily: new leads in incumbent but missing in Synas and vice versa) → 12) training & acceptance → 13) cutover checklist.

**Reconciliation report contents:** source row counts per entity; imported/updated/merged/skipped(with reason codes)/failed; field coverage before vs after; ownership distribution; suppression & consent distribution; checksum of sampled records; unsupported-field list; hash of source file; sign-off block.

## 5. Training and parallel operation

- Role-based 45-minute sessions (agent: Today/Inbox/Lead/Showing; manager: routing, reports, SLA; owner: AI controls & compliance). Sandbox workspace with sample (labeled) data.
- Acceptance tasks per agent: respond to a test lead, log a call, create a follow-up, propose a showing, resolve a handoff.
- Parallel run ≤ 2 weeks: lead sources deliver to both (or Synas first); daily diff; agents must record in Synas; incumbent receives nothing new after cutover.

## 6. Cutover and rollback

Cutover day: freeze incumbent edits → delta import (changes since FINAL) → switch lead source endpoints/forwarding → verify test lead end-to-end → update integrations (calendar, SMS number porting if applicable) → announce. **Rollback window (14 days):** re-point sources to incumbent, export Synas-created records since cutover as CSV for re-import into incumbent; note the loss of anything not exportable. SMS number porting is the highest-risk item (carrier lead time; do not port until Phase C approved; use a new number in Phase A/B).

## 7. Replacement-readiness criteria (what must exist before pitching replacement)

Data parity for contacts/leads/notes/tasks/deals; owner mapping; reporting parity for the customer's top 5 reports (collected in assessment); integration coverage for their top lead sources & calendar; user training; documented rollback; support SLA; uptime record from Phase A/B; export-out tool (customer can leave — builds trust).

## 8. Risks

Provider API terms restrict third-party export/integration (verify before promising); incumbent history exports incomplete; consent evidence missing → reduced automation until re-permissioned; agents revert to old CRM habits (mitigate with sources cut over early and manager reporting only from Synas); number porting delays; duplicate explosion on poor source data (dedupe preview + review queue).
