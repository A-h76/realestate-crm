# Role & Permission Matrix

Source: `src/lib/authz.ts` (permission→role mapping), `src/lib/api.ts` (`requirePermission()`), and a full read of every API route handler, cross-checked against `docs/security/API-AUTHORIZATION-MATRIX.md`. Five roles exist: **OWNER, ADMIN, MANAGER, AGENT, VIEWER** (`WorkspaceRole` enum). There is no custom/configurable role system — these five are fixed in code.

**Verification method:** every permission below is enforced by `requirePermission(permission)` reading the caller's role from the `WorkspaceMember` row in the database (never from the JWT) inside the route handler itself — confirmed by direct code read of every route file listed in `docs/security/API-AUTHORIZATION-MATRIX.md`, and by the live attack-harness results recorded there (49/49, then 54/54 against a production build). Where a feature has **no UI path at all** (e.g. Contacts create/edit), the permission below describes what the API would enforce if called directly — not a reachable product capability. Those cases are marked "**API-only**."

## Permission primitives

| Permission | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| `crm:read`, `whatsapp:read`, `calendar:read`, `intelligence:read`, `automations:read`, `workspace:read`, `notifications:read`, `search:use` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `crm:write`, `crm:delete`, `csv:import`, `csv:export`, `whatsapp:send`, `calendar:write`, `intelligence:run`, `scoring:run` | ✓ | ✓ | ✓ | ✓ | |
| `leads:assign`, `intelligence:review`, `automations:execute`, `audit:read` | ✓ | ✓ | ✓ | | |
| `workspace:write`, `members:manage`, `automations:manage`, `demo:reset` | ✓ | ✓ | | | |

VIEWER is the only role with zero write permissions anywhere in the product. There is no permission that ADMIN holds and OWNER doesn't; OWNER is otherwise identical to ADMIN except OWNER's own membership can't be edited/removed by anyone, and only OWNER can manage ADMIN-level members (`memberChangeDenial()`, `src/lib/authz.ts`).

---

## Feature-level matrix

Legend: ✓ = can perform via a real product UI path · **API** = permission exists and is enforced server-side, but no UI exposes the action (API-only / unreachable in practice) · — = not permitted · "n/a" = action doesn't apply to this feature.

### 1. Leads

| Action | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| View | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create (manual / CSV) | ✓ | ✓ | ✓ | ✓ | — |
| Edit (fields, stage) | ✓ | ✓ | ✓ | ✓ | — |
| Delete (soft) | ✓ | ✓ | ✓ | ✓ | — |
| Assign / reassign owner | ✓ | ✓ | ✓ | — | — |
| Export (CSV) | ✓ | ✓ | ✓ | ✓ | — |
| Administer (none applicable) | n/a | n/a | n/a | n/a | n/a |

Server-side evidence: `src/app/api/leads/route.ts`, `leads/[id]/route.ts`, `leads/[id]/assign/route.ts`, `leads/csv/route.ts`. Lead ownership reassignment is the one place `leads:assign` is actually checked separately from `crm:write` — this is the pattern the security audit (finding F-15) says is **inconsistently applied** to other entities (see §5–7 below).

### 2. Contacts & Accounts

| Action | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| View | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create | **API** | **API** | **API** | **API** | — |
| Edit | **API** | **API** | **API** | **API** | — |
| Delete | **API** | **API** | **API** | — | — |
| Assign / reassign owner (Accounts only) | **API** (no `leads:assign` gate — see PF-02) | **API** | **API** | **API** | — |

**No role can create, edit, or delete a Contact or Account through the product UI** — the pages are read-only lists/detail views for every role, even OWNER (`docs/product/CRM-CURRENT-STATE-AUDIT.md` PF-01/PF-02). The permissions above are real and enforced if the API is called directly (e.g. by a script or a future UI), but today they describe no reachable capability for any role.

### 3. Properties

| Action | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| View | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create | ✓ | ✓ | ✓ | ✓ | — |
| Edit (incl. reassign agent) | ✓ | ✓ | ✓ | ✓ (no `leads:assign` gate on `assignedAgentId`) | — |
| Delete (soft) | ✓ | ✓ | ✓ | — | — |
| Export | n/a (no property CSV export exists) | | | | |

Server-side evidence: `src/app/api/properties/route.ts`, `properties/[id]/route.ts`.

### 4. Intelligence (AI/scoring/matching) & Insights

| Action | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| View intelligence runs / insights / dashboard | ✓ | ✓ | ✓ | ✓ | ✓ |
| Run analysis / scoring / property match | ✓ | ✓ | ✓ | ✓ | — |
| Review (approve/reject) an intelligence run | **API only — no UI exists for any role** | | | | |

Server-side evidence: `src/app/api/intelligence/route.ts`, `scoring/route.ts`, `insights/route.ts`. `intelligence:review` is held by OWNER/ADMIN/MANAGER, but since no UI calls `POST /api/intelligence/review` for *any* role, this permission is currently unreachable product-wide (see `CRM-CURRENT-STATE-AUDIT.md` PF-11).

### 5. WhatsApp & Automations

