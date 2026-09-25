# UX Testing Guide: Synas UX Audit Demo

This workspace exists for you to find real UX problems. Its data is synthetic, but the WhatsApp conversations were run through the product's actual inbound engine. The replies, extracted requirements, property matches and handoffs you see are what the product really does with those messages.

This guide covers two things. First, which behaviours are **intentional product rules** that you should evaluate as design decisions. Second, which of them are **known limitations**. Neither kind is a broken seed. If something here looks wrong to a customer or an agent, that is a valid finding. Please report it as a UX issue, not a data bug.

## Access

Sign in at `/login` with the password you were given:

| Email | Role | Use it to test |
| --- | --- | --- |
| `ux-owner@demo.synaslabs.com` | OWNER | Settings, branding, team, automations config, Reset Demo |
| `ux-manager@demo.synaslabs.com` | MANAGER | Assigning leads, audit log, AI review, running automations |
| `ux-agent@demo.synaslabs.com` | AGENT | Day-to-day sales work: inbox, take-over, tasks, visits, proposals |

Nothing leaves the CRM. WhatsApp and Calendar run on demo providers, so no real messages are sent and nothing syncs to Google.

## Resetting the workspace

You can change anything. To return to the starting state:

- **In the app:** sign in as the owner, then go to **Settings → Workspace → Reset Demo**.
- **From a terminal (engineering):** run `npm run db:seed:ux-audit`. It needs `DEMO_MODE=true`, `DEMO_SEED_PASSWORD` set, and the demo WhatsApp provider.

A reset rebuilds only this workspace. Other workspaces are never touched, and you can reset as often as you like. Relative dates ("tomorrow", "overdue") are recalculated from the moment of the reset.

## Scenario map

Every scenario lead has a `UX scenario:` note on its lead page.

| Flow | Lead | What you should see |
| --- | --- | --- |
| 1: new WhatsApp lead | Usman Tariq | Lead created from WhatsApp, requirement extracted, still unassigned |
| 2: incomplete requirement | Hira Aslam | Type and area known; purpose, budget and size still missing |
| 3 + 6: grounded match | Kamran Ashraf | Matches shown and detailed; ready to convert to an opportunity |
| 4: no grounded match | Nadia Farooq | Handoff triggered, not taken over (see below) |
| 5: handoff pending | Faisal Mehmood | Owner/documents question, waiting for someone to take over |
| Takeover done | Rabia Saleem | Agent took over and is replying manually |
| Follow-up | Imran Qadir | Manager took over and is following up manually |
| 7: site visit | Adeel Anwar | Visit scheduled for tomorrow |
| 8 + 9: proposal / negotiation | Zara Hussain, Omar Siddiqui, Mehwish Kiani | Proposal viewed / sent / draft |
| Won / lost / other | Ayesha Rafiq, Saad Iqbal, Shazia Noor, Maryam Khalid, Bilal Chaudhry, Tariq Mahmood, Fatima Zahid, Hassan Raza, Junaid Akram | Dashboard revenue, lost reasons, seller side, reserved listing, visit history |

## Human handoff vs. human takeover

These are two different states. Keeping them apart is intentional.

| | Handoff triggered | Human takeover |
| --- | --- | --- |
| Meaning | The AI decided a person should look at this | A person has actually claimed the conversation |
| How it happens | Automatically, from a customer message | An agent clicks **Take over** on the handoff banner in the WhatsApp inbox |
| What the CRM records | Open handoff task (To do), timeline entry, `HANDOFF_TRIGGERED` in the audit log, notification to the lead owner | The lead's owner becomes that agent, the handoff task moves to In progress, and a timeline note reads "Agent took over conversation" |
| Inbox badge / banner | Red **Human handoff required**, with a Take over button | Amber **Handoff in progress**, "You are handling this" |
| AI auto-replies | **Continue** on later customer messages | **Stop permanently** for that lead. Only people reply from then on |

Rabia Saleem and Imran Qadir show the takeover state. Customers keep writing after the takeover, and no automatic reply follows.

Things to evaluate:

