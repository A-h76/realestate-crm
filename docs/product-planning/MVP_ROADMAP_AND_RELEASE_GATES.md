# MVP, Roadmap and Release Gates

Prioritization basis: customer impact, risk reduction, differentiation, implementation cost. Detailed tasks in [IMPLEMENTATION_BACKLOG](./IMPLEMENTATION_BACKLOG.md); test gates in [ACCEPTANCE_TEST_PLAN](./ACCEPTANCE_TEST_PLAN.md); open decisions in [PRODUCT_DECISION_REGISTER](./PRODUCT_DECISION_REGISTER.md). Effort sizes are engineer-weeks for a 2–3 engineer team and carry high uncertainty (±50%) until D-01/D-09 settle.

## 1. Scope tiers

### P0 — required before any production pilot (no lead loss, no data corruption, no unauthorized messages, no false status, no tenant exposure)
1. **Market layer:** US locale (USD, sq ft, beds/baths, E.164 phones, US address, time zones), brand/copy cleanup, `LeadSource` configurable. *(M)*
2. **Contact/Lead split + identity uniqueness** with migration from current schema. *(L)*
3. **Consent, suppression, Send Gate, STOP processing, quiet hours.** *(L)* — blocks everything outbound.
4. **Conversation entity + control version + outbox** (fixes AI/human race; replaces `lead:<id>` string). *(L)*
5. **Durable jobs + worker service** (intake processing, notifications, first-response, retries, DEAD view). *(L)*
6. **Lead capture:** hosted web form + API endpoint + `LeadIntake` raw log + "Intake problems" list; email-forward for named templates (P0.5). *(M)*
7. **SMS + email providers** with real integration states, 10DLC status, delivery webhooks idempotent. *(L, provider lead times)*
8. **Agent notifications outside the app** (SMS/email/push). *(S–M)*
9. **Routing** (round-robin + fallback + SLA timers). *(M)*
10. **Handoff** records (persisting, escalation, no AI after claim). *(M)*
11. **Self-signup, email verification, password reset, invite emails.** *(M)*
12. **Onboarding checklist + go-live gate + honest integration health.** *(M)*
13. **Today (minimal) + TTFR/unassigned/follow-up reports.** *(M)*
14. **Operational readiness:** clear INFRA-1…12; restore drill; alerts; incident runbook; CI with tests/typecheck/lint/audit; commit & review the 175 pending changes. *(M, operator-dependent)*
15. **AI: DRAFT mode** with US baseline extractor, policy classifier v1, execution log. *(M)*

### P1 — required to win the niche
Priority inbox sorting & saved views; sequences with branching & stop conditions; LLM extraction/drafting with validation pipeline and evaluation suite; AUTO mode gating; manager "where leads are lost" report; showings workflow (internal) + Google/Microsoft calendar; stage configuration & guards; merge UI; DSAR/deletion; MFA; FUB companion integration (subject to D-06); RLS on new tables; Google sign-in.

### P2 — required for credible CRM replacement
Import wizard (CSV generic + FUB/Lofty/kvCORE/Sierra presets), reconciliation, staging workspace, rollback; team/territory scoping; custom fields; listing feed (RESO/MLS) where license allows; reports parity builder; usage/billing; automation builder UI; SOC 2 Type I readiness; offers/contracts tracking replacing Proposals.

### P3 — expansion
AI voice (legal review), predictive scoring (needs outcome data), WhatsApp/web chat/ads integrations, IDX/website, enterprise SSO/SCIM, broker-level hierarchies, transaction coordination.

### Not building
Portal scrapers, ad management, dialer, marketing broadcasts, "AI ROI" claims, IDX website builder.

## 2. Plan