| Action | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| View conversations / inbox | ✓ | ✓ | ✓ | ✓ | ✓ |
| Send / draft a message | ✓ | ✓ | ✓ | ✓ | — |
| Take over a handoffed conversation | ✓ | ✓ | ✓ | ✓ | — |
| View automations & execution log | ✓ | ✓ | ✓ | ✓ | ✓ |
| Run the inactive-lead sweep (`automations:execute`) | ✓ (**API only — no UI button anywhere**) | ✓ (API only) | ✓ (API only) | — | — |
| Pause/resume an automation (`automations:manage`) | ✓ | ✓ | — | — | — |
| Create/edit a custom automation | **Not possible for any role — no UI or API exists** | | | | |

Server-side evidence: `src/app/api/whatsapp/*`, `src/app/api/automations/route.ts` (`PATCH` = manage, `POST` = execute), `src/app/api/automations/executions/route.ts`.

### 6. Sales Pipeline (Opportunities, Pipeline, Proposals, Tasks, Calendar)

| Action | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| View | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create (Opportunity, Proposal) | ✓ | ✓ | ✓ | ✓ | — |
| Create Task | **Not possible for any role — no UI exists**, only the automation engine/CSV/seed create Tasks | | | | |
| Create Calendar event | ✓ (Site Visit only; no other event type has UI) | ✓ | ✓ | ✓ | — |
| Edit / move stage, mark sent/viewed/accepted | ✓ | ✓ | ✓ | ✓ | — |
| Edit / cancel / complete a Calendar event | **Not possible for any role — no PATCH/DELETE UI exists** | | | | |
| Delete (soft) | ✓ | ✓ | ✓ | — | — |
| Reassign owner (Opportunity/Task/Proposal/Calendar) | ✓ **and ✓ for AGENT too — not gated by `leads:assign`, unlike Leads** (confirmed gap, extends security finding F-15) | | | | |
| Configure pipeline stages | **Not possible for any role — no UI or API exists** (read-only display only) | | | | |

Server-side evidence: `src/app/api/opportunities/*`, `pipeline/stages/route.ts` (GET only), `proposals/*`, `tasks/*`, `calendar/*`.

### 7. Reporting & Audit

| Action | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| View Dashboard / Reports | ✓ | ✓ | ✓ | ✓ | ✓ |
| View Audit trail | ✓ | ✓ | ✓ | — | — |

`AGENT`/`VIEWER` are blocked from `/audit` both by the sidebar's permission gate **and** independently by the page's own inline `roleHasPermission` check (`src/app/(app)/audit/page.tsx`) — this is the one page that renders a "you do not have permission" message rather than hiding the nav link or redirecting; confirmed server-enforced, not merely hidden.

### 8. Workspace Administration

| Action | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| View Settings page | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit branding | ✓ | ✓ | — | — | — |
| Change a member's role | ✓ (can touch ADMIN; ADMIN cannot) | ✓ (cannot touch another ADMIN or assign ADMIN) | — | — | — |
| Remove a member | ✓ | ✓ (same ADMIN restriction) | — | — | — |
| Invite / add a new member | **Not possible for any role — no UI or API exists at all; new members require direct database/seed access** | | | | |
| Reset demo data | ✓ | ✓ | — | — | — |

Server-side evidence: `src/app/api/workspace/route.ts` (`workspace:write`), `workspace/members/[userId]/route.ts` (`members:manage` + `memberChangeDenial()` guard rails: no self-edit, OWNER immutable, only OWNER manages ADMINs), `demo/reset/route.ts` (`demo:reset`).

### 9. Golden Path (guided walkthrough)

No explicit permission gate exists on the `/golden-path` page or its sidebar entry — **every role, including VIEWER, can open it.** Functional access is entirely implicit: each of its 13 steps calls a real CRM endpoint and inherits that endpoint's own permission requirement. A VIEWER will fail immediately on step 1 (`crm:write` required for lead capture) with no specific explanation; only the "assign" step degrades gracefully with a role-specific message. This is tracked as a minor product finding (PF-34) rather than a security gap, since no data is exposed — it simply fails.

---

## Frontend vs. backend enforcement — explicitly verified gaps

| Observation | Evidence |
|---|---|
| Every permission in this matrix is **re-checked server-side on every request** from the database `WorkspaceMember` row, never trusted from the UI or the JWT. | `docs/security/DATABASE-SESSION-SECURITY-AUDIT.md` §7–8, confirmed independently in all five subsystem audits by reading each route handler. |
| A hidden/disabled button is never the only protection anywhere in this codebase. | Every "UI-only-placeholder" and "no UI exists" finding in this matrix was confirmed by reading the **route handler's** `requirePermission()` call directly — the matrix states what the API enforces, not what a button's `disabled` attribute implies. |
| One confirmed UI-enforcement bug class, already fixed: pages used to trust `session.user.workspaceId` from the JWT without a live membership re-check (finding F-01, security audit). Every `(app)` page now calls `requireAppAccess()`, which re-validates session + membership per request. | `docs/security/DATABASE-SESSION-SECURITY-AUDIT.md` F-01. |
| **Unverified / "Unknown — not explicitly restricted":** whether a removed/role-downgraded user's *already-open browser tab* reflects the change before their next navigation. Session revocation is confirmed at the request layer (F-02, fixed); in-tab reactivity to a live permission downgrade was not traced in any subsystem audit. | Not evidenced in any of the five subsystem reports — flagged here rather than assumed. |
