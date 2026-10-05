# US Market Compliance and Security

**Not legal advice.** This document turns compliance topics into product controls and a list of questions for qualified US counsel. Law-dependent behaviors are **configurable and default to the conservative setting**. Legal-status facts below were checked via secondary sources on 2026-10-04 and **must be re-verified by counsel**. Related: [AI_AGENT_BEHAVIOR_SPEC](./AI_AGENT_BEHAVIOR_SPEC.md), [SYSTEM_ARCHITECTURE_AND_DATA_MODEL](./SYSTEM_ARCHITECTURE_AND_DATA_MODEL.md).

## 1. Current state in the repo

No consent, opt-out, suppression, quiet-hours, retention, or data-subject workflow exists (audit §1.2). The conversation engine sends automatically to any inbound sender. Soft-delete only. Security fundamentals (auth, sessions, RBAC, audit, rate limits, HMAC webhooks, CSP/HSTS) are strong. This document's controls are therefore almost all **new build**, and none of the SMS/automation features may ship to production before the P0 controls in §3 exist.

## 2. Regulatory map → product controls

| Area | What we need to be careful about | Product control | Question for counsel |
|---|---|---|---|
| **TCPA (texts/calls)** | Autodialed/prerecorded/artificial-voice calls and texts to cell phones need prior express consent; marketing/telemarketing needs prior express *written* consent; consent/revocation evidence matters in litigation | `ConsentRecord` per channel×purpose with evidence; Send Gate blocks without a qualifying record; separate purposes (transactional/service vs marketing vs AI-automated); consent text versioning (`policyVersion`); STOP handling | Does a customer-initiated inbound text or web-form submission authorize AI-composed replies? Which follow-up types (sequence nurture) require written marketing consent? |
| **FCC one-to-one consent** | Reported: rule vacated by the 11th Cir. (Jan 24, 2025) and FCC formally removed it (Sept 2025) [S] | Lead-form consent not assumed to transfer between sellers; store *which brokerage* consent was granted to | Confirm current status; whether lead-vendor consent can be relied upon |
| **FCC revocation rules** | Reported: effective Apr 11, 2025; broader "revoke-all" provision delayed to Apr 11, 2026 [S] — status after that date unverified | Accept revocation via any reasonable words ("stop", "quit", "no more", "unsubscribe", "don't text me"); process within 10 business days max, we target seconds; scope: revoke applies to *all automated* channels to that number from the workspace by default (configurable per counsel) | Final scope of revoke-all; time limits; one-time confirmation text allowance |
| **AI voice** | FCC (Feb 2024) treats AI-generated voices as "artificial" under TCPA [S] | **No AI voice in P0–P2.** Any voice product requires explicit written consent flow & legal sign-off | Required disclosures, consent language, state rules |
| **Do Not Call** | National DNC + state lists; exemptions (established business relationship, inquiry window) | `Suppression` supports `DNC`; optional DNC-scrub provider integration (P2); EBR/inquiry-window timestamps stored (`lastInquiryAt`) to compute eligibility; manual calls warn when number on internal DNC list | Does the team need federal/state DNC scrubbing for follow-up calls after a lead inquiry? |
| **Quiet hours** | Calling/texting windows (generally 8am–9pm recipient local; some states stricter, e.g., FL/OK/MD variants) | Send Gate enforces recipient-local window derived from area code/ZIP (conservative fallback: workspace TZ, narrower of 9am–8pm); state-specific overrides table maintained by Synas legal ops | State matrix |
| **Carrier rules (10DLC / CTIA)** | A2P SMS needs brand + campaign registration; content restrictions; opt-in/out language | Integration state `ACTION_REQUIRED` until campaign approved; templates include brand name + STOP/HELP; throughput limits respected; no SMS in AUTO until approved | Provider selection / ISV liability |
| **CAN-SPAM** | Accurate headers, physical address, clear opt-out honored ≤10 business days, no deceptive subject | Email templates enforce footer (workspace postal address required before email sequences), one-click unsubscribe, suppression sync, separate transactional/commercial classification | Whether lead nurture emails are "commercial" for each brokerage; sender identity rules |
| **Call recording** | All-party-consent states (e.g., CA, FL, WA...) | No call recording in P0–P2; if added: pre-call disclosure + state matrix | n/a now |
| **Fair Housing Act + state/local** | No discrimination or steering by protected class (federal: race, color, religion, sex, disability, familial status, national origin; many states/localities add more); advertising and AI-assisted recommendation risk | Matching uses objective criteria only; AI policy classifier and refusal templates; flagged conversations queue for manager review; audit of any AI message touching sensitive topics; no demographic enrichment; periodic bias test suite | Jurisdiction list; whether "family-friendly" style descriptors from MLS data may be relayed; HUD guidance on AI/advertising |
| **State AI/automation laws** | Emerging AI-disclosure and "high-risk AI" laws (e.g., Utah disclosure; Colorado AI Act effective date has moved—verify) | Disclosure text configurable per state; AI doesn't make eligibility/consequential decisions; human approval for sensitive categories | Applicability to lead-qualification bots; disclosure wording |
| **Real-estate licensing/advertising rules** | AI cannot perform licensed activity (negotiating, advising) in many states; brokerage name disclosure | AI scope limited to administrative/info tasks; every AI message names the brokerage; negotiation → human only | State-by-state limits on unlicensed assistants and AI |
| **Privacy (CCPA/CPRA and other state laws)** | Notice, access, deletion, correction, opt-out of sale/share; service-provider/processor terms | Data inventory; DSAR workflow (§4); no sale of data; DPA with customers; subprocessor list; retention settings | Is Synas a "service provider/processor"? Which states apply to launch customers? |
| **Data security / incidents** | State breach-notification laws; contractual security commitments | Incident response runbook, logging, encryption, access controls (§5) | Notification timelines & contacts |
| **Vendor management** | SMS/email/LLM/calendar providers process PII | DPAs; LLM provider zero-retention/no-training terms; subprocessor disclosure | Contract terms |