- There are two ways a handoff can start. When the AI decides a handoff itself (Flow 4), the customer gets "an agent will follow up". When a message triggers the handoff detector directly (Flows 5, 7, 9 and Rabia's first message: owner/documents, visit, price negotiation, asking for a person), the customer gets **no automatic acknowledgement**. The conversation goes quiet until someone replies.
- Once a handoff is pending, a customer's next ordinary message can still get an AI reply.
- **Take over** appears only on a pending handoff banner. Imran's lead shows a takeover without a handoff. That lead has no banner and nothing on screen says the AI is paused.
- Takeover cannot be undone from the UI. The AI does not resume.

## Flow 4 is deliberately a "no match" scenario

Nadia wants a **commercial property for rent** in Gulberg. The demo inventory deliberately contains **no** commercial rentals. The expected result is:

- The AI hands off with reason "No grounded inventory match" and tells the customer an agent will follow up.
- The AI does **not** suggest alternatives, other areas or other property types. Recommending a substitute is a business judgement the AI is not allowed to make.
- The handoff is triggered but **not** taken over. It waits in the inbox for an agent.

The empty match list and the absence of suggestions are correct. Evaluate how clearly the inbox and lead page explain the next step to an agent.

## What the AI says about properties

The AI never invents property facts. Prices, titles, locations and counts come only from the matched listing records.

The matcher returns close matches as well as exact ones, for example another DHA phase or a similar house in another area. Because of that, the match message names a single area only when **every** match is in that area. Otherwise it breaks the matches down by their real areas, for example: *"Mere paas 4 properties hain jo aapki requirement ke qareeb hain (1 DHA Phase 6, 1 Cantt, 1 Valencia, 1 Bahria Town)."*

Whether customers expect "close" matches in other areas at all is a question for you to evaluate.

## Flow 2: why the same question is asked twice

Hira's conversation goes like this:

1. She says "House chahiye".
2. The AI asks "Purchase ke liye chahiye ya rent pe?"
3. She answers with the area ("DHA") instead of answering the question.
4. The AI asks the same question again.

This follows the current rules. The AI asks **one question at a time**, in a fixed priority order: purpose, then type, then area, then budget, then size. Hira's reply gave an area but not the purpose, so the purpose is still the most important missing detail. The same question is repeated word for word, with no acknowledgement that the area was captured. That is fair to judge as a conversation-design issue.

The AI gives up differently when a reply can't be understood at all. It hands off rather than asking the same question a second time.

## Site visits

- A visit has one of four statuses: **Scheduled**, **Completed**, **No-show** or **Cancelled**.
- **There is no "Rescheduled" status.** A rescheduled visit stays **Scheduled** with a new date and time. Junaid Akram's visit shows this. The previous time is kept only in the visit's internal data and its note ("Moved from yesterday at the client's request"). The UI does not show it as a separate state or show the reschedule history.
- **A visit is completed only when a person confirms it.** The CRM cannot detect that a physical visit happened. A visit stays Scheduled after its time has passed until someone marks the outcome. Marking a site visit Completed is what triggers the post-visit automations.
- **Known gap to evaluate:** the calendar screen can create visits but has no control to mark a visit Completed or No-show, or to move it to a new time. The seeded history (Hassan's no-show followed by a completed visit, Shazia's cancellation, Junaid's reschedule) was written directly into the data. In the current UI, an agent has no way to record a visit outcome.

## Who can see which leads

- **Agents see every lead in the workspace**, not only the leads assigned to them. This is the current product rule, not a seed error.
- Agents cannot assign or reassign leads. They become the owner only by taking over a handoff. Managers, admins and the owner can assign leads.
- Evaluate whether agents can tell "my leads" from "the team's leads" quickly enough, and whether seeing everything feels right for the agent role.

## Team management

**Settings → Team** manages **people who are already members**: you can change a member's role or remove them. **There is no invite flow.** You cannot add a new person from the UI. The owner's membership cannot be changed, and only the owner can grant or change the Admin role.

## Other intentional limitations

- **Command palette (Ctrl/Cmd + K):** Analyze Lead, Find Property Match and Draft WhatsApp Follow-up act on the lead you are currently viewing. From any other page they open the lead list so you can choose a lead. That page shows the hint "Pick a lead".
- **Proposal views** (for example "viewed 3 times") are seeded history. Proposals are not really sent, so no new view events will arrive.
- **AI assistance is deterministic** in this workspace. The optional language-model helper is off, so the same message always produces the same reply.

## What counts as a seed bug

Report it as a seed/data bug only if:

- a scenario lead doesn't match its `UX scenario:` note or the table above
- records from another workspace appear here
- something shows real personal data

Everything else, including behaviour described in this guide, is fair game as a UX finding.
