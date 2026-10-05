# Simple CRM UX audit

Audit done before the Simple-surface work. "Backend" = what already existed to build on.

| Area | Current UX (before) | Problem | Existing backend support | Recommended change | Priority |
|---|---|---|---|---|---|
| Navigation | 14 items + 5 "More" in one sidebar at the same level | Every feature at equal weight; intimidating | RBAC permissions per item | 4 primary (Home, Leads, Inbox, Calendar) + collapsible More; phone bottom bar | P0 |
| Dashboard | ~15 analytics cards (pipeline value, trend, sources, properties) | Answers "how is the business" not "what do I do now" | Leads, tasks, WhatsAppMessage, CalendarEvent timestamps | New Home: Respond now / Follow up today / Today / Going cold; analytics moved to Reports > Business overview | P0 |
| Needs attention | Only per-lead "next best action" + an unrelated inbox `needsReply` flag | No cross-lead "who first"; no unassigned / uncontacted / stale rules | `Lead.followUpDue`, `lastActivityAt`, `ownerId`; message direction + `sentAt`; open tasks | Deterministic rules engine (`src/lib/attention`) over real timestamps | P0 |
| Next action | `Lead.nextAction` text only; Pipeline showed it from the lead | Opportunities had none; no due/owner/reason | Tasks, calendar events, `followUpDue` | Resolve from lead field, then soonest task, then appointment; show "No next action" | P0 |
| Lead priority | Opaque 0-100 scores (fit/intent/value) | User cannot see why | Same facts as above | Explainable High/Normal/Lower with reasons list | P1 |
| Leads list | 14 columns, 1200px wide table, scores up front | Unusable on small screens, jargon | Lead fields | Default 7 everyday columns, Status + Why columns, saved-view chips, `?filter=` | P0 |
| Lead details | One long page: intelligence panel, contact, thread, timeline, tasks, opps, proposals, calendar | Everything visible at once | All data already loaded | Summary header + actions + 7 tabs (`?tab=`) | P0 |
| Inbox | Titled "Conversations"; no way to get a suggestion in thread | Jargon; suggestion buried on lead page | `/api/intelligence` FOLLOW_UP_DRAFT; outbound gate | Renamed Inbox; "Suggest a reply" fills composer only (never sends) | P1 |
| Property matches | Score % and factor table | Not plain language | `filterAndScoreProperties` reasons | One-line "Fits budget, location and bedrooms." | P1 |
| Tasks | Today/Upcoming/Overdue/Completed already; browser-local day; no links | Wrong "today" if tz differs; related record not clickable | Task relations | Workspace-tz day from server, counts, links to lead/deal, friendly empties | P1 |
| Calendar | Flat list of every event incl. past | Hard to see "where do I need to be" | CalendarEvent | Grouped by day, past collapsed, rows link to lead/deal, `?leadId=` prefill | P1 |
| Pipeline | Already configurable stages; card showed lead's nextAction only | Deals with nothing planned invisible | PipelineStage, tasks, events | Card shows real next action or "No next action" | P1 |
| Reports | "WhatsApp reply 0%" when no data; "property match conversion" = won-with-property / match runs | Misleading metrics | Insights API | "Not enough activity data yet"; dropped the match-conversion line; show denominator | P0 |
| Manager view | None | No view of where leads are lost | Everything above | `/team-health`: follow-up health, lead flow, workload, data health (leads:assign only) | P0 |
| Lead states | Stage enum has NURTURING/LOST/CONVERTED | No Cold / Needs Attention | Stage enum | Derived state from stage + rules; no new state table | P1 |
| Missed calls | No call provider | Cannot show real ones | `Activity` type CALL + JSON metadata | Rule reads `metadata.outcome = "missed"`; nothing is fabricated | P2 |
| Terminology | Mostly converted already (Transfer to agent, Take over conversation, Property Matches) | Remaining: Lead intelligence, Follow-up draft, Buyer/Seller Requirements | Strings only | Relabelled; internal names untouched | P1 |
| Security | Workspace isolation, RBAC, consent, STOP, takeover gates | Must not regress | n/a | No new mutations except POST /api/tasks (existing, validated route); all loaders take `workspaceId` | P0 |