## 3. Consent, suppression, and Send Gate (P0 design)

**ConsentRecord (append-only):** `contactId, channel (SMS|EMAIL|VOICE|WHATSAPP), purpose (SERVICE|MARKETING|AI_AUTOMATED), status (GRANTED|REVOKED|UNKNOWN), source (WEB_FORM|INBOUND_MESSAGE|IMPORT|AGENT_ATTESTED|PAPER), evidence {consentTextShown, formId, url, ip, userAgent, timestamp, messageId}, policyVersion, scope note, grantedAt, revokedAt`. Evidence-less grants may only be recorded as `UNKNOWN`; `AGENT_ATTESTED` requires a text note and is flagged for audit; imports default to UNKNOWN unless evidence is supplied.

**Inbound inquiry is not blanket consent.** Default policy (until counsel says otherwise): an inbound customer-initiated message permits *replying to that inquiry* (SERVICE) on that channel, not later marketing sequences or AI-automated outreach on other channels. Web-form submissions grant what the displayed consent text says. Workspace policy settings map "source → what consent it confers" and are reviewed by counsel before enabling.

**Suppression:** `(workspaceId, channel, address)` unique; reasons STOP, DNC, BOUNCE, COMPLAINT, MANUAL. Highest priority; **imports, API calls, automations, and bulk actions cannot remove or bypass it**; lifting requires the *customer's* new explicit opt-in with evidence, creating a new ConsentRecord and an audited `SUPPRESSION_LIFTED`. Global-across-workspace email/SMS suppression (same address in another tenant) is *not* shared (tenant isolation) except for provider-level carrier blocks.

**Send Gate** (single function; all outbound automated and human SMS/email pass through it; human sends can be allowed with a warning for SERVICE replies where counsel agrees):
1. Not suppressed (address-level); 2. consent for (channel, purpose) is GRANTED (or covered by the inbound-reply exception); 3. quiet-hours/time window OK (else reschedule, not drop); 4. frequency caps OK; 5. conversation control matches caller's `controlVersion`; 6. AI mode permits (DRAFT → creates draft); 7. channel integration CONNECTED and campaign approved; 8. content checks (opt-out language present when required; no prohibited content). Result `ALLOW | DEFER(until) | BLOCK(reason)`; `BLOCK` recorded as `SUPPRESSED` message with reason code, visible in the thread and counted in reports.

**Distinct rule sets** are modeled as `purpose` + `sendKind` (MANUAL_REPLY, TRANSACTIONAL_NOTICE (e.g., showing reminder requested by customer), AUTOMATED_REPLY, SEQUENCE_NURTURE, MARKETING_BROADCAST). Broadcast marketing is **out of scope P0–P2**.

## 4. Privacy, retention, access

- **Data inventory** (PII: names, phones, emails, addresses, message bodies, financial hints volunteered by customers). Never collect SSN/bank/card; AI redacts such tokens; UI warns agents.
- **Retention:** customer-configurable defaults — messages: brokerage record-keeping rules often require multi-year retention (counsel/broker decides the period); default "retain until deletion request or workspace policy"; AI input snapshots 90 days; webhook raw payloads 30 days; audit logs ≥ 2 years.
- **DSAR/deletion workflow (P1):** admin initiates for a Contact → export package (JSON/CSV) and/or deletion job: hard-delete PII, retain minimal suppression record (hashed address) so STOP stays enforced; audit retains non-PII event shells. Legal holds block deletion.
- **Workspace offboarding:** full export (CSV + JSON + attachments index), then scheduled purge after contractual period; export is audited.
- **Access controls:** least privilege roles; agent visibility default "own + team-visible setting"; export permission separate from read; PII-bearing reports watermark/audit.

