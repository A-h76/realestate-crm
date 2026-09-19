# Synas Labs — Lead-to-Sale CRM

WhatsApp-first, PKR-denominated, site-visit-driven sales OS for Pakistani real estate.

See [PRODUCT.md](./PRODUCT.md) for the product source of truth.
See [SECURITY_REMEDIATION_REPORT.md](./SECURITY_REMEDIATION_REPORT.md) for the current security status.

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

## Demo Mode

Calendar and WhatsApp use Demo Providers unless real credentials are configured. UI and API responses never claim a real external send/sync occurred.

Never enable `DEMO_MODE` on a production CRM that holds real customer data.
