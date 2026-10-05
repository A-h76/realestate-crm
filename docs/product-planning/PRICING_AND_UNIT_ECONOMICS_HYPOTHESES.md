# Pricing and Unit Economics Hypotheses

All prices are **hypotheses to validate**, not decisions. No margins are asserted: costs are listed as *to be measured* with formulas. Competitor prices come from third-party aggregators (July 2026) and must be re-verified from official pages (D-02). Context: [PRODUCT_VISION_AND_POSITIONING §3](./PRODUCT_VISION_AND_POSITIONING.md).

## 1. Market price anchors [S]

| Product | Reported price | Notes |
|---|---|---|
| Follow Up Boss Grow | $69/user/mo ($58 annual) | calling add-on $39 for AI call features |
| Follow Up Boss Pro | **$499/mo, 10 users** ($49/extra user) | AI features + unlimited calling/texting |
| Follow Up Boss Platform | $1,000/mo, 30 users | |
| Lofty | ≈ $449/mo entry; setup $299–$1,499; ad mgmt fees | not publicly priced |
| Sierra Interactive | $299.95–$724.95/mo (1–5 users); $500 setup (waived annual); Lead Engage AI $199/mo | |

**Implication:** the brief's starting hypothesis ($499/mo for ≤10 users) **equals FUB Pro**. A same-price offer must justify itself by the wedge (accountable response + visibility) and by removing the need for add-ons. Price parity is acceptable only if (a) we are *additional* to FUB during Phase A (so the customer pays both) — which makes the pilot fee and Phase A subscription the real hurdle — or (b) we replace it in Phase C. Consider a **Phase A "layer" price below FUB (e.g., $199–$299/mo) that rises to full price on replacement** (hypothesis H-P1).

## 2. Proposed packaging (hypotheses)

| Package | Price hypothesis | Includes | Excludes / limits |
|---|---|---|---|
| **Paid pilot** (8 weeks) | $750 one-time (range $500–$1,000) | Setup, one lead source + routing, SMS/email provisioning, DRAFT-mode AI, baseline-vs-pilot response report, weekly review | Migration of history; AUTO mode (needs gates); voice |
| **Team** | $499/mo up to 10 users (H-P2; test $399 / $599) | Core CRM, inbox (SMS+email), routing, durable follow-ups, reports, 3 lead sources, AI drafts, calendar | SMS/segments over allowance, AI usage over allowance |
| **Growth** | $899–$1,099/mo up to 25 users (H-P3) | + advanced routing, saved views, team scopes, 10 lead sources, priority support, AUTO mode eligibility | |
| **Enterprise** | Custom | SSO, SLA, DPA, custom retention, sandbox | Only when real requirement exists |
| **AI voice** | Separate, usage-priced (P3) | — | Not offered until legal review and cost data exist |
| **Migration/onboarding** | $0 (self-serve CSV) · $1,500–$3,500 managed (H-P4) | Mapping, sample import, reconciliation report, 2 training sessions | Source-system limitations |

**Pass-through and usage (measured, not marked up blindly):** SMS segments (carrier + provider fees + 10DLC fees), email volume, AI tokens, phone number rental, calendar sync (free). Include an allowance (e.g., 2,000 SMS segments + AI budget per 10 users — **placeholder, set after measuring pilots**) and bill overage at cost + stated margin. Display usage to admins (REQ-TEAM).

## 3. Unit economics: what to measure (no invented numbers)

Per workspace per month:
`Revenue = subscription + overage + services`
`COGS = hosting_share + DB_share + SMS_provider_cost(segments × per-segment cost + number rental + 10DLC fees) + email_cost + LLM_cost(Σ AiExecution.costUsd) + support_hours × loaded_rate + payment_fees`
`Gross margin = (Revenue − COGS) / Revenue` — **computed from measured pilot data**.
Instrumentation: `UsageRecord` (SMS segments, email, AI tokens), `AiExecution.costUsd`, support-time log, infra bill allocated by job/request volume. Pilot output: cost-to-serve per lead handled, per conversation, per agent.
Sensitivity table to fill after pilots: leads/mo (100/300/1000) × messages/lead × segments/message × AI turns/lead.

## 4. Value the customer must receive to justify the price

The owner should be able to point to: (1) measurable reduction in TTFR and unassigned dwell vs their own baseline; (2) follow-up completion rate they can see weekly; (3) fewer "lost between the cracks" leads (list of rescued leads); (4) no regression in agent satisfaction; (5) clear AI control with zero compliance incidents. A pilot "succeeds" only if at least three are met with data. We do not promise revenue lift.

## 5. Pilot design

- **Eligibility:** ICP criteria (Vision §2), ≥ 100 leads/mo, a named accountable manager, 8 weeks of exported baseline lead data.
- **Structure:** weeks 0–1 setup + baseline; weeks 2–7 live; week 8 readout. Weekly 30-min review; shared dashboard.
- **Success criteria (agreed up front, example):** median TTFR (business-hours-adjusted) ≤ 5 min for ≥ 80% of leads in covered sources; follow-up completion ≥ 90%; unassigned dwell p90 ≤ 10 min; zero policy incidents; ≥ 70% agent weekly activity.
- **Conversion to paid:** pilot fee credited against first 2 months if they continue; Phase A subscription activates automatically unless canceled; Phase C only through explicit gate.
- **Contract terms (hypothesis):** monthly, cancel with 30 days; data export on request within 5 business days at no charge; no auto-renewal lock-in during pilot; customer attests to lead-source consent responsibilities.
- **Support expectations:** pilot: business-hours response ≤ 4 h, urgent (messaging down) ≤ 1 h; Growth: priority; SLA credits only at Enterprise.

## 6. Evidence needed per tier

| Tier | Evidence that justifies it |
|---|---|
| Pilot fee | ≥ 3 owners accept paying before seeing the product (concierge audit sells) |
| Team | 3 pilots convert at ≥ $399 with usage within allowance; gross margin measured positive after support load |
| Growth | ≥ 2 teams > 15 agents ask for team scopes/advanced routing; support load measured |
| Voice add-on | Counsel clearance + cost per minute measured + ≥ 3 requests |

## 7. Pricing risks

FUB parity; price sensitivity of small teams; SMS cost volatility; AI cost scaling with chatty leads (cap AI messages per lead); support-heavy migrations eroding margin; "free" incumbent add-ons; discounting to win pilots setting low anchors.
