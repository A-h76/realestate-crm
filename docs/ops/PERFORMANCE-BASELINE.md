# Performance baseline (local)

**These are local numbers. They are not a production guarantee, an SLO, or a load test.**

## How to reproduce

```bash
npm run build
npm run perf:http          # starts `next start`, signs in, measures, writes scripts/perf-http-results.json (git-ignored)
```

The harness (`scripts/perf-http.ts`) uses the real HTTP stack with authentication, RBAC and rate limits in place.
Each endpoint gets 3 warm-up requests and 10 measured sequential requests. `stats.median` is p50 and `stats.p95` is the
nearest-rank 95th percentile of those samples; with 10 samples p95 equals the slowest sample. The results file begins
with an `environment` block (commit, Node, OS, CPU, memory, whether the database is on the same machine) so a number is
never separated from where it came from. It also measures a 100 / 1,000-lead volume workspace and CSV import.
Extend `RUNS` in the script for tighter percentiles.

## Run recorded here

| | |
| --- | --- |
| Date | 2026-10-04 |
| Code | commit `cf3895a` plus the uncommitted Batch 1-5 working tree |
| Machine | Windows 11, Intel Core i7-1255U (12 threads), 43 GB RAM, Node v24.15.0 |
| Topology | app, Postgres and load generator **all on one machine**; no network latency; single instance, production build |
| Data | local demo workspace for baseline GETs; an isolated generated workspace (deleted after) for volume |
| WhatsApp / AI | demo provider and deterministic AI; no external calls |

Milliseconds, wall-clock per request including response body:

| Route | p50 | p95 | | Route | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- |
| GET /api/leads | 17.8 | 20.2 | | POST /api/leads | 19.1 | 23.9 |
| GET /api/opportunities | 15.1 | 16.7 | | PATCH /api/leads/:id | 15.7 | 20.8 |
| GET /api/dashboard | 21.2 | 27.0 | | PATCH /api/opportunities/:id | 19.3 | 31.8 |
| GET /api/search?q=dha | 16.3 | 20.5 | | POST /api/scoring | 21.9 | 27.2 |
| GET /api/insights?range=30d | 54.6 | 84.4 | | POST /api/intelligence | 22.3 | 32.1 |
| GET /pipeline (page) | 28.7 | 46.6 | | POST /api/whatsapp/messages (demo) | 20.2 | 22.9 |
| GET /leads (page) | 24.0 | 26.0 | | POST /api/calendar | 14.7 | 15.7 |

With 1,000 leads in a workspace, `GET /api/leads` measured a 19.1 ms median. A 100-row CSV import took about 240-300 ms
(three runs, classified NORMAL, 200-500 ms). The endpoints in the table all classified FAST (< 200 ms).

## What this does and does not tell you

- It shows the code paths and indexes are not pathological at this data size, and gives a number to compare the next
  run against on the same machine.
- It says nothing about Railway (CPU share, network hop to Postgres), concurrent users, connection-pool exhaustion,
  contention on the advisory locks, or datasets in the tens of thousands of leads. `/api/insights` is the heaviest
  read (DATA-008: unbounded queries) and is the first thing to re-measure on a larger dataset.
- Do not treat a regression of a few milliseconds as signal; use the same machine, compare medians, repeat.
- To measure a deployed instance, set `PERF_HTTP_URL` and `E2E_EMAIL` / `E2E_PASSWORD` for a **throwaway** user, and
  say in the record that the topology is remote. Do not point the volume part at a database holding real data.
