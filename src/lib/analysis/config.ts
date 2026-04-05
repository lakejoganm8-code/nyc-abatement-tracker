import type { BenefitType } from "@/types"

// ─── Socrata dataset IDs ──────────────────────────────────────────────────────

export const DATASETS = {
  EXEMPTION_DETAIL: "muvi-b6kx",   // DOF Property Exemption Detail (421-a + J-51)
  J51: "y7az-s7wc",                // J-51 Exemption Records
  HPD_REGISTRATION: "tesw-yqqr",   // HPD Residential Building Registrations
  HPD_VIOLATIONS: "wvxf-dwi5",     // HPD Building Violations
  ACRIS_LEGALS: "8h5j-fqxa",       // ACRIS Real Property Legals (BBL → doc_id)
  ACRIS_MASTER: "bnx9-e6tj",       // ACRIS Real Property Master (doc_id → details)
  ACRIS_PARTIES: "636b-3b5g",      // ACRIS Real Property Parties (doc_id → names)
  EVICTIONS: "6z8x-wfk4",          // NYC Marshal Evictions (has bbl column directly)
  PLUTO: "64uk-42ks",              // MapPLUTO (zoning, FAR, coordinates, year built)
} as const

export const SOCRATA_BASE_URL = "https://data.cityofnewyork.us/resource"
export const SOCRATA_PAGE_SIZE = 50_000

// ─── Borough codes ────────────────────────────────────────────────────────────

export const BOROUGH_CODES: Record<string, string> = {
  "1": "manhattan",
  "2": "bronx",
  "3": "brooklyn",
  "4": "queens",
  "5": "staten_island",
}

export const BOROUGH_NAMES: Record<string, string> = {
  manhattan: "Manhattan",
  bronx: "Bronx",
  brooklyn: "Brooklyn",
  queens: "Queens",
  staten_island: "Staten Island",
}

// ─── 421-a and J-51 exemption codes (muvi-b6kx actual numeric codes) ─────────
//
// Verified against live NYC Open Data (muvi-b6kx) on 2026-04-04.
// The dataset uses 4-digit numeric exmp_codes, not the alpha codes in older docs.
//
// Duration is read directly from the `no_years` field in each row, so we only
// need the codes to filter rows and assign labels + exemption type.
//
// Phase-out: 4 years for all types (universal NYC abatement phase-out schedule).
// ─────────────────────────────────────────────────────────────────────────────

// Label and type metadata keyed by numeric exmp_code
export const BENEFIT_TYPE_META: Record<string, { label: string; exemptionType: "421a" | "j51" }> = {
  "5100": { label: "421-a",                            exemptionType: "421a" },
  "5101": { label: "421-a (condo)",                    exemptionType: "421a" },
  "5110": { label: "421-a (10yr)",                     exemptionType: "421a" },
  "5112": { label: "421-a (12yr)",                     exemptionType: "421a" },
  "5113": { label: "421-a (15yr)",                     exemptionType: "421a" },
  "5114": { label: "421-a (20yr)",                     exemptionType: "421a" },
  "5116": { label: "421-a (affordable)",               exemptionType: "421a" },
  "5117": { label: "421-a (affordable, extended)",     exemptionType: "421a" },
  "5118": { label: "421-a (25yr affordable)",          exemptionType: "421a" },
  "5121": { label: "421-a(16) Affordable New York",    exemptionType: "421a" },
  "5122": { label: "421-a(16) Affordable NY (condo)",  exemptionType: "421a" },
  "5129": { label: "J-51 (rehabilitation)",            exemptionType: "j51"  },
  "5130": { label: "J-51 (conversion)",                exemptionType: "j51"  },
}

// BenefitType objects are built at runtime from row data — duration comes from no_years
// This stub keeps TypeScript happy in callers that expect BenefitType
export const BENEFIT_TYPES: Record<string, BenefitType> = Object.fromEntries(
  Object.entries(BENEFIT_TYPE_META).map(([code, meta]) => [
    code,
    {
      code,
      label: meta.label,
      exemptionType: meta.exemptionType,
      durationYears: 0, // overridden by row's no_years at parse time
      phaseOutYears: 4,
      phaseOutReductionPerYear: 0.25,
    } satisfies BenefitType,
  ])
)