### Days 0–30 — Stabilize and de-risk (no new customer features)
| Item | Value | Effort | Acceptance | Risks |
|---|---|---|---|---|
| Review/commit pending changes; CI pipeline; green baseline (tests 689/689 already) | Safe base | S | CI green on main; typecheck/lint/build pass | Hidden regressions in 175 changes |
| Decisions D-01…D-06 (fork vs convert; hosting; SMS provider; FUB approach) | Unblocks design | S | Register updated | Founder availability |
| Discovery interviews (10) + concierge audit with 1–2 teams | Validates wedge | M | ≥ 3 sources willing to pay for pilot | Recruiting |
| Counsel engagement; consent & AI policy drafts | De-risks P0.3 | M | Written guidance on §7 checklist | Cost/time |
| Provider lead-time items started: 10DLC brand/campaign, SMS number, email domain (SPF/DKIM/DMARC), Google OAuth app verification | Removes calendar-time blockers | S (effort) / long wait | Registration submitted | Rejection cycles |
| Schema design review: Contact/Lead split, Conversation, Job, Consent migration plan | Prevent rework | M | Reviewed migration scripts on a copy of prod-like data | — |
**Release gate G0:** go/no-go on building P0 based on interviews + decisions.

### Days 31–60 — P0 core build
Market layer; Contact/Lead split; consent/suppression/Send Gate; Conversation+outbox+control version; job worker; intake (form/API); SMS/email providers; notifications; routing; handoff; auth (signup/verify/reset/invite email). *(Parallelizable in two tracks: data/identity and messaging.)*
Acceptance: Journey B human-only path and A (without calendar) pass end-to-end in staging with real provider sandboxes; concurrency, idempotency, opt-out suites green.
**Gate G1 (internal alpha):** all P0 test groups in ACCEPTANCE_TEST_PLAN §1–§6 pass; restore drill done; 10DLC approved or pilot declared email/human-only.

### Days 61–90 — Pilot readiness
Today + manager metrics (TTFR etc.); onboarding checklist/go-live; DRAFT AI + execution log; failure-mode tests (Journey I); security review + pen test scheduling; runbooks; pilot contract; 1–2 design-partner pilots start.
**Gate G2 (production pilot):** all P0 items done; INFRA checklist verified by operator; pen test critical/high findings closed; counsel sign-off on consent policy; kill switch tested; monitoring/alerts live; support rota.

### After day 90 (guide)
Days 90–150: P1 (sequences, LLM+eval, AUTO gating, showings+calendar, reports, FUB companion). Days 150–240: P2 (migration wizard etc.) driven by pilot demand. Re-plan at each gate.

## 3. Release gates (measurable)

| Gate | Criteria |
|---|---|
| **Any release** | CI: tests, typecheck, lint, build, `npm audit` (no high/critical unaddressed); migrations tested forward on a copy and rollback documented |
| **G1 alpha** | 100% pass on P0 test groups (consent, idempotency, isolation, concurrency); zero P0 bugs open; lead-to-notification p95 < 10 s in staging load test (50 leads/min); backup restore drill within RTO |
| **G2 pilot** | G1 + 7 consecutive days of staging soak with synthetic leads: zero lost leads (count in = count out), zero duplicate sends, zero sends to suppressed; DEAD jobs = 0 unexplained; accessibility scan clean on core screens; AI red-team suite: zero must-never violations (DRAFT mode); production smoke test passes; INFRA-1…12 verified |
| **AUTO mode (per workspace)** | G2 + evaluation suite pass for active prompt/policy version + 2 weeks DRAFT with ≥ 90% approve-without-material-edit + counsel sign-off + 10DLC approved |
| **P2 replacement offer** | Migration reconciliation proven on ≥ 2 real exports; rollback drill; uptime ≥ 99.9% over trailing 30 days; support SLA staffed |

Local green tests alone are never sufficient: each gate includes deployed-environment evidence.

## 4. Dependencies and critical path

Critical path: **10DLC approval (weeks)** → SMS AUTO; **Google OAuth verification (weeks)** → calendar; **counsel review** → AUTO; **D-01/D-09** → schema migration; **FUB API terms** → companion integration. Start all external-lead-time items in the first week.

## 5. Risks to schedule

Pending-changes churn; underestimating identity-model migration; provider approvals; hiring/availability; scope creep from "AI everywhere"; pilot customers wanting incumbents' features (reports parity) earlier than planned.
