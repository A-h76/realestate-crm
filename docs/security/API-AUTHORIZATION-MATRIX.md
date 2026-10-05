# API & Server-Action Authorization Matrix

Generated from a full read of `src/app/api/**/route.ts` (2026-09-27). **The app has no Server Actions**: there is no `"use server"` anywhere. Every mutation goes through a route handler below.

## Common pipeline (every non-public route)

1. **`src/proxy.ts`** redirects requests with no valid JWT to `/login` and returns 403 for cross-origin mutations (Origin / `Sec-Fetch-Site`) and 413 for bodies over 1 MB (2 MB for CSV import). It sets `Cache-Control: no-store` on `/api/*`.
2. **`requirePermission(p)`** (`src/lib/api.ts`) requires an active session: JWT → `AuthSession` row that is unrevoked, unexpired, same user, and whose user isn't soft-deleted. It then reads the role from the DB `WorkspaceMember` row (never from the token) and checks the permission via `src/lib/authz.ts`.
3. **Workspace isolation:** `workspaceId` comes from the session and is confirmed by the membership lookup. Every query includes `{ workspaceId }`. By-id reads and writes use `findFirst`/`updateMany` with `{ id, workspaceId }`, and a miss returns 404.
4. **Relation check:** `assertRelationsInWorkspace` rejects (400) any client-supplied FK or owner that isn't in the caller's workspace.
5. **Validation:** Zod schemas strip unknown keys, which blocks mass assignment of `workspaceId`, `role` and scores. `parseBody` caps any string at 10,000 characters. List `q` is capped at 200 characters and `sort` is allow-listed.
6. **Rate limit:** `enforceRateLimit` per workspace+user (mutations 120/min; search 60/min; AI 30/min; WhatsApp 30/min; CSV export 10/15 min; CSV import 5/15 min; demo reset 3/h). Returns 429 + `Retry-After`.

Classes: **PUBLIC** · **AUTHENTICATED** (any member) · **PERMISSION-PROTECTED** (specific permission; see the role table) · **INTERNAL** (server-to-server, signature-authenticated).

## Role → permission summary

| Permission | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| crm:read, whatsapp:read, calendar:read, intelligence:read, automations:read, workspace:read, notifications:read, search:use | ✓ | ✓ | ✓ | ✓ | ✓ |
| crm:write, crm:delete, csv:import, csv:export, whatsapp:send, calendar:write, intelligence:run, scoring:run | ✓ | ✓ | ✓ | ✓ | |
| leads:assign, intelligence:review, automations:execute, audit:read | ✓ | ✓ | ✓ | | |
| workspace:write, members:manage, automations:manage, demo:reset | ✓ | ✓ | | | |

## Endpoints

