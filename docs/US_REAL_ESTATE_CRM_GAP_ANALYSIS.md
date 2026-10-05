# US Residential Real-Estate CRM — Gap Analysis

Method: read-only inspection of `prisma/schema.prisma`, `src/app`, `src/lib`, `src/components` and tests. The UI was **not** browser-verified (see the Foundation doc).

Statuses: EXISTS · PARTIAL · MISSING · DEFERRED (not yet appropriate) · INTEGRATION-DEPENDENT · NEEDS VERIFICATION.
"Done this pass" = changed in this task (2026-10-05).

| # | Capability | Status | Where | Database | UI | API | RBAC | Missing pieces | Priority / decision |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Lead create / edit / list / search / filter / sort / stage / owner | EXISTS | `leads/`, `api/leads` | `Lead` | `leads-table.tsx` | `api/leads`, `[id]` | `crm:read/write` | — | — |
| 2 | Lead assignment / reassignment | EXISTS | `lead-owner-control`, `api/leads/[id]/assign`, `lib/assignment` | `Lead.ownerId` | yes | yes | `leads:assign` (MANAGER and above) | — | — |
| 3 | Lead sources (US categories) | EXISTS (done this pass) | `validations/common.ts`, `dashboard-ui.ts` | `LeadSource` + GOOGLE_ADS, PHONE, MANUAL, OTHER (additive migration) | filter + labels | validated | — | Source is a label only; no provider integration | done |
| 4 | CSV import/export, duplicate detection | EXISTS | `lib/csv`, `lib/leads/identity.ts`; tests `lead-dedup`, `csv*` | phone/email indexes | yes | `api/leads/csv` | `csv:import/export` | Duplicate merge UI | later |
| 5 | Lead priority, tags | MISSING | — | no `tags` / lead priority columns (Task has priority) | — | — | — | Additive columns + UI | P1 next |
| 6 | Bulk actions on leads | MISSING | — | — | no multi-select | — | — | Bulk assign/stage with per-row authorization | P2 |
| 7 | Lead timeline / activity history | EXISTS | `activity-timeline.tsx`, `Activity`, `AuditLog` | yes | lead page | `api/activities` | — | — | — |
| 8 | Buyer/seller classification | PARTIAL | `Lead.intentType` (BUY/SELL/RENT/INVEST) | yes | shown on lead | yes | — | Not on Contact | P1 next |
| 9 | Contact record (name, phone, email, notes, links) | EXISTS | `contacts/` | `Contact` | list + detail | `api/contacts` | crm | — | — |
| 10 | Contact 360 view | PARTIAL | `contacts/[id]` | relations to leads, tasks, events, messages, notes | detail page | — | — | Mailing address, preferred contact method, classification, tags are not on Contact | P1 next (additive) |
| 11 | Lead → contact without duplicates | EXISTS | `lib/leads/identity.ts`, `convert-on-won.ts` + tests | — | — | — | — | — | NEEDS VERIFICATION in browser |
| 12 | Opportunities (owner, contact, lead, value, close date, stage, notes) | EXISTS | `opportunities/`, `lib/metrics` | `Opportunity` | list + detail | `api/opportunities` | crm | — | — |
| 13 | Configurable pipeline stages per workspace | PARTIAL | `PipelineStage` (per workspace, ordered, won/lost flags) | yes | read-only list in Settings | `api/pipeline/stages` | — | No stage editor; no separate buyer/seller stage sets | P1 next |
| 14 | Pipeline board | EXISTS | `pipeline/pipeline-board.tsx` | — | drag to change stage, audited | `api/opportunities/[id]` | — | Next-task column | P2 |
| 15 | Properties (address, city, state, ZIP, type, price, beds, baths, sqft, lot acres, status, agent) | EXISTS | `properties/` | `Property` | yes | yes | crm | — | — |
| 16 | Property: MLS ID, listing URL, features; Pending / Under Contract status | MISSING | — | `PropertyStatus` = AVAILABLE/RESERVED/SOLD/RENTED/WITHDRAWN | — | — | — | Additive fields + enum values; property↔opportunity status sync (`property-status-sync` test) must change together | P1 next |
| 17 | Property matching | EXISTS | `lib/matching/properties.ts`, `lib/ai/property-match.ts` | — | lead panel, lead page | via lead context | — | Bathrooms / lot size scoring to verify | relabelled "Property Matches" |
| 18 | Conversations (list, thread, lead link, direction, status, human takeover, suggested reply) | EXISTS (WhatsApp only) | `conversations/`, `components/whatsapp/`, `lib/whatsapp` | `WhatsAppMessage`, `MessagingConsent` | yes | `api/whatsapp/*` | `whatsapp:read/send` | SMS / email / voice not implemented; no internal notes on a thread | SMS DEFERRED; INTEGRATION-DEPENDENT |
| 19 | Tasks (assign, due, priority, status, lead/contact/opportunity/property links, overdue) | EXISTS | `tasks/` | `Task` | yes | `api/tasks` | crm | — | — |
| 20 | Calendar (showing/call/meeting/follow-up, lead/contact, owner, times, status) | EXISTS (internal) | `calendar/` | `CalendarEvent` | yes | `api/calendar` | `calendar:*` | Google/Outlook sync absent (`provider = "demo"`) | INTEGRATION-DEPENDENT |
| 21 | Automations | PARTIAL | `lib/automation/engine.ts`, `automations/page.tsx` | `Automation`, `AutomationExecution` | list + executions | `api/automations` | `automations:*` | Fixed trigger set only; no builder (intentional) | keep as is |
| 22 | Reports | PARTIAL | `reports/`, `insights/` | derived | revenue + conversion | — | `crm:read` | Per-agent report, lead-source report, activity counts; response time not instrumented | P2; never fabricate |
| 23 | Dashboard | EXISTS | `dashboard/` | derived | yes | `api/dashboard` | — | "Today's tasks / appointments" blocks not confirmed | NEEDS VERIFICATION |
| 24 | Team roles | EXISTS | `lib/authz.ts` | `WorkspaceRole` OWNER/ADMIN/MANAGER/AGENT/VIEWER | new `/team` route | `api/workspace/members` | `members:manage` | No BROKER / ASSISTANT roles (VIEWER is the read-only role). Adding roles changes the permission model | DEFERRED |
| 25 | Integrations page | EXISTS (done this pass) | `/integrations` | — | WhatsApp + calendar status and an explicit "Not available yet" list | — | — | All external providers | truthful by construction |
| 26 | AI Assistant settings (draft vs automatic follow-up) | PARTIAL | `AiMode` enum, `lib/messaging/outbound-gate.ts` | workspace flag | **no UI** | — | — | Settings control | P3, needs safety review |
| 27 | Lead response / follow-up health | PARTIAL | `Lead.followUpDue`, `lastActivityAt`, `FOLLOW_UP_OVERDUE` notification | — | dashboard actions | — | — | No first-response timestamp, so no response-time metric | DEFERRED until the event exists |
| 28 | US locale (USD, sqft/acres, US phone, ZIP, 12-hour time) | EXISTS | `lib/format.ts`, `lib/phone.ts` | legacy PKR / MARLA / KANAL enum values removed (migration `20261006000000_remove_legacy_market_enum_values`) | — | — | — | — | grep-verified |
| 29 | Billing, voice/SMS agents, MLS/IDX, commissions | — | — | — | — | — | — | — | DEFERRED |

## Terminology audit result

Internal names found in the UI before this pass: sidebar (Golden Path, WhatsApp, Audit Log), Conversations header, handoff badges/banner/panel, take-over button, activity-log page, Golden Path walkthrough. These were changed (see the Foundation doc).

Not present in the UI at all: "Lead Rescue", "Scenario Engine", "Matching Engine", "AI Mode", "Auto Send".

Pakistan-specific terms (PKR, MARLA, KANAL, +92, Lahore, Zameen, lakh/crore, Roman Urdu): none remain in code, schema or tests. The legacy enum values were removed by migration `20261006000000_remove_legacy_market_enum_values`, which aborts if any row still uses one.
