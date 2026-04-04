# NYC 421-a / J-51 Tax Abatement Expiration Tracker

## Claude Code Project Prompt

---

## What This Is

You are building a CLI tool that identifies NYC multifamily properties where 421-a or J-51 tax abatements are expiring in the next 12–36 months. The tool cross-references public datasets to surface acquisition targets — buildings where a sudden jump in carrying costs (from abatement expiration) may force recapitalization or sale.

This is an acquisitions intelligence tool for multifamily real estate investors.

---

## The Investment Thesis

When a 421-a or J-51 abatement expires, a building's property tax bill can increase dramatically — sometimes 3–5x overnight. Owners who underwrote the deal assuming abated taxes may face negative cash flow, triggering a need to sell, refinance, or recapitalize. By systematically identifying these buildings *before* the expiration hits, an investor can build a pipeline of off-market opportunities with motivated sellers.

---

## Data Sources (All Public)

### 1. DOF Property Exemption Detail
- **NYC Open Data ID:** `muvi-b6kx`
- **API:** `https://data.cityofnewyork.us/resource/muvi-b6kx.json`
- **What it has:** Every active property tax exemption in NYC — exemption code, tax year, assessed values, exempt amounts, BBL (Borough-Block-Lot)
- **What you need from it:** Filter for 421-a and J-51 exemption codes. Extract benefit start year, exemption type/code, and current exemption amounts. Use the exemption type to calculate expiration window.
- **Key fields:** `bble` (BBL), `taxyear`, `exmptcode`, `exmptamt`, `bldgclass`, `gross` (assessed value)

### 2. DOF 421-a Exemption Records
- **Source:** `https://www.nyc.gov/site/finance/property/benefits-421a.page`
- **Download:** Excel/CSV files listing all properties receiving 421-a, with benefit type
- **What you need from it:** The **benefit type** (there are 11 types with different durations — 10, 15, 20, 25, or 35 years). This is critical for calculating expiration dates.
- **Fallback:** If the benefit type isn't in the Open Data API, scrape or manually encode the benefit schedules from DOF documentation.

### 3. J-51 Exemption and Abatement
- **NYC Open Data ID:** `y7az-s7wc`
- **API:** `https://data.cityofnewyork.us/resource/y7az-s7wc.json`
- **What it has:** Properties with J-51 benefits, including exemption and abatement amounts by year
- **Key detail:** J-51 has two components — a **14-year or 34-year exemption** (10 or 30 years full + 4-year phase-out) and an **abatement** (up to 20 years). Track both.

### 4. ACRIS — Real Property Master + Legals + Parties
- **Master — NYC Open Data ID:** `bnx9-e6tj`
- **Legals — NYC Open Data ID:** `8h5j-fqxa`
- **Parties — NYC Open Data ID:** `636b-3b5g`
- **API base:** `https://data.cityofnewyork.us/resource/{id}.json`
- **What you need:** For each target property (by BBL), pull:
  - Most recent **deed transfer** (document type `DEED`, `DEEDO`) → ownership duration, sale price
  - Most recent **mortgage** (document type `MTGE`, `AGMT`) → current debt load, lender, date
  - **Satisfaction pieces** (document type `SAT`) → whether prior mortgages are cleared
- **Join logic:** Query Legals by BBL to get Document IDs, then join to Master and Parties tables for details.

### 5. HPD Registration & Buildings
- **Registration — NYC Open Data ID:** `tesw-yqqr`
- **Buildings — NYC Open Data ID:** `kj4p-ruqc`
- **API base:** `https://data.cityofnewyork.us/resource/{id}.json`
- **What you need:** Unit count (total residential units), building class, registration status, owner/agent contact info
- **Bonus:** HPD Violations (`wvxf-dwi5`) — high violation counts signal deferred maintenance / distressed ownership

### 6. DOF Property Assessment (PLUTO or Rolling Sales)
- **PLUTO (MapPLUTO):** Available via NYC Planning — gives assessed value, FAR, lot area, zoning, year built
- **Rolling Sales:** `https://www.nyc.gov/site/finance/taxes/property-rolling-sales-data.page` — last 12 months of sales for comps
- **Use:** Enrich each property with physical characteristics and neighborhood context

