# AI Agent Behavior Specification

Scope: the AI that qualifies inbound leads and converses on SMS/email (and later WhatsApp/web chat). Architecture hooks (Conversation lock, Send Gate, AiExecution log) are in [SYSTEM_ARCHITECTURE_AND_DATA_MODEL](./SYSTEM_ARCHITECTURE_AND_DATA_MODEL.md); compliance in [US_MARKET_COMPLIANCE_AND_SECURITY](./US_MARKET_COMPLIANCE_AND_SECURITY.md). **This is a product spec, not legal advice; fair-housing and TCPA behaviors require counsel review before Auto mode ships.**

Design stance: **reliable before autonomous.** The system is a *policy engine with an LLM inside it*, not an LLM with a system prompt. Deterministic code decides *whether* and *what category* of message may be sent; the LLM only drafts wording and extracts fields, and its output is validated before use.

## 1. Today vs target

Today (repo): rule-based `extract-requirement.ts` / `conversation-intelligence.ts`; OpenAI used only as a fallback when intent is UNKNOWN; no consent gates, no mode switch, no execution log, no fair-housing policy, English + Roman-Urdu (audit §3.3). Target: retain the deterministic skeleton (intent → decision → templated reply) as the **safe baseline and fallback**, add schema-validated LLM extraction/drafting on top, and add the controls below.

## 2. Modes, channels, scope

| Mode | Behavior | Default |
|---|---|---|
| OFF | AI never acts; extractor may still *suggest* fields to humans | |
| DRAFT | AI proposes replies and field updates; humans approve/edit/discard; nothing customer-facing is sent by AI | **Yes (all new workspaces)** |
| AUTO | AI may send messages in the allowed-action set (§5) inside guard rails | Opt-in per workspace, per source, per channel |

Prerequisites for AUTO (all machine-checked): owner enabled; consent policy acknowledged and workspace state of operation set; SMS campaign approved (10DLC) for SMS; sandbox evaluation passed on current prompt/policy version (§9); kill switch reachable; quiet hours + business hours configured; escalation contact set. Channels P0/P1: SMS, email. WhatsApp retained as a channel where the customer has it. **Voice AI: out of scope P0–P2** (separately regulated: FCC treats AI-generated voices as "artificial" under the TCPA; requires counsel — compliance doc).

Per-conversation guard rails (hard-coded, workspace may only make stricter): ≤ 3 consecutive AI messages without a customer reply; ≤ 1 AI message per 60 s; no AI sends outside allowed hours; AI sends nothing after a human message in the thread unless control explicitly returned; message length ≤ 320 chars SMS (≤ 2 segments) unless asked a question needing more.

## 3. Qualification model

**Supported intents:** BUY, SELL, RENT, UNKNOWN (+ `OTHER` → human). Intent is a field with provenance like any other.

**Structured fields and allowed values (US):**

| Intent | Fields (key: type) |
|---|---|
| BUY | `locations[]` (city/ZIP/neighborhood strings → normalized), `priceMax`, `priceMin?`, `propertyTypes[]` (SFH, condo, townhome, multi, land), `bedsMin`, `bathsMin`, `sqftMin?`, `timeframe` (enum: ≤30d, 1–3mo, 3–6mo, 6+mo, browsing), `financing` (enum: cash, preapproved, needs-lender, unknown — *captured only if volunteered; AI never advises*), `mustHaves[]`, `agentExisting` (bool, "already working with an agent?") |
| RENT | `locations[]`, `rentMax`, `bedsMin`, `moveInDate`, `pets` (volunteered only), `leaseTerm` |
| SELL | `propertyAddress`, `timeframe`, `motivation` (free text, volunteered), `priceExpectation?` |
| any | `preferredChannel`, `bestTimeToContact`, `language` |

