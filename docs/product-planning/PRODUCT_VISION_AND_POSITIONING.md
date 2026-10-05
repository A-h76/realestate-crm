# Product Vision and Positioning — Synas Labs Lead-to-Sale CRM (US market)

> **Historical record.** It describes the codebase as it was before the US-market conversion, so it still mentions the retired Pakistan market (PKR, MARLA/KANAL, Zameen, Roman Urdu). Those references are intentional context, not current behaviour.

Status: planning draft, 2026-10-04. Companion docs: [CURRENT_STATE_CAPABILITY_AUDIT](./CURRENT_STATE_CAPABILITY_AUDIT.md), [PRODUCT_REQUIREMENTS](./PRODUCT_REQUIREMENTS.md), [MVP_ROADMAP_AND_RELEASE_GATES](./MVP_ROADMAP_AND_RELEASE_GATES.md), [PRODUCT_DECISION_REGISTER](./PRODUCT_DECISION_REGISTER.md).

Evidence labels used throughout: **[V]** verified in this repo or from a cited source; **[S]** secondary source (vendor blog / aggregator), treat as unconfirmed; **[H]** hypothesis, needs customer evidence.

---

## 1. The honest starting point

The repository is a working, well-secured CRM **built for Pakistan, not the US**: PKR default, MARLA/KANAL size units, `+92` phone normalization, Zameen as a lead source, Lahore default city, `Asia/Karachi` default timezone, Roman-Urdu reply generation, and WhatsApp as the only messaging channel [V — see audit §3]. WhatsApp is a minor channel for US residential leads; SMS, email, phone and web forms are the real ones.

What transfers to the US product is the *foundation*, not the market layer: multi-tenant isolation, RBAC with server-side checks, revocable sessions, audit log, webhook idempotency, advisory-lock dedup, a handoff concept, and an automation engine with idempotency keys. What does not transfer: the property model, phone/currency/units, the channel, the lead sources, the (absent) consent model, and the deterministic-regex conversation engine's language and vocabulary.

This matters commercially: the US build is roughly *a new market layer on a proven chassis*, and the plan must be honest that this layer is most of the work.

## 2. Who we are building for (ICP) [H]

**Primary:** owner-led residential teams / small independent brokerages, 5–15 agents, receiving a meaningful volume of inbound leads (web forms, paid ads, portal leads, referrals, calls), where the owner personally feels the pain of: slow first response, leads with no clear owner, follow-up that "should have happened", and no view of where leads die.

**Qualifying signals (to screen pilots):** ≥ ~100 new inbound leads/month; ≥ 1 paid lead source; a team lead/ISA/owner who is accountable for lead response; willingness to share lead-response data; an existing CRM they are *dissatisfied with at the execution layer* (not necessarily the feature layer).

**Secondary:** 15–30-agent teams (needs round-robin variety, team structures, stricter permissions). **Not now:** large brokerages with enterprise SSO/procurement, commercial real estate, property management, new-construction developers.

## 3. Competitive reality (do not assume competitors lack features)

| Competitor | What is verified / reported | Implication |
|---|---|---|
| **Follow Up Boss** (Zillow-owned) | Reported: Grow $69/user/mo ($58 annual); **Pro $499/mo for 10 users**; Platform $1,000/mo for 30 users; extra users $49 (Pro); AI features gated to Pro / calling add-on; unlimited integrations; 14-day trial [S: luxurypresence.com, cloudtalk.io, aitoolsbakery.com, jul 2026]. "Follow Up Ace" AI assistant (a third-party add-on inside FUB) drafts SMS/email and creates tasks [S]. | **Our hypothesised "$499/mo for 10 users" Team plan is the same price as FUB Pro.** We cannot win on price, and must not claim to. FUB is the likeliest incumbent for the ICP and is itself an integration surface. |
| **Lofty** (ex-Chime) | Not publicly priced; reported entry ≈ $449/mo, setup fees $299–$1,499, ad-management fees (20% / $150 min) [S]. "AI Workforce" automation/virtual assistant marketed [S]. | AI qualification/assistant already exists in market; "we have AI" is not differentiating. |
| **Sierra Interactive** | Reported $299.95–$724.95/mo (1–5 users), $500 setup fee waived on annual; **Lead Engage AI nurture add-on $199/mo** [S]. Strong on IDX/PPC websites. | Websites + CRM bundles; AI nurture is an add-on, i.e. priced separately. |
| **kvCORE / Command** (Inside Real Estate) | All-in-one; breadth. Not re-verified in detail here [S]. | Breadth incumbent; heavy for small teams. |

All figures above are from third-party aggregators dated July 2026 and **must be re-verified against official pricing pages before any external use** (decision D-02). None of the vendors' *internal* capabilities (response-time analytics, ISA queues, round-robin) were verified from official docs; assume they exist in some form.

**Conclusion:** AI replies, drip sequences, round-robin, task reminders and dashboards are table stakes. A switch must be justified by something else.

## 4. Where incumbents still leave pain [H — to validate in 10+ discovery interviews]

1. **Execution gap, not feature gap.** Tools *schedule* follow-ups; teams still miss them. Nobody measures "was the follow-up actually done, by whom, how late."
2. **Fragmented ownership of the first minutes.** A lead arrives at 9:40pm; AI, ISA, round-robin agent and manager notifications overlap or all assume someone else has it.
3. **AI is a black box to the owner.** Owners fear an AI sending a wrong price/availability/fair-housing-problematic message; they want to see, approve, pause and replay.
4. **"Where do we lose leads?" is answered with anecdotes.** Stage-to-stage and response-time leakage is not presented as a manager's diagnostic.
5. **Switching cost.** Migration risk keeps teams on a CRM they dislike.