### 7. Rent Stabilization Unit Counts (Derived)
- **Source:** NYCDB project (`https://github.com/nycdb/nycdb`) compiles stabilized unit counts from DOF tax bill PDFs
- **Alternative:** DOF tax bills include a DHCR rent stabilization surcharge line — the surcharge amount ÷ $20/unit = stabilized unit count
- **Why it matters:** Stabilized buildings have different risk/upside profiles. Post-HSTPA (2019), deregulation paths are extremely limited.

---

## Abatement Expiration Logic (Critical)

This is the core intellectual property of the tool. You need to encode the benefit schedules:

### 421-a Benefit Types and Durations
| Type | Duration | Notes |
|------|----------|-------|
| Pre-2008 (various) | 10, 15, 20, 25 years | Varies by geography and program version |
| 421-a(16) "Affordable New York" | 35 years | Post-2017 projects, includes affordability requirements |
| Extended benefits | Some pre-2008 projects got extensions under later program versions | Check DOF documentation |

**Calculation:** `expiration_year = benefit_start_year + duration_years`

The exemption detail dataset gives you the start year. The benefit type (from the 421-a records or exemption code) gives you the duration. If you can't determine the exact type, flag it for manual review and estimate based on the exemption's age.

### J-51 Benefit Schedules
- **Exemption:** 14 years (10 full + 4 phase-out) for standard projects; 34 years (30 full + 4 phase-out) for affordable housing
- **Abatement:** Up to 20 years at 8.33% or 12.5% of improvement cost per year
- **Note:** The J-51 program expired for work completed after 6/29/2022, but existing benefits continue to run. No new J-51 benefits are being granted under the old program.

### Phase-Out Matters
During the phase-out period (typically 4 years), exemptions decrease by 20–25% per year. This is still painful for owners but less acute than full expiration. Flag properties in phase-out separately from those facing full expiration.

---

## What the Tool Should Output

For each property in the expiration window, generate a record with:

### Abatement Profile
- BBL, address, borough, neighborhood
- Exemption type (421-a type or J-51)
- Benefit start year and estimated expiration year
- Current annual exemption amount (the tax savings about to disappear)
- Phase-out status (full expiration vs. in phase-out vs. approaching phase-out)

### Financial Signal
- Estimated post-expiration tax bill increase (current exemption amount ÷ remaining phase-out %)
- Current assessed value and tax class
- Most recent mortgage amount, date, and lender (from ACRIS)
- Most recent sale price and date (from ACRIS)
- Ownership duration (years since last deed transfer)
- Estimated debt-to-value ratio (mortgage amount ÷ assessed value × equalization rate)

### Building Profile
- Total residential units and building class
- Rent stabilization status and estimated stabilized unit count
- Year built
- HPD violation count (last 12 months) — as a distressed-owner signal
- Zoning and FAR (from PLUTO) — for redevelopment potential

### Scoring / Prioritization
Create a composite "distress score" that weights:
- **Tax impact magnitude** — larger absolute exemption amount = bigger shock
- **Ownership duration** — longer holds may mean lower basis but also fatigue
- **Debt load** — high LTV + expiring abatement = refinancing pressure
- **Violation history** — high violations = deferred maintenance = motivated seller
- **Time to expiration** — 12 months out is more urgent than 36

---

## Architecture Guidance

