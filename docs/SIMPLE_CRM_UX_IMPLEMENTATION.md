# Simple CRM UX implementation report

### AUDIT
See [SIMPLE_CRM_UX_AUDIT.md](SIMPLE_CRM_UX_AUDIT.md). Before: a wide, analytics-first CRM with every module at the same nav level, opaque scores, no cross-lead "who first", and a few misleading report numbers.

### IMPLEMENTED
- **Needs Attention engine**: `src/lib/attention/rules.ts` (pure), `loader.ts` (workspace-scoped Prisma), `team-health.ts`, `hygiene.ts`.
- **Home** (`/dashboard`): greeting + count; Respond now, Follow up today, Today, Needs an owner, Going cold. Every row has one action. "My work / Whole team" toggle; team scope is enforced server-side (`leads:assign`).
- **Navigation**: Home, Leads, Inbox, Calendar + collapsible More; mobile bottom bar with More opening the drawer.
- **Leads**: 7 default columns, Status + Why columns, view chips (`?filter=attention|mine|unassigned|uncontacted|going-cold|no-next-action`).
- **Lead Details**: summary header (type, area, requirements, owner, status, next action), Call / Message / Add task / Schedule / More, 7 tabs.
- **Inbox**: renamed; "Suggest a reply" fills the composer only.
- **Property Matches**: plain-language "Fits budget, location and bedrooms."
- **Tasks**: counts, workspace-timezone day, links to lead/deal, friendly empties.
- **Calendar**: grouped by day, past collapsed, rows link to the person/deal, `?leadId=` pre-fills the form.
- **Pipeline**: cards show real next action or "No next action". Stages remain the configurable `PipelineStage` rows.
- **Reports**: honest empty state; removed the property-match-conversion line; old dashboard now at `/reports/overview`.
- **Team Health** (`/team-health`, managers): follow-up health, lead flow, agent workload, data health.

### TERMINOLOGY
Dashboard → Home; Conversations → Inbox; Lead intelligence → Lead Qualification; Property match → Property Matches; Follow-up draft → Suggested Reply; Buyer/Seller Requirements → Requirements; Lead Journey (demo) → Guided Demo; "Analyze lead / Recalculate score" → "Review lead / Refresh score". Already converted earlier: Transfer to agent, Take over conversation, Activity Log, Pipeline. Backend model and enum names unchanged. "Workspace" is still shown in Settings and the demo banner (not changed).

### UX
Progressive disclosure: four everyday screens up front; Contacts, Opportunities, Properties, Pipeline, Tasks, Reports, Team Health, Automations, Team, Integrations, Settings and the rest under More. Lead Details shows one tab at a time. Leads table hides scores/source/industry behind "Columns".

### CORE CRM
- **Next action** resolved from existing data: lead `nextAction` + `followUpDue`, else soonest open task, else next appointment, else `null` ("No next action"). Nothing is written or back-filled.
- **Priority** is High / Normal / Lower with a reasons list; no score model. "Showing requested" only when the lead's last message matches a keyword regex.
- **Lead state**: Active, Needs Attention, Nurture, Cold, Lost, Converted, derived from `LeadStage` plus the rules (no new state table). Cold = 30+ days idle with nothing scheduled; Going cold = 14+.
- **Missed calls**: rule reads `Activity` type CALL with `metadata.outcome = "missed"`. No call provider exists, so none are shown today.
- Draft and failed outbound messages do not count as "contacted".

### LEAD RESPONSE
Respond now = newest inbound message with no later outreach; New lead = stage NEW with no outreach; elapsed times are differences of stored timestamps. Overdue / due today use the workspace-local day.

### MANAGER EXPERIENCE
Unassigned, uncontacted (with oldest age), waiting for reply, overdue follow-ups, going cold, deals without next action; per-agent workload; lead flow for leads created in the last 30 days (New → Assigned → Contacted → Qualified → Showing → Offer → Closed) as counts only. Flow shows "Not enough activity data yet" under 5 leads; Offer/Closed show a dash if the workspace has no stage named offer/contract (or a won stage). Data health: no owner, no next action, no phone/email, possible duplicate contacts (same full phone or email), stale deals (30+ days no movement).

### DATABASE
No migrations, no schema change, no backfill, no resets.

### TESTS
- `npm run typecheck`: clean. `npx eslint src tests`: clean.
- `npm test`: **783 pass, 0 fail** (includes 18 new tests in `tests/unit/needs-attention.test.ts`: attention rules, next action, stale, unassigned, overdue, priority explanation, lead state, duplicates).
- Existing tests edited (not weakened): `us-crm-foundation` nav assertion now encodes the new nav (4 primary + More, still no internal names); `permission-gating` uses the renamed button labels and `>Complete<` so the new "Completed" tab does not match; role matrices unchanged.
- `npm run integrity:check`: no cross-workspace references.
- Read-only smoke (`scripts/attention-smoke.ts`) ran the Home and Team Health loaders against both existing workspaces without error; counts looked plausible (e.g. 15 and 19 attention items).
- **Not run**: `e2e:core`, `e2e:rbac`, `e2e:golden-path`. They need a running seeded app, and `e2e:rbac` re-seeds the UX demo workspace, which conflicts with the no-reset rule. No new automated test covers the `AddTaskForm`, `/team-health` redirect for non-managers, or tenant isolation of the new loaders (they are scoped by `workspaceId` in every query, verified by reading, not by a test).

### BUILD
`npm run build`: success; `/dashboard`, `/team-health`, `/reports/overview` compiled. Unauthenticated `/dashboard` and `/team-health` redirect (307) to login on a local dev server.

### BROWSER
**Not performed.** Logging in would have meant typing a password from `.env`, which I did not do, so no page was viewed after login and no responsive widths (1440 to 390) were checked. Layout and mobile behaviour are untested visually.

### REMAINING GAPS
- Visual and responsive verification; e2e suites.
- Leads table "Why" is first reason + count; no expandable detail.
- After creating/deleting a lead in the table, status/why are kept for existing rows but new rows show "—" until refresh.
- Home reads up to 500 leads per request; fine for demo scale, needs pagination/SQL aggregation for large teams.
- Properties, Contacts, Opportunities pages were not redesigned.
- "Workspace" wording remains in Settings.
- Lead-flow "Qualified" and "Contacted" use current state, not event history.
- Settings has no UI for the AI Assistant / Automatic Follow-Up mode (not exposed before either).

### DEFERRED
SMS/voice agent, billing, MLS/IDX, transactions, commissions, automation builder, call-provider integration.

### RISKS
- Untested in a browser; check Home, Lead Details tabs and the mobile bottom bar before demoing.
- Safety controls (draft-first, consent, STOP, takeover, fail-closed provider) were not touched; "Suggest a reply" only fills the textbox and the send route still gates.
- Nothing committed or pushed, as requested.