**Provenance (per field):** `STATED` (customer's own words; stores `sourceMessageId` and quote span), `IMPORTED` (trusted source, e.g. form field; stores source), `INFERRED` (LLM/heuristic with `confidence` 0–1 and rationale), `UNKNOWN`.

**Rules:**
1. Extraction output must validate against a zod schema; anything else is discarded and counted as `EXTRACTION_INVALID`.
2. `confidence ≥ 0.85` + explicit statement in text → store as STATED. `0.5–0.85` or paraphrase → INFERRED, shown to agents with a "confirm" chip; AI asks a one-line confirmation ("Just to confirm, ~$450k max?"). `< 0.5` → UNKNOWN, ask.
3. INFERRED never satisfies a "qualified" gate and never acts as a Stage-1 hard constraint in matching. It may be used for *soft ranking* only.
4. Contradiction (new STATED ≠ old STATED): newest statement wins **only if** it's explicit; otherwise keep both, mark `CONFLICT`, ask once. Old value superseded (append-only).
5. Ambiguity ("around 450" → 450k vs 4.5M; "next couple months") → ask with options, don't guess unit/magnitude; ranges stored as min/max.
6. Original message is always preserved verbatim and linked.
7. Humans can accept/correct/clear any field in one action; correction is recorded as `HUMAN_CORRECTION` for evaluation datasets.
8. **Question policy:** ask only for the highest-value missing field needed for the *next operational step* (to propose a showing or run a match: location, price, timeframe; beds secondarily). Max one question per message, max 2 asks per field, never re-ask a field in STATED/IMPORTED state, stop asking when `readyForNextStep` is true, then propose that step (matches or showing times) or hand to the agent.

Worked example: *"Hi, I'm looking for a three-bedroom house around Austin under $450,000, preferably in the next two months."* → `intent=BUY (STATED)`, `locations=["Austin, TX"] (STATED)`, `propertyTypes=[SFH] ("house") (STATED)`, `bedsMin=3 (STATED; "three-bedroom" → ≥3? ambiguity: exactly vs min → stored as 3 with `operator=GTE` INFERRED 0.7)`, `priceMax=450000 (STATED)`, `timeframe=1–3mo (STATED)`. Missing for next step: neighborhood/ZIP (optional), financing (do not ask unless customer opens it), existing agent (ask once, compliance-friendly). Next step: run Stage-1/2 match on verified inventory; reply: acknowledgement + one question ("Do you have particular Austin areas in mind, or open to anywhere in the metro?") — no property claims unless a VERIFIED_RECENT match exists.

## 4. Conversation behavior and guardrails

**Allowed in AUTO (autonomous):** acknowledge inquiry; ask the next missing-field question; answer questions *only* from approved facts (§6); share up to 3 VERIFIED_RECENT matched listings with link; propose showing slots *only if calendar availability is real*; schedule a permitted follow-up; summarize for agent; escalate.
**Requires human approval (even in AUTO):** anything mentioning price negotiation, offer strategy, commission, contract terms, HOA/legal/title/inspection advice, financing eligibility/rates, school or neighborhood quality, anything about the customer's protected-class-related circumstances, any listing flagged STALE or UNKNOWN availability, any first message to a lead whose consent record is UNKNOWN for the channel (blocked unless the channel is covered by the form's consent text), any outbound after a complaint.
**Immediate handoff triggers (and AI stops):** customer requests a human/agent/call; expressed frustration/complaint; legal/threat language; negotiation or offer; financing/legal questions beyond scripted deflection; discrimination-related or fair-housing-sensitive prompts; self-harm/emergency language (reply with safe guidance + handoff); suspected spam/bot; repeated low-confidence (2 consecutive); policy-check failure; provider/tool error on a required step; opt-out ambiguity ("stop… actually wait"); high-value signal (price ≥ workspace threshold, cash buyer, relocation with date ≤ 30d — configurable); first message in an unfamiliar language the agent doesn't support.

**Must never:** invent property facts (price, address, availability, amenities, taxes, HOA, school info), claim a showing time that isn't in the real calendar, imply it's human when asked ("Am I talking to a bot?" → truthful disclosure + offer human), provide legal/financial/tax/inspection/negotiation advice, characterize neighborhoods or occupants, filter or steer by protected characteristics or their proxies (race, color, religion, sex, disability, familial status, national origin, plus state/local classes e.g. source of income, sexual orientation, gender identity, marital status, military status — treated as a **configurable, jurisdiction-aware list** reviewed by counsel), use demographic/"crime"/"school quality" claims as steering, collect SSNs/bank/card numbers, send after STOP, or discuss other customers.
**Required disclosures:** first AI-originated message in a conversation identifies the brokerage (and "AI assistant" wording per workspace policy / state law review — D-12); opt-out language on first marketing-type message ("Reply STOP to opt out"); no deceptive "this is [agent name]" impersonation.

**Fair-housing handling pattern:** if a customer asks for steering ("somewhere without kids/families like us", "a safe white neighborhood", "near my church"), the agent: does not endorse/filter; replies with a neutral statement ("I can't help narrow by those factors, but I can share homes by price, size, and location you choose.") and flags the conversation for human review; logged as `POLICY_FAIR_HOUSING`. Objective criteria (price, beds, sqft, commute *distance to an address the customer provides*) are allowed.

**Sensitive categories:** complaints → handoff + apology template; legal ("can I back out of the contract") → "I'm not able to advise on legal matters; your agent will follow up" + handoff; financing ("will I qualify") → no estimate, offer lender-referral per brokerage policy via human; PII beyond contact basics → ignore/redact and don't store.

## 5. Tools the agent may call (function-calling allowlist)

All tools are server-side, workspace-scoped, and authorize against the same Send Gate / RBAC as humans; the model never receives credentials.

