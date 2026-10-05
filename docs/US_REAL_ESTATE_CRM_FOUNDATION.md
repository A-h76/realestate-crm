# US Real-Estate CRM Foundation

Status key: **IMPLEMENTED** · **PARTIAL** · **PLANNED**. Per-capability detail: `US_REAL_ESTATE_CRM_GAP_ANALYSIS.md`.

## Information architecture

IMPLEMENTED: Dashboard · Leads · Contacts · Opportunities · Properties · Conversations · Tasks · Calendar · Pipeline · Automations · Reports · Team · Integrations · Settings.

"More" group (existing modules kept reachable, not dropped): Companies (`/accounts`), Proposals, Insights, Activity Log (`/audit`, `audit:read` only), Lead Journey demo.

| Client-facing | Route | Previously |
|---|---|---|
| Conversations | `/conversations` | `/whatsapp` (308 redirect kept) |
| Lead Journey (guided demo) | `/lead-journey` | `/golden-path` (308 redirect kept) |
| Team | `/team` | Settings → Team tab (same component and permissions) |
| Integrations | `/integrations` | Settings → Integrations tab |
| Activity Log | `/audit` | "Audit Log" (label only) |

## Terminology applied

Golden Path → Lead Journey · Handoff → Transfer to agent · Take over → Take over conversation · Lead context → Lead Details · Requirement → Buyer/Seller Requirements · Matched properties → Property Matches · Audit log → Activity log · "Draft WhatsApp Follow-up" → Suggest WhatsApp Reply · "Analyze Lead" → Qualify Lead · isDemo → Demo mode.

Internal identifiers (`handoff`, `workspace`, `AuditLog`, route handlers under `api/whatsapp`) are unchanged.

## Modules

- **Leads, Contacts, Opportunities, Properties, Tasks, Calendar, Pipeline** — IMPLEMENTED. Field gaps are PLANNED: contact address and classification, lead tags and priority, property MLS ID / listing URL / features.
- **Lead sources** — IMPLEMENTED as categories (Website, Zillow, Realtor.com, Homes.com, Facebook, Google, Referral, Open House, Phone, Manual, Other, …). No provider integration exists.
- **Conversations** — IMPLEMENTED for WhatsApp (demo provider unless live credentials are configured). SMS, email, voice are PLANNED.
- **Automations** — PARTIAL: fixed server-side triggers, no builder.
- **Reports** — PARTIAL: revenue and conversion from real data. Response-time metrics are PLANNED and absent until a first-response event is recorded.
- **Team / RBAC** — IMPLEMENTED: OWNER, ADMIN, MANAGER, AGENT, VIEWER. BROKER / ASSISTANT roles are PLANNED because they change the permission model.
- **Integrations** — IMPLEMENTED as a status page: WhatsApp (live / demo / not connected) and the internal calendar. Everything else is listed under "Not available yet".

## Lead lifecycle

NEW → CONTACTED → QUALIFIED → NURTURING → CONVERTED / LOST / ARCHIVED. Winning an opportunity converts the lead and links the contact through the identity/dedup layer, so no duplicate person is created.

## Opportunity lifecycle

Per-workspace `PipelineStage` rows (ordered, with won/lost flags). Stage moves are audited. A stage editor and separate buyer/seller stage sets are PLANNED.

## Property, task and conversation workflows

- Properties are matched against a lead's requirements (area, budget, type, bedrooms, size) and shown as "Property Matches".
- Tasks link to lead, contact, opportunity and property.
- Conversations are keyed by lead. A transfer trigger creates a "Transfer to agent" task; an agent can take over the conversation, which locks AI sending.

## AI layer (an enhancement; safety rules unchanged)

Draft-first, explicit opt-in for automatic sending, server-side consent checks, STOP suppression, human takeover lock, fail-closed behaviour, audit trail. No safety code was modified in this pass. An AI Assistant settings control is PLANNED.

## Verification honesty

Browser/UI verification was **not** performed. Code-level checks, unit and security tests, the production build and the API E2E scripts were run.

## Roadmap (not started)

1. Contact fields and lead tags/priority (additive migration).
2. Property MLS ID / URL / features and Pending / Under Contract statuses.
3. Pipeline stage editor.
4. Reports: per agent, by source.
5. First-response timestamp, then a truthful Response Time report.
6. AI Assistant settings.
7. SMS / email providers; calendar sync.