## 5. Security and reliability requirements

| Requirement | Design | Status |
|---|---|---|
| Tenant isolation | `workspaceId` scoping in data layer; tests per entity & job/report/import/export/search; RLS on new tables (P1) | Strong today; extend |
| Server-side authz | Permission checks per route; new permissions: `inbox:claim`, `consent:manage`, `ai:configure`, `integrations:manage`, `import:run`, `data:export`, `privacy:delete` | Extend `authz.ts` |
| AuthN | Add email verification, password reset, optional MFA (TOTP) P1, SSO P3; password policy; breached-password check | Missing |
| Sessions | Existing revocable sessions | Strong |
| Secrets | Encrypted at rest (envelope); provider tokens never exposed; rotation runbook | Missing for new integrations |
| Webhook auth | Signature verification per provider; replay window; idempotency claim | Pattern exists |
| Rate limiting | Per IP/workspace/API key; form endpoints with bot protection | Exists; extend |
| Input validation | zod at every boundary; raw-payload size limits; CSV/ file-type checks, virus scan for uploads (P1) | Partial |
| Exports | Permission + audit + rate limit + signed expiring URL | Partial |
| Encryption | TLS everywhere; DB at-rest (INFRA-2 unverified); backups encrypted | Unverified |
| Backups/restore | Daily + PITR if plan supports; **quarterly restore drill with row-count and checksum verification**; RPO ≤ 24 h (P0) → ≤ 1 h (P2); RTO ≤ 4 h | Docs exist; not verified |
| Monitoring | Structured logs w/o PII; alerts: webhook error rate, job oldest-pending-age, DEAD jobs, send failure rate, health; uptime check; error tracking | Partial |
| Dependency mgmt | `npm audit` in CI, Dependabot, SBOM; pin Node | Missing in CI (no CI config found) |
| Incident response | Runbook: triage, containment, customer notification templates, regulator timeline matrix | Missing |
| Pen test | Third-party test before first paid production pilot with real PII | Missing |
| Audit | Immutable-ish: app role has INSERT only on `AuditLog`; retention job separate role | INFRA-5 open |
| SOC 2 | Not required for pilot; plan Type I within ~12 months of first >5 customers (D-15) | Planned |

**Reliability objectives (proposed, size-appropriate):** inbound webhook ack p99 < 1 s (persist-then-process); lead-to-agent-notification p95 < 10 s; monthly availability target 99.5% for pilots (≈ 3.6 h/month), 99.9% from P2; message send success-or-visible-failure 100% (no silent loss); recovery objectives RPO/RTO above. Runbooks needed: provider outage, DB failover/restore, stuck worker, DEAD job triage, opt-out failure, suspected breach, rollback of migration (existing: `docs/ops/ROLLBACK-RUNBOOK.md`).

**External dependency matrix:** DB (critical; down = app down), SMS provider (send fails visibly; inbound lost only if provider can't retry — require provider webhook retry + our idempotent receiver), email provider, LLM provider (degrade to human), calendar providers (degrade to manual), hosting (Railway; single-region risk accepted for pilots), DNS/CDN. For each, define alert and customer-facing status text.

## 6. Release risks (compliance-specific)

1. Shipping AI/auto SMS before consent + suppression + quiet-hours + counsel review — **blocker**.
2. Importing contacts from an incumbent without consent evidence → defaults UNKNOWN → no automated outreach until resolved.
3. Fair-housing incident from LLM wording — mitigated by DRAFT default, policy classifier, red-team gates; still non-zero.
4. 10DLC delays — pilot may be email/human-only for weeks.
5. State-law drift — maintain a quarterly legal-review cadence and a configuration (not code) path for state rules.
6. Evidence retention conflicts (retain consent evidence vs delete on request) — resolve via legal-hold/minimal-record policy.

## 7. Items requiring legal review before enabling (checklist)

☐ Consent language for web forms and imports ☐ Scope of inbound-inquiry reply rights ☐ Revocation scope & timing ☐ Quiet-hours/state matrix ☐ AI disclosure wording & state laws ☐ Fair-housing protected-class list per launch state ☐ Real-estate licensing limits for AI tasks ☐ DNC obligations for follow-up calls ☐ CAN-SPAM classification & footer ☐ Retention periods ☐ Customer terms (DPA, subprocessor list, liability for customer-supplied consent) ☐ Pilot agreement allocating consent responsibility (customer attests to lead-source consent).
