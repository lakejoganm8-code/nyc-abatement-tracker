# NYC Abatement Tracker — Project Guide

## What This Is
Acquisitions intelligence web app for multifamily real estate investors. Identifies NYC properties where 421-a or J-51 tax abatements are expiring in the next 12–36 months — a signal for motivated sellers.

## Live URLs
- **App:** https://nycabatementtracker.vercel.app
- **Supabase:** https://supabase.com/dashboard/project/jybjxojgowpueqlryuxp
- **GitHub:** https://github.com/lakejoganm8-code/nyc-abatement-tracker

## Stack
| Layer | Choice |
|---|---|
| Frontend | Next.js 14 App Router (TypeScript) |
| UI | shadcn/ui + Tailwind CSS |
| Data table | TanStack Table v8 |
| Database | Supabase (PostgreSQL) |
| Data pipeline | GitHub Actions (weekly cron + `workflow_dispatch`) |
| Deploy | Vercel |

## Project Structure
```
src/
  app/
    page.tsx                    # Main dashboard
    property/[bbl]/page.tsx     # Property detail
    api/properties/             # REST API routes
  lib/
    supabase/{client,server}.ts
    nyc/{socrata,exemptions,acris,hpd,pluto}.ts
    analysis/{config,expiration,scoring}.ts
  components/
    PropertyTable.tsx
    FilterBar.tsx
    ScoreBadge.tsx
    ExportButton.tsx
scripts/pipeline.ts             # Run by GH Actions
supabase/migrations/20260404000000_initial_schema.sql
.github/workflows/refresh-data.yml
```

## Supabase Tables
- `exemptions` — BBL + abatement data + computed expiration/status (weekly refresh)
- `hpd_data` — unit counts + violation counts (weekly refresh)
- `acris_records` — deed/mortgage per BBL (on-demand, 24hr TTL)
- `pluto_data` — zoning/FAR/year built (weekly refresh)
- `property_scores` — distress scores (rebuilt after each pipeline run)
- `pipeline_runs` — run log

## Distress Score Weights
- Tax impact magnitude: **30%** — absolute dollar shock
- Time to expiration: **25%** — urgency (12mo = 100, 36mo = 0)
- Debt load (LTV): **20%** — refinancing pressure
- Ownership duration: **15%** — seller fatigue proxy
- HPD violations: **10%** — deferred maintenance signal

## Expiration Logic
- 421-a durations: 10, 15, 20, 25yr (pre-2008), 35yr (421-a(16) post-2017 "Affordable NY")
- J-51: 14yr (10yr full + 4yr phase-out) standard; 34yr (30+4) affordable
- Phase-out: 20–25% reduction/yr over 4 years — flag separately from full expiration
- Unknown exemption codes → flag `UNKNOWN_CODE`, include with lower confidence

## Exemption Source Datasets (Socrata SODA2)
- Exemption Detail: `muvi-b6kx` — filter for 421-a + J-51 codes
- J-51 records: `y7az-s7wc`
- HPD Registration: `tesw-yqqr`
- HPD Violations: `wvxf-dwi5`
- ACRIS Legals: `8h5j-fqxa` (BBL → doc_id)
- ACRIS Master: `bnx9-e6tj` (doc_id → amounts/dates)
- ACRIS Parties: `636b-3b5g` (doc_id → names)

## ACRIS Strategy
Query per-property at report time (not bulk-cached). Join: Legals (BBL→docID) → Master (amounts/dates) → Parties (lender names). Cache result in `acris_records` for 24hr.

## Environment Variables
```bash
NEXT_PUBLIC_SUPABASE_URL=https://jybjxojgowpueqlryuxp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # in .env.local
SUPABASE_SERVICE_ROLE_KEY=       # pipeline + server API routes only
NYC_OPEN_DATA_APP_TOKEN=         # optional, raises Socrata rate limits
```

## GitHub Actions Pipeline
- Schedule: `0 3 * * 1` (Monday 3am UTC)
- Manual: `workflow_dispatch` in GitHub UI
- Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NYC_OPEN_DATA_APP_TOKEN`
- Steps: fetch exemptions → compute expiration → fetch HPD → score → upsert Supabase → log run
- On failure: opens GitHub issue with run link

## Dev Commands
```bash
pnpm dev                       # local Next.js dev server
pnpm build                     # production build
pnpm pipeline                  # run data pipeline locally (needs .env.local)
vercel --prod                  # deploy
```

## Edge Cases to Flag (not silently drop)
- `UNKNOWN_CODE` — exemption code not in mapping
- `MULTI_EXEMPTION` — multiple overlapping exemptions on same BBL
- `CONDO_BBL` — BBL lot suffix ≥ 0001 (condo unit, not whole building)
- `MISSING_START_YEAR` — can't compute expiration without start year

## Implementation Progress
- [x] Step 1: GitHub repo created + Next.js scaffolded
- [x] Step 2: Supabase project + migration applied
- [x] Step 3: shadcn/ui + Supabase client installed
- [x] Step 4: socrata.ts + config.ts + expiration.ts
- [x] Step 5: scripts/pipeline.ts (exemptions → Supabase)
- [x] Step 6: hpd.ts wired into pipeline
- [x] Step 7: scoring.ts
- [x] Step 8: Dashboard page + PropertyTable + FilterBar
- [x] Step 9: acris.ts + /api/properties/[bbl] route
- [x] Step 10: Property detail page
- [x] Step 11: CSV export (ExportButton.tsx)
- [x] Step 12: GitHub Actions workflow
- [x] Step 13: Vercel deploy + env vars set

## Next Steps
- Run `pnpm pipeline` locally to populate Supabase with real data
- Register NYC Open Data token and add as `NYC_OPEN_DATA_APP_TOKEN` secret
- Add `pluto.ts` module for zoning/FAR/year-built enrichment
- Consider adding PLUTO to the weekly pipeline run