### Recommended Stack
- **Language:** Python (good library support for API calls, data manipulation, CLI)
- **Data fetching:** `requests` or `httpx` for Socrata API calls (all datasets support JSON via SODA2 API)
- **Data processing:** `pandas` for joins, filtering, scoring
- **Storage:** SQLite for local caching (these datasets are large; don't re-fetch on every run)
- **CLI framework:** `click` or `argparse`
- **Output:** CSV/Excel export for pipeline management, optional terminal table view

### API Notes
- **Socrata SODA2 API** is used by all NYC Open Data datasets. Queries use SoQL (SQL-like). Example:
  ```
  https://data.cityofnewyork.us/resource/muvi-b6kx.json?$where=exmptcode='12345'&$limit=50000
  ```
- **Pagination:** Default limit is 1,000 rows. Use `$limit` and `$offset` for full dataset pulls.
- **Rate limits:** No API key required for basic use, but throttled. An app token (free registration) raises limits.
- **Caching strategy:** Pull the full exemption datasets once, cache locally in SQLite. ACRIS and HPD queries can be done per-property since you'll only query the filtered set.

### Suggested Module Structure
```
nyc-abatement-tracker/
├── README.md
├── requirements.txt
├── config.py              # API endpoints, exemption code mappings, benefit schedules
├── cli.py                 # Entry point and CLI commands
├── data/
│   ├── fetcher.py         # API calls to Socrata, caching logic
│   ├── cache.py           # SQLite cache management
│   └── models.py          # Data classes for Property, Exemption, Mortgage, etc.
├── analysis/
│   ├── expiration.py      # Benefit schedule logic, expiration date calculation
│   ├── acris.py           # ACRIS queries for debt and ownership history
│   ├── hpd.py             # HPD queries for violations, registration, unit counts
│   ├── enrichment.py      # PLUTO / stabilization data enrichment
│   └── scoring.py         # Distress score calculation
├── output/
│   ├── report.py          # CSV/Excel export
│   └── terminal.py        # Pretty-printed terminal output
└── tests/
```

### CLI Commands (Suggested)
```bash
# Full pipeline: fetch, analyze, score, export
python cli.py scan --borough manhattan --expiration-window 24 --output results.csv

# Update local cache from NYC Open Data
python cli.py refresh --dataset exemptions
python cli.py refresh --dataset all

# Look up a single property
python cli.py lookup --bbl 1-00345-0023

# Score and rank the current pipeline
python cli.py rank --min-score 70 --output ranked.csv
```

---

## Where You Have Room to Make Design Decisions

The following are areas where you should use your judgment and can ask clarifying questions:

- **Scoring weights** — How aggressively to weight each distress signal. Propose defaults and explain your reasoning.
- **Exemption code mapping** — There are many exemption codes. Decide how to map them to benefit durations. Document any assumptions or ambiguities.
- **ACRIS query strategy** — ACRIS is huge. Decide whether to batch-query or query per-property, and how to handle the join across Master/Legals/Parties tables efficiently.
- **Edge cases** — Properties with multiple overlapping exemptions, partial exemptions, properties that have transferred mid-benefit, condos vs. rental buildings. Flag these rather than silently dropping them.
- **Output format** — The CSV export structure, column naming, whether to include a summary dashboard.
- **Error handling** — How to handle API failures, missing data, ambiguous exemption types.
- **Incremental updates** — Whether the tool should support diffing against a previous run to surface *new* entries in the pipeline.

---

## What NOT to Spend Time On (For Now)

- **Web UI or dashboard** — CLI and CSV output are sufficient for v1. A React dashboard can come later.
- **Automated email alerts** — Out of scope for v1.
- **Comp analysis or valuation** — The tool identifies targets. Valuation happens in a separate workflow.
- **Authentication or multi-user support** — This is a single-user local tool.
- **DHCR rent roll data** — This requires FOIL requests and isn't publicly API-accessible. Use the NYCDB-derived stabilization counts as a proxy.

---

## Quality Checks Before Calling It Done

- [ ] Can scan all five boroughs and return results filtered by expiration window
- [ ] Expiration dates are calculated correctly for at least the 3 most common 421-a benefit types
- [ ] ACRIS data (last sale, current mortgage) successfully joins for >80% of target properties
- [ ] HPD unit counts and violation data enriches each record
- [ ] Distress score produces a reasonable ranking (manually spot-check 10 properties against public records)
- [ ] Handles Socrata API pagination correctly (no silently truncated results)
- [ ] Local cache works — second run is fast without re-fetching
- [ ] CSV export opens cleanly in Excel with readable column headers
- [ ] Edge cases (missing data, ambiguous codes) are flagged, not silently dropped
- [ ] README documents setup, usage, and data source assumptions

---

## Getting Started

1. Register for a free NYC Open Data app token at `https://data.cityofnewyork.us/profile/edit/developer_settings` — this raises API rate limits.
2. Start by pulling the Property Exemption Detail dataset and filtering for 421-a and J-51 codes. Get familiar with the data shape.
3. Build the expiration logic next — this is the core of the tool.
4. Layer in ACRIS, HPD, and PLUTO enrichment once the base pipeline works.
5. Add scoring last, once you can see real data and calibrate weights.

Good luck. Build something that finds deals before the market does.
