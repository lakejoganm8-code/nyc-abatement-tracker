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

// ─── 421-a exemption codes → benefit types ───────────────────────────────────
//
// Sources:
//   - NYC DOF Property Exemption Detail codebook
//   - NYC Admin Code § 11-245 (421-a program versions)
//   - DOF 421-a benefit type schedule documentation
//
// Key durations by program version:
//   421-a(1)–(8)  : geography-based, 10–25yr depending on location/date
//   421-a(15)     : "Enhanced Affordability" — 25yr
//   421-a(16)     : "Affordable New York" (post-2017) — 35yr
//
// Phase-out: typically 4 years at 20% per year.
// If the exact type cannot be determined, UNKNOWN_CODE is flagged.
// ─────────────────────────────────────────────────────────────────────────────

export const BENEFIT_TYPES: Record<string, BenefitType> = {
  // ── 421-a standard (pre-2008, geography A — outer boroughs/upper Manhattan) ──
  "4210A": {
    code: "4210A",
    label: "421-a(1) 10yr (Area A)",
    exemptionType: "421a",
    durationYears: 10,
    phaseOutYears: 2,
    phaseOutReductionPerYear: 0.5,
  },
  // ── 421-a standard (pre-2008, geography B — mid-range Manhattan) ──
  "4210B": {
    code: "4210B",
    label: "421-a(1) 15yr (Area B)",
    exemptionType: "421a",
    durationYears: 15,
    phaseOutYears: 4,
    phaseOutReductionPerYear: 0.25,
  },
  // ── 421-a standard (pre-2008, geography C — core Manhattan/high-value) ──
  "4210C": {
    code: "4210C",
    label: "421-a(1) 20yr (Area C)",
    exemptionType: "421a",
    durationYears: 20,
    phaseOutYears: 4,
    phaseOutReductionPerYear: 0.25,
  },
  // ── 421-a with affordable units (pre-2008, 25yr) ──
  "4210D": {
    code: "4210D",
    label: "421-a 25yr (Affordable)",
    exemptionType: "421a",
    durationYears: 25,
    phaseOutYears: 4,
    phaseOutReductionPerYear: 0.25,
  },
  // ── 421-a(15) Enhanced Affordability (2015–2017 gap period, 25yr) ──
  "42115": {
    code: "42115",
    label: "421-a(15) Enhanced Affordability 25yr",
    exemptionType: "421a",
    durationYears: 25,
    phaseOutYears: 4,
    phaseOutReductionPerYear: 0.25,
  },
  // ── 421-a(16) Affordable New York (post-June 2017, 35yr) ──
  "42116": {
    code: "42116",
    label: "421-a(16) Affordable New York 35yr",
    exemptionType: "421a",
    durationYears: 35,
    phaseOutYears: 4,
    phaseOutReductionPerYear: 0.25,
  },
  // ── Generic codes seen in muvi-b6kx (map to most common duration) ──
  "4212":  {
    code: "4212",
    label: "421-a (generic, estimated 20yr)",
    exemptionType: "421a",
    durationYears: 20,
    phaseOutYears: 4,
    phaseOutReductionPerYear: 0.25,
  },
  "4213":  {
    code: "4213",
    label: "421-a extended 25yr",
    exemptionType: "421a",
    durationYears: 25,
    phaseOutYears: 4,
    phaseOutReductionPerYear: 0.25,
  },
  // ── J-51 standard (14yr = 10 full + 4 phase-out) ──
  "J51S": {
    code: "J51S",
    label: "J-51 Standard 14yr",
    exemptionType: "j51",
    durationYears: 14,
    phaseOutYears: 4,
    phaseOutReductionPerYear: 0.25,
  },
  // ── J-51 affordable (34yr = 30 full + 4 phase-out) ──
  "J51A": {
    code: "J51A",
    label: "J-51 Affordable 34yr",
    exemptionType: "j51",
    durationYears: 34,
    phaseOutYears: 4,
    phaseOutReductionPerYear: 0.25,
  },
}

// Exemption codes in muvi-b6kx that indicate 421-a
export const EXEMPTION_CODES_421A = new Set([
  "4210A", "4210B", "4210C", "4210D", "42115", "42116", "4212", "4213",
  // Numeric variants seen in practice
  "4210", "4211", "4214", "4215", "4216",
])

// Exemption codes that indicate J-51
export const EXEMPTION_CODES_J51 = new Set([
  "J51S", "J51A", "J51", "J510", "J511", "J512",
  // Numeric codes
  "5100", "5101", "5102",
])

// All target exemption codes (used as filter when querying Socrata)
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