| Method & path | Class | Permission | Workspace scoping | Validation | Rate limit | Audit | Notes |
|---|---|---|---|---|---|---|---|
| GET/POST `/api/auth/*` | PUBLIC | — | n/a | Zod (email, password) | POST signin/callback: ip+email 5, email 10, ip 30 per 15 min | USER_LOGIN, USER_LOGOUT | Auth.js CSRF token; revokes `AuthSession` on sign-out |
| GET `/api/health` | PUBLIC | — | n/a | — | — | — | Returns status, DB ok, latency only |
| GET `/api/webhooks/whatsapp` | PUBLIC | verify token | n/a | query params | — | — | Meta subscription handshake |
| POST `/api/webhooks/whatsapp` | INTERNAL | HMAC `X-Hub-Signature-256` | workspace resolved from `phone_number_id` mapping | JSON parse after signature | ip 120/min | HANDOFF_TRIGGERED etc. | Idempotent on external id; exempt from the Origin check |
| GET `/api/leads` | PERMISSION | crm:read | ✓ | Zod query, sort allow-list | — | — | |
| POST `/api/leads` | PERMISSION | crm:write (+ leads:assign to set another owner) | ✓ + relations | Zod | mutation | LEAD_CREATED | |
| GET `/api/leads/:id` | PERMISSION | crm:read | ✓ (404) | — | — | — | |
| PATCH `/api/leads/:id` | PERMISSION | crm:write (+ leads:assign to change owner) | ✓ + relations | Zod | mutation | LEAD_UPDATED / STAGE_CHANGED | |
| DELETE `/api/leads/:id` | PERMISSION | crm:delete | ✓ | — | mutation | LEAD_ARCHIVED | Soft delete |
| POST `/api/leads/:id/assign` | PERMISSION | leads:assign | ✓ + target membership | Zod | mutation | LEAD_UPDATED | |
| POST `/api/leads/:id/take-over` | PERMISSION | crm:write | ✓ | — | mutation | via lib | |
| GET `/api/leads/csv` | PERMISSION | csv:export | ✓ | — | 10 / 15 min | **CSV_EXPORTED** (new) | 500-row cap; formula-injection escaping |
| POST `/api/leads/csv` | PERMISSION | csv:import | ✓ (ownerId = self) | size ≤ 1 MB, ≤ 500 rows, field ≤ 2000 | 5 / 15 min | CSV_IMPORTED | Transactional |
| POST `/api/leads/simulate-inbound` | PERMISSION + DEMO | crm:write + `DEMO_MODE=true` | ✓ | — | mutation | LEAD_CREATED | Fails closed |
| GET/POST `/api/accounts` | PERMISSION | crm:read / crm:write | ✓ + relations | Zod | POST mutation | ACCOUNT_CREATED | |
| GET/PATCH/DELETE `/api/accounts/:id` | PERMISSION | crm:read / write / delete | ✓ | Zod | mutation | ACCOUNT_UPDATED | ownerId change not gated by leads:assign (F-15) |
| GET/POST `/api/contacts` | PERMISSION | crm:read / crm:write | ✓ + relations | Zod | POST mutation | CONTACT_CREATED | |
| GET/PATCH/DELETE `/api/contacts/:id` | PERMISSION | crm:read / write / delete | ✓ | Zod | mutation | CONTACT_UPDATED | |
| GET/POST `/api/properties` | PERMISSION | crm:read / crm:write | ✓ + relations | Zod | POST mutation | PROPERTY_CREATED | |
| GET/PATCH/DELETE `/api/properties/:id` | PERMISSION | crm:read / write / delete | ✓ | Zod | mutation | PROPERTY_* | assignedAgentId change (F-15) |
| GET/POST `/api/opportunities` | PERMISSION | crm:read / crm:write | ✓ + relations + active stage | Zod | POST mutation | OPPORTUNITY_CREATED | |
| GET/PATCH/DELETE `/api/opportunities/:id` | PERMISSION | crm:read / write / delete | ✓ | Zod | mutation | OPPORTUNITY_* | ownerId change (F-15) |
| GET `/api/pipeline/stages` | PERMISSION | crm:read | ✓ | — | — | — | |
| GET/POST `/api/tasks`, GET/PATCH/DELETE `/api/tasks/:id` | PERMISSION | crm:read / write / delete | ✓ + relations | Zod | mutation | TASK_* | ownerId change (F-15) |
| GET/POST `/api/proposals`, GET/PATCH/DELETE `/api/proposals/:id` | PERMISSION | crm:read / write / delete | ✓ + relations | Zod | mutation | PROPOSAL_* | `attachmentUrl` rendered as text only |
| GET/POST `/api/activities` | PERMISSION | crm:read / crm:write | ✓ + relations | Zod | POST mutation | ACTIVITY_CREATED | |
| GET/POST `/api/notes` | PERMISSION | crm:read / crm:write | ✓ + relations | Zod | POST mutation | NOTE_CREATED | |
| GET/POST `/api/calendar`, PATCH/DELETE `/api/calendar/:id` | PERMISSION | calendar:read / calendar:write | ✓ (provider takes workspaceId) + relations | Zod | mutation | CALENDAR_EVENT_* | |
| GET `/api/search` | PERMISSION | search:use | ✓ (8 tables) | q ≤ 100 chars | 60/min | — | |
| GET `/api/dashboard`, `/api/insights`, `/api/nba`, `/api/scoring/history` | PERMISSION | crm:read | ✓ | query params | — | — | |
| POST `/api/scoring` | PERMISSION | scoring:run | ✓ | Zod | 30/min | SCORE_UPDATED | |
| GET `/api/intelligence` | PERMISSION | intelligence:read | ✓ | — | — | — | Invalid `kind` → 500 (F-12, open) |
| POST `/api/intelligence` | PERMISSION | intelligence:run | ✓ + relations | Zod | 30/min | AI_ANALYSIS_COMPLETED | |
| POST `/api/intelligence/review` | PERMISSION | intelligence:review | ✓ | Zod | 30/min | INTELLIGENCE_APPROVED/REJECTED | |
| GET `/api/automations`, `/api/automations/executions` | PERMISSION | automations:read | ✓ | — | — | — | Invalid `status` → 500 (F-12, open) |
| PATCH `/api/automations` | PERMISSION | automations:manage | ✓ | Zod | — | — | No rate limit (admin-only, low risk) |
| POST `/api/automations` | PERMISSION | automations:execute | ✓ | — | — | AUTOMATION_EXECUTED | |
| POST `/api/whatsapp/messages`, `/api/whatsapp/draft` | PERMISSION | whatsapp:send | ✓ + relations | Zod | 30/min | WHATSAPP_MESSAGE_LOGGED | |
| GET `/api/whatsapp/conversations/:id` | PERMISSION | whatsapp:read | ✓ (provider takes workspaceId) | — | — | — | |
| POST `/api/whatsapp/simulate-inbound` | PERMISSION + DEMO | whatsapp:send + `DEMO_MODE=true` | ✓ + relations | Zod | 30/min | WHATSAPP_MESSAGE_LOGGED | |
| GET `/api/notifications` / PATCH | PERMISSION | notifications:read | ✓ **and** `userId` = self | — | — | — | |
| GET `/api/audit` | PERMISSION | audit:read | ✓ | `action` enum-validated (new) | — | — | Read-only. No endpoint mutates AuditLog |
| GET `/api/workspace` | PERMISSION | workspace:read | ✓ | — | — | — | Returns provider flags, never secrets |
| PATCH `/api/workspace` | PERMISSION | workspace:write | ✓ | Zod (URL, hex colour, lengths) | — | BRANDING_UPDATED | |
| PATCH/DELETE `/api/workspace/members/:userId` | PERMISSION | members:manage + `memberChangeDenial` | ✓ (404 for other workspaces) | Zod enum of assignable roles | mutation | MEMBER_ROLE_CHANGED / MEMBER_REMOVED | No self-change, OWNER immutable, only OWNER manages ADMINs. **Removal revokes the member's sessions** (new) |
| POST `/api/demo/reset` | PERMISSION + DEMO | demo:reset + `DEMO_MODE=true` | ✓ | — | 3/h | DEMO_RESET | |

## Server-rendered pages

Every `src/app/(app)/**/page.tsx` that reads data calls `requireAppAccess()` (a per-request cached DAL call: active `AuthSession` + membership + workspace not deleted) and scopes queries with its `workspaceId`. The `(app)` layout check alone doesn't protect pages (see F-01). A regression test (`tests/security/session-hardening.test.ts`) fails if a page reads Prisma without the call or trusts `session.user.workspaceId`.

## Verified attack results (live, 2026-09-27)

The HTTP harness ran against the local dev server with throwaway workspaces: **49/49 checks passed**. They include cross-workspace GET/PATCH/DELETE (404, data untouched), page-render IDOR, forged `workspaceId`/`leadScore`/`ownerId`, cross-workspace FKs, VIEWER write/audit access, AGENT self-promotion, SQL injection in search and sort, malformed ids and JSON, oversized fields and bodies, cross-origin `text/plain` POST and cross-site DELETE, stored XSS on the lead page, reuse of a copied cookie after logout, a removed member's API and page access, an expired server session, credential stuffing across rotating IPs, password spraying from one IP, and 429 and health/workspace leakage.