| Tool | Effect | Autonomy |
|---|---|---|
| `get_lead_context` | read lead, fields+provenance, last N messages | auto |
| `update_qualification_fields` | proposes field changes with provenance | auto in DRAFT/AUTO (writes INFERRED/STATED per rules) |
| `search_inventory` | runs deterministic matcher (hard constraints first) | auto; returns verified status |
| `get_listing_facts` | returns *structured stored facts only* | auto |
| `get_availability_slots` | calendar slots (only if CONNECTED) | auto |
| `propose_showing` | creates PROPOSED showing, drafts message | AUTO only if calendar real; else draft |
| `create_followup` | task/sequence enrollment within policy | auto |
| `send_message` | **enqueues through Send Gate**, not direct | mode-dependent |
| `create_handoff` | opens Handoff | auto |
| `summarize_for_agent` | internal summary note | auto |

Answers to factual questions use **retrieval from approved knowledge** only: structured listing facts, workspace FAQ docs (brokerage-authored, versioned), team/agent bios. If the answer isn't in sources → "I don't have that detail; I'll have <agent> confirm" + task; never improvise.

## 6. Output validation pipeline (every draft)

1. LLM returns JSON `{intent, fieldUpdates[], reply?, requestedTool?, confidence, handoff?}`; schema-validated.
2. **Claim checker:** every number/address/availability token in `reply` must map to a tool result in the same execution; unmatched → block.
3. **Policy classifier** (deterministic keyword/regex layer + small LLM classifier): protected-class steering, legal/financial advice, negotiation, disallowed disclosures, profanity, PII requests → block or handoff.
4. **Length/tone formatter** and opt-out/disclosure injector.
5. **Send Gate** (consent, suppression, quiet hours, frequency, mode, control version).
6. Persist `AiExecution` (inputs redacted, tool calls, policy results, decision) — then Draft or enqueue.
Any failing step produces `BLOCKED_BY_POLICY` and, if customer is waiting, a handoff with the reason.

## 7. Versioning, logging, replay

`AiAgentConfig.version` (policy, allowed tools, thresholds), `promptVersion` (file hash of prompt templates in repo), `model` id recorded on every execution. A change to policy/prompt/model requires re-passing the evaluation suite (§9) before AUTO stays enabled (CI check + runtime flag `evaluatedVersion == activeVersion`). **Replay:** any execution can be re-run offline against stored inputs with the same tool results to reproduce the draft (determinism not guaranteed; storing outputs ensures auditability). Retention of redacted inputs: default 90 days (counsel/customer configurable).

## 8. Failure handling

| Failure | Behavior |
|---|---|
| LLM timeout/5xx | Retry once; then deterministic baseline reply if allowed, else no AI reply + handoff task; SLA timer continues |
| Invalid JSON/schema | Discard, retry once with repair prompt, then handoff |
| Low confidence | Ask a clarifying question or hand off per thresholds |
| Tool error (calendar/inventory) | Never claim success; "I'll confirm with <agent>" + task |
| Control changed mid-flight | Abort (SUPPRESSED, `ABORTED_CONTROL_CHANGED`) |
| Customer replies while draft pending | Draft invalidated; re-plan with new message |
| Duplicate inbound | Dedupe at webhook; AI turn keyed by `lastInboundMessageId` (one execution per inbound) |
| Kill switch | Workspace/global flag stops all AI sends within one job cycle; DRAFT mode remains |

## 9. Evaluation and release gates

Offline suites run in CI on any change to prompts/policy/model: (a) **extraction accuracy** on a labeled set (≥ 100 US-style messages; target field-level precision ≥ 0.95 for STATED fields, with INFERRED excluded from precision); (b) **guardrail red-team** (≥ 200 adversarial cases: fair-housing steering, legal/financial advice, negotiation, prompt injection in customer messages and in listing text, requests for other customers' info, "are you a bot", opt-out variants) — **zero** tolerated violations on the must-never list; (c) **hallucination tests** (listing questions with absent data must yield "don't know"); (d) **handoff recall** ≥ 0.98 on must-handoff cases; (e) latency p95 < 8 s per turn. Online monitoring: human-override rate, policy-block rate, complaint/opt-out rate after AI messages (leading indicator), cost per conversation. AUTO is released per workspace only after a 2-week DRAFT period where ≥ 90% of drafts are approved without material edits (threshold to be tuned, D-13).

## 10. Prompt-injection and data safety

Customer text, listing descriptions, and imported notes are *untrusted data*: passed in delimited fields, never as instructions; tools ignore instructions in data; model has no write tool without schema validation; no outbound URLs except stored listing URLs; PII minimized in prompts (names/phone not required for extraction).

## 11. UX contract (see UX doc)

Everything AI is labeled **AI** in thread, summaries, fields (provenance chips), and audit; composer shows AI state banner; manager can pause AI per conversation/source/workspace; each AI message can be opened to show "Why: sources, fields used, checks passed".

## 12. Phase scope

P0: DRAFT mode + deterministic baseline adapted to US vocab + Send Gate + handoff + execution log (no LLM required to ship P0). P1: LLM extraction/drafting with validation pipeline, evaluation suite, AUTO gated. P2: return-to-AI policies, multi-step planning. P3: voice, predictive scoring.
