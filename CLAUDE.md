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
    nyc/{socrata,exemptions,acris,acris-bulk,hpd,hcr,pluto,evictions,bbl-utils}.ts
    analysis/{config,expiration,scoring,rent-upside}.ts
  components/
    PropertyTable.tsx
    FilterBar.tsx
    DashboardView.tsx
    ScoreBadge.tsx
    ExportButton.tsx
scripts/pipeline.ts             # Run by GH Actions
supabase/migrations/
  20260404000000_initial_schema.sql
  20260404000001_add_coordinates.sql
  20260404000002_pluto_address_units.sql
  20260405000003_feature_expansion.sql
.github/workflows/refresh-data.yml
```

## Supabase Tables

### `exemptions`
BBL + abatement data + computed expiration/status (weekly refresh)
- Core: `bbl`, `address`, `borough`, `exemption_code`, `benefit_type`, `tax_year`, `benefit_start_year`, `annual_exempt_amount`, `assessed_value`, `building_class`
- Computed: `expiration_year`, `phase_out_start_year`, `phase_out_end_year`, `expiration_status`, `edge_case_flags`
- Stabilization (weekly): `is_rent_stabilized`, `stabilization_source`

### `hpd_data`
Building registration + violation data (weekly refresh)
- `bbl`, `total_units`, `building_class`, `registration_status`, `registration_id`
- `violation_count_12mo`, `eviction_count_12mo`

### `acris_records`
Deed + mortgage data, bulk-fetched weekly for target-window properties; on-demand with 24hr cache for property detail fallback
- `bbl`, `last_deed_date`, `last_sale_price`, `last_mortgage_amount`, `mortgage_date`
- `lender_name`, `owner_name` (deed grantee), `ownership_years`

### `pluto_data`
Zoning, coordinates, year built (weekly refresh)
- `bbl`, `latitude`, `longitude`, `zoning`, `far`, `lot_area`, `year_built`, `neighborhood`, `address`, `total_units`

### `property_scores`
Distress scores + enrichment (rebuilt after each pipeline run)
- Score: `bbl`, `distress_score`, `tax_impact_component`, `time_component`, `debt_component`, `ownership_component`, `violation_component`
- Enrichment: `estimated_annual_rent_upside`, `deregulation_risk`, `ami_tier`

### `pipeline_runs`
Run log: `dataset`, `rows_upserted`, `duration_ms`, `status`, `error`, `ran_at`

### View: `property_pipeline`
LEFT JOINs all tables; filters to `APPROACHING` or `IN_PHASE_OUT` only. Used by all dashboard and API queries.

## Distress Score Weights
- Tax impact magnitude: **30%** — absolute dollar shock
- Time to expiration: **25%** — urgency (12mo = 100, 36mo = 0)
- Debt load (LTV): **20%** — refinancing pressure (from bulk ACRIS, not empty map)
- Ownership duration: **15%** — seller fatigue proxy (from bulk ACRIS)
- HPD violations: **10%** — deferred maintenance signal

Note: `debt_component` and `ownership_component` require ACRIS data. They are populated from the weekly bulk ACRIS fetch (not on-demand), so all target-window properties receive non-zero scores when ACRIS records exist.

## Rent Upside Estimation
Estimates annual rent gain when abatement expires and rent-stabilization ends.

**AMI tiers by exemption code (2025):**
- 421-a standard (5100–5114): 60% AMI cap → studio $1,701 / 1BR $1,822 / 2BR $2,187 / 3BR $2,527
- 421-a affordable extended (5116–5118): 80% AMI cap → studio $2,268 / 1BR $2,430 / 2BR $2,916 / 3BR $3,370
- 421-a(16) Affordable NY (5121–5122): market-rate units (upside = N/A)
- J-51 (5129–5130): no AMI cap; assumes current stabilized rent ≈ 70% of market

**Market rate assumptions (2025 conservative NYC avg):** studio $2,800 / 1BR $3,500 / 2BR $4,800 / 3BR $6,500

**Unit mix assumption** (used when only total_units known): 20% studio / 50% 1BR / 25% 2BR / 5% 3BR

**Formula:** `(marketRent - regulatedRent) × totalUnits × 12`

Update `AMI_YEAR`, `AMI_RENTS`, and `MARKET_RENTS` in `src/lib/analysis/config.ts` annually.

## Deregulation Risk
Classifies buildings by likelihood of full rent deregulation at abatement expiration.

- **High**: 421-a + `year_built >= 1974` → only stabilized due to abatement; can fully deregulate
- **Medium**: 421-a + `year_built < 1974` OR J-51 + `year_built >= 1974` OR `year_built` unknown
- **Low**: J-51 + `year_built < 1974` → building was stabilized before abatement; remains regulated

Heuristic based on NYC Rent Stabilization Law (1969/1974 cutoff). Verify individually for edge cases.

## Exemption Source Datasets (Socrata SODA2)
- Exemption Detail: `muvi-b6kx` — filter for 421-a + J-51 codes
- HPD Registration: `tesw-yqqr`
- HPD Violations: `wvxf-dwi5`
- ACRIS Legals: `8h5j-fqxa` (BBL → doc_id)
- ACRIS Master: `bnx9-e6tj` (doc_id → amounts/dates)
- ACRIS Parties: `636b-3b5g` (doc_id → names; party_type='1' = owner/grantee, party_type='2' = lender)
- HCR Rent Stabilized Buildings: `8y9c-t29b` (boro/block/lot → stabilization registry)
- NYC Evictions: `6z8x-tj6h` (match by HPD registration_id)
- PLUTO: `64uk-42ks` (zoning, FAR, coordinates, year built, address, units)

## ACRIS Strategy
**Weekly pipeline (bulk):** Fetch ACRIS for all target-window properties (~2k BBLs) during the pipeline run. Uses `acris-bulk.ts` which batches Legals queries (150 BBLs/chunk, OR-clause on borough/block/lot), then Master and Parties queries. Results upserted to `acris_records`. Fetches both lender name (party_type='2') and owner/grantee name (party_type='1').

**Property detail (on-demand):** `acris.ts` fetches fresh data per BBL if `acris_records` cache is >24hr old or missing. Acts as fallback for properties outside the target window.

**Data completeness:** Socrata ACRIS covers recorded deeds/mortgages from ~1966 onward. Expect ~40-50% null rates for pre-1966 acquisitions, LLC transfers, estate sales, and cash purchases with no recorded mortgage. DOF ACRIS web portal has no public machine-readable API.

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
- Steps: fetch exemptions → compute expiration → fetch HPD + PLUTO (parallel) → fetch ACRIS bulk → HCR stabilization → evictions → score (with ACRIS) → upsert all → log run
- Estimated runtime: ~11 minutes
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
- [x] Step 14: Map view (PropertyMap.tsx + DashboardView.tsx with tab toggle)
- [x] Step 15: Pipeline schema fixes (Socrata field names, BBL normalization, batch upserts)
- [ ] Step 16: DB migration — feature_expansion (new columns + view rebuild)
- [ ] Step 17: bbl-utils.ts — shared BBL parsing utilities
- [ ] Step 18: acris-bulk.ts — bulk ACRIS fetcher (fixes empty-map scoring bug)
- [ ] Step 19: hcr.ts — HCR rent stabilization registry
- [ ] Step 20: evictions.ts — NYC eviction counts
- [ ] Step 21: rent-upside.ts — AMI tier, rent upside, deregulation risk logic
- [ ] Step 22: scoring.ts — add pluto param + 3 new computed fields
- [ ] Step 23: pipeline.ts — wire all new fetchers, fix scoreAll() empty map bug
- [ ] Step 24: API + frontend — new columns, owner filter, new table columns, detail cards
- [ ] Step 25: CLAUDE.md — updated (this file)
