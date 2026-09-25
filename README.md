# Synas Labs — Lead-to-Sale CRM

WhatsApp-first, PKR-denominated, site-visit-driven sales OS for Pakistani real estate.

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

Calendar and WhatsApp use Demo Providers unless real credentials are configured. UI and API responses never claim a real external send/sync occurred.

Never enable `DEMO_MODE` on a production CRM that holds real customer data.

## Roles

| Role | Can do |
| --- | --- |
| OWNER | Everything, including branding, team roles/removal, automation config, demo reset, audit log |
| ADMIN | Same as OWNER, except it cannot change the owner's membership or grant/change ADMIN |
| MANAGER | Full sales workflow + assign/reassign leads, audit log, AI review, run automations. No branding, team management, automation config or demo reset |
| AGENT | Full sales workflow (leads, WhatsApp + take-over, tasks, site visits, opportunities, proposals). Cannot reassign leads (claims them via take-over), manage team/settings, or read the audit log |
| VIEWER | Read-only |

Permissions live in `src/lib/authz.ts` and are enforced server-side by `requirePermission`; the UI only mirrors them.

## UX audit demo workspace

A separate, fully synthetic workspace ("Synas UX Audit Demo", slug `synas-ux-audit-demo`) for external UX testing. Designer-facing notes (intended behaviour, known limitations): [UX_TESTING_GUIDE.md](UX_TESTING_GUIDE.md). WhatsApp conversations are replayed through the real inbound engine, so extraction, matching, handoffs and auto-replies are the product's own output. Phone numbers use the unallocated `+92 399` prefix; emails use `example.com`.

```bash
# DEMO_MODE=true and DEMO_SEED_PASSWORD must be set (see .env.example); WhatsApp must be on the demo provider
npx prisma migrate deploy        # adds the MANAGER role
npm run db:seed:ux-audit         # safe to re-run: rebuilds only this workspace
```

Sign in at `/login` with the password you set as `DEMO_SEED_PASSWORD`:

| Email | Role |
| --- | --- |
| `ux-owner@demo.synaslabs.com` | OWNER |
| `ux-manager@demo.synaslabs.com` | MANAGER |
| `ux-agent@demo.synaslabs.com` | AGENT |

The owner can also reset it from **Settings → Workspace → Reset Demo**. Scenario leads carry a `UX scenario:` note, and the seed prints a link to each one:

| Scenario | Lead |
| --- | --- |
| Flow 1: new WhatsApp lead, requirement extracted | Usman Tariq (unassigned) |
| Flow 2: incomplete requirement | Hira Aslam |
| Flow 3 + 6: grounded match, ready to convert to an opportunity | Kamran Ashraf |
| Flow 4: no grounded match, human handoff | Nadia Farooq |
| Flow 5: handoff waiting for take-over | Faisal Mehmood |
| Agent already took over, manual replies | Rabia Saleem |
| Flow 7: site visit tomorrow | Adeel Anwar |
| Flow 8 + 9: proposal viewed, negotiation, near close | Zara Hussain |
| Proposal sent / draft | Omar Siddiqui / Mehwish Kiani |
| Won deals (dashboard revenue) | Ayesha Rafiq, Saad Iqbal |
| Lost, low-priority, seller-side, reserved listing, no-show then completed visit, rescheduled visit | Shazia Noor, Maryam Khalid, Bilal Chaudhry, Tariq Mahmood, Fatima Zahid, Hassan Raza, Junaid Akram |
