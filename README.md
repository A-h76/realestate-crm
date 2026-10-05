# Synas Labs — Lead-to-Sale CRM

Lead-to-sale CRM for US residential real estate: lead capture, WhatsApp conversations with AI qualification, showings, offers and closings.

See [PRODUCT.md](./PRODUCT.md) for the product source of truth.
See [SECURITY_REMEDIATION_REPORT.md](./SECURITY_REMEDIATION_REPORT.md) for the current security status.
See [DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md) for backup verification, restore procedure, and health check details.

## Quick start (local demo)

Demo Mode is an explicit opt-in. Production fails closed unless `DEMO_MODE=true`.

1. Ensure PostgreSQL is running and create DB `leadtosale_crm` (or update `DATABASE_URL` in `.env`).
2. Copy `.env.example` to `.env`.
3. Set `DEMO_MODE=true` and `DEMO_SEED_PASSWORD` to a local-only password you control.
4. `npm install`
5. `npx prisma generate`
6. `npx prisma migrate deploy` (or `npx prisma db push` for local prototyping)
7. `npm run db:seed`
8. `npm run dev`
9. Open http://localhost:3000 and sign in with the demo users created by seed. The password is the `DEMO_SEED_PASSWORD` you supplied — it is never shown in the UI or client bundle.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Security test suite |
| `npm run db:seed` | Deterministic demo seed (`DEMO_MODE=true` required) |
| `npm run db:reset` | Force-reset schema + reseed (local/demo only) |
| `npx tsx scripts/e2e-core.ts` | Core E2E workflow (dev server + demo env required) |
| `npm run db:seed:ux-audit` | Create/reset **only** the Synas UX Audit Demo workspace (never wipes other workspaces) |
| `npm run e2e:rbac` | Role + UX-flow E2E against a running dev server; restores the UX demo afterwards |

## Demo Mode

WhatsApp uses the demo provider only in Demo Mode or a non-production process. Selecting live mode (`WHATSAPP_BUSINESS_ENABLED=true`) without credentials, or running production with neither, records every send as **Failed**; it never falls back to a fake "sent". The calendar is the internal CRM calendar: there is no Google Calendar (or other external) sync. Settings > Integrations shows which mode is active. UI and API responses never claim a real external send/sync occurred.

Never enable `DEMO_MODE` on a production CRM that holds real customer data.

## Roles

| Role | Can do |
| --- | --- |
| OWNER | Everything, including branding, team roles/removal, automation config, demo reset, audit log |
| ADMIN | Same as OWNER, except it cannot change the owner's membership or grant/change ADMIN |
| MANAGER | Full sales workflow + assign/reassign leads, audit log, AI review, run automations. No branding, team management, automation config or demo reset |
| AGENT | Full sales workflow (leads, WhatsApp + take-over, tasks, site visits, opportunities, proposals). Cannot reassign leads (can take over unowned or own leads, not another agent's), manage team/settings, or read the audit log |

**Adding team members:** OWNER/ADMIN use Settings -> Team -> *Add a team member*. There is no email delivery, so a new person gets a one-time setup link (72h, single use) that the admin shares privately; the person sets their own password. Nobody is ever given a password. Re-adding someone who has not finished setup issues a fresh link.
| VIEWER | Read-only |

Permissions live in `src/lib/authz.ts` and are enforced server-side by `requirePermission`; the UI only mirrors them.

## UX audit demo workspace

A separate, fully synthetic workspace ("Synas UX Audit Demo", slug `synas-ux-audit-demo`) for external UX testing. Designer-facing notes (intended behaviour, known limitations): [UX_TESTING_GUIDE.md](UX_TESTING_GUIDE.md). WhatsApp conversations are replayed through the real inbound engine, so extraction, matching, handoffs and auto-replies are the product's own output. Phone numbers use the fictional `+1 312 555` numbers; emails use `example.com`.

```bash
# DEMO_MODE=true and DEMO_SEED_PASSWORD must be set (see .env.example); WhatsApp must be on the demo provider
npx prisma migrate deploy        # adds the MANAGER role
npm run db:seed:ux-audit         # safe to re-run: rebuilds only this workspace
```

Sign in at `/login` with `UX_AUDIT_PASSWORD` (falls back to `DEMO_SEED_PASSWORD` if unset):

| Email | Role |
| --- | --- |
| `ux-owner@demo.synaslabs.com` | OWNER |
| `ux-manager@demo.synaslabs.com` | MANAGER |
| `ux-agent@demo.synaslabs.com` | AGENT |

The owner can also reset it from **Settings → Workspace → Reset Demo**. Scenario leads carry a `UX scenario:` note, and the seed prints a link to each one:

| Scenario | Lead |
| --- | --- |
| Flow 1: new WhatsApp lead, requirement extracted | Tyler Brennan (unassigned) |
| Flow 2: incomplete requirement | Hannah Caldwell |
| Flow 3 + 6: grounded match, ready to convert to an opportunity | Kevin Mathis |
| Flow 4: no grounded match, human handoff | Natalie Ferraro |
| Flow 5: handoff waiting for take-over | Felix Mendoza |
| Agent already took over, manual replies | Renee Sorensen |
| Flow 7: site visit tomorrow | Andre Alvarez |
| Flow 8 + 9: proposal viewed, negotiation, near close | Zoe Hartman |
| Proposal sent / draft | Owen Sandoval / Megan Kiernan |
| Won deals (dashboard revenue) | Alexis Rafferty, Sydney Ingram |
| Lost, low-priority, seller-side, reserved listing, no-show then completed visit, rescheduled visit | Simone Nordstrom, Monica Hayes, Brandon Kowalski, Trevor Tomlin, Felicia Zane, Harrison Reed, Jonah Ackerman |