// Exemption codes that indicate 421-a
export const EXEMPTION_CODES_421A = new Set([
  "5100", "5101", "5110", "5112", "5113", "5114", "5116", "5117", "5118", "5121", "5122",
])

// Exemption codes that indicate J-51
export const EXEMPTION_CODES_J51 = new Set([
  "5129", "5130",
])

// All target codes — used as the Socrata $where filter
export const ALL_TARGET_CODES = [
  ...EXEMPTION_CODES_421A,
  ...EXEMPTION_CODES_J51,
]

// ─── Scoring weights ──────────────────────────────────────────────────────────

export const SCORE_WEIGHTS = {
  taxImpact: 0.30,         // absolute dollar shock drives seller motivation
  timeToExpiration: 0.25,  // urgency — sooner is higher score
  debtLoad: 0.20,          // high LTV + expiring abatement = refi pressure
  ownershipDuration: 0.15, // long holds = possible seller fatigue
  violations: 0.10,        // deferred maintenance = distressed ownership signal
} as const

// ─── Default scan window ─────────────────────────────────────────────────────

export const DEFAULT_WINDOW_MIN_MONTHS = 0
export const DEFAULT_WINDOW_MAX_MONTHS = 36

// ─── ACRIS document types ─────────────────────────────────────────────────────

export const ACRIS_DEED_TYPES = ["DEED", "DEEDO", "DEED, BARGAIN AND SALE"]
export const ACRIS_MORTGAGE_TYPES = ["MTGE", "AGMT", "MORTGAGE"]
export const ACRIS_SATISFACTION_TYPES = ["SAT", "SATISFACTION OF MORTGAGE"]

// ─── AMI rent data (update annually) ─────────────────────────────────────────
// Source: NYC HPD Area Median Income page (2025 values)

export const AMI_YEAR = 2025

// Maximum regulated rents by AMI tier and unit type
export const AMI_RENTS: Record<string, Record<string, number>> = {
  "60%": { studio: 1701, "1br": 1822, "2br": 2187, "3br": 2527 },
  "80%": { studio: 2268, "1br": 2430, "2br": 2916, "3br": 3370 },
}

// Conservative 2025 NYC market rents (blended avg across neighborhoods)
export const MARKET_RENTS: Record<string, number> = {
  studio: 2800, "1br": 3500, "2br": 4800, "3br": 6500,
}

// Blended unit mix for buildings where only total_units is known
// 20% studio / 50% 1BR / 25% 2BR / 5% 3BR (NYC multifamily average)
export const BLENDED_UNIT_MIX: Record<string, number> = {
  studio: 0.20, "1br": 0.50, "2br": 0.25, "3br": 0.05,
}

// AMI tier per exemption code (static mapping, update if programs change)
export const EXEMPTION_AMI_TIER: Record<string, string> = {
  "5100": "60%",    // 421-a standard
  "5101": "60%",    // 421-a (condo)
  "5110": "60%",    // 421-a (10yr)
  "5112": "60%",    // 421-a (12yr)
  "5113": "60%",    // 421-a (15yr)
  "5114": "60%",    // 421-a (20yr)
  "5116": "80%",    // 421-a (affordable)
  "5117": "80%",    // 421-a (affordable, extended)
  "5118": "80%",    // 421-a (25yr affordable)
  "5121": "market", // 421-a(16) Affordable NY — market-rate units
  "5122": "market", // 421-a(16) Affordable NY (condo)
  "5129": "none",   // J-51 (rehabilitation) — no AMI cap
  "5130": "none",   // J-51 (conversion) — no AMI cap
}

// Buildings built before this year may have been stabilized pre-abatement
// (NYC Rent Stabilization Law: pre-1974 buildings with 6+ units)
export const STABILIZATION_CUTOFF_YEAR = 1974