## 5. Wedge selection

Candidates evaluated (§3.2 of the brief) against: commercial attractiveness (does an owner pay and feel it), technical achievability on this chassis, defensibility, and verifiability.

| Candidate | Commercial | Technical | Defensible | Verifiable | Verdict |
|---|---|---|---|---|---|
| Reliable AI inbound qualification | High, but crowded | Med (needs LLM + guardrails + SMS) | Low alone | Med | Component, not wedge |
| Actionable inbox coordinating AI + human | High | Med–High (we already have handoff, inbox) | Med | High (response-time, handoff metrics) | **Core of wedge** |
| Follow-up that is *completed and verified* | High | Med (durable jobs, send/deliver events, task closure) | Med | High | **Core of wedge** |
| Complete lead-to-showing workflow | High | High (calendar, inventory feed) | Med | High | Phase 2 extension |
| Stalled-lead detection + next best action | Med | Low–Med (we have `next-best-action`) | Low | Med | Feature inside wedge |
| Manager "where leads are lost" view | High for owners | Med | Med | High | **Core of wedge** (it is the proof layer) |
| Managed implementation + measured improvement | High | n/a (service) | Med (operational know-how) | High | **Go-to-market packaging** |

### Chosen wedge

> **Accountable speed-to-lead: every inbound lead gets a fast, policy-safe first response; every conversation has exactly one visible owner (AI, agent, or manager) at any moment; every promised follow-up is executed and verifiably closed; and the owner sees exactly where leads are lost.**

Why this one: it targets the owner's felt pain (lost leads, no accountability); it uses assets we already have (handoff, dedup, audit, automations with idempotency, inbox); it produces *measured evidence* (first-response time, follow-up completion, handoff backlog) which is what a skeptical team needs before paying; and it can run beside an incumbent CRM, lowering the adoption barrier. Defensibility is modest on features and comes from (a) the execution-and-evidence architecture (durable jobs, single-owner locking, replayable AI logs, consent enforcement), and (b) the managed pilot know-how. We should expect fast followers to copy features; we should not expect them to copy rigour quickly.

### Capability tiers

| Tier | Contents |
|---|---|
| **Required to compete at all** | Lead capture (web form, email-parse, API), US phone/E.164, SMS+email, consent/opt-out, unified inbox, round-robin/rules routing, tasks/reminders, pipeline, calendar, CSV import/export, USD/sqft/beds/baths inventory, RBAC, audit |
| **Required to win the niche** | Single-owner conversation lock + safe AI/human coordination, durable follow-up engine with stop conditions, verified response-time & follow-up-completion metrics, manager leakage view, policy-governed AI qualifier with draft/approve mode, honest integration-health screen, FUB companion integration |
| **Can wait** | AI voice, predictive scoring/ML, IDX websites, transaction management, e-signature, marketing campaigns, mobile native app, SSO |
| **Should not be built** | A portal-scraper; our own IDX website builder; a dialer; ad-buying/ad-management; "AI ROI" claims without a control group |

## 6. Positioning statement (hypothesis, not a claim)

> For owner-led residential teams that already pay for lead sources, **Synas** is the lead-response system that makes sure every inbound lead is answered, owned, followed up and accounted for — with AI that works inside rules you can see, pause and replay. Unlike general-purpose real-estate CRMs that schedule follow-up and hope, Synas shows you who actually responded, how fast, and where each lead was lost.

**Claims we may NOT make until measured:** "increases conversions", "X% faster response", "more closings", "saves N hours". Permitted until then: describing what the product *measures and enforces*.

## 7. What must be built and measured before performance claims

| Claim we'd like to make | Required instrumentation | Minimum evidence |
|---|---|---|
| "Faster first response" | `firstResponseAt` per lead from verified *sent* events by AI or human; business-hours-adjusted and raw | ≥ 8 weeks baseline (pre-Synas, from incumbent export) vs ≥ 8 weeks live, same team, same sources; report medians + n |
| "No missed follow-ups" | Follow-up objects with due/completed/skipped/failed states, completion by user | Follow-up completion rate with definition in REQ-RPT-02 |
| "Fewer leads lost" | Stage-reached funnel with lost reasons, source attribution | Cohort comparison; no causal claim without control |
| "AI is safe" | Replayable AI execution log, human-override rate, policy-violation rate, red-team suite pass rate | Pass the release gates in ACCEPTANCE_TEST_PLAN §AI |

## 8. Validation plan (before heavy engineering)

1. 10–15 discovery interviews with ICP owners/team leads; ask for their lead-response data and CRM export willingness. Kill criterion: < 3 of 10 can name a specific, recent lead-loss incident they'd pay to prevent.
2. Concierge test: manually run "speed-to-lead audit" on one team's exported lead data (response-time distribution, unassigned dwell time) and present to the owner. Pay-for-pilot is the real signal.
3. 3 paid pilots (see PRICING doc) before building P2 migration tooling.

## 9. Key risks to the vision

1. **Price parity with FUB Pro** removes any price argument (§3).
2. **Compliance exposure** — an AI texting people without defensible consent is an existential risk (see US_MARKET_COMPLIANCE_AND_SECURITY).
3. **Provider dependency** — 10DLC registration, SMS carrier filtering, calendar OAuth verification, and any lead-source feed can take weeks and are outside our control.
4. **Market-layer rewrite** — Pakistan-specific assumptions are woven through ~22 source files (audit §3).
5. **AI reliability** — a single fair-housing or fabricated-availability incident can end a pilot; default to draft/approve.
