// ─── Enums ────────────────────────────────────────────────────────────────────

export type Borough = "manhattan" | "brooklyn" | "bronx" | "queens" | "staten_island"

export type ExpirationStatus =
  | "APPROACHING"   // full expiration within target window
  | "IN_PHASE_OUT"  // currently in phase-out period
  | "EXPIRED"       // already expired
  | "FUTURE"        // beyond target window

export type ExemptionType = "421a" | "j51"

// ─── Benefit Config ───────────────────────────────────────────────────────────

export interface BenefitType {
  code: string
  label: string
  exemptionType: ExemptionType
  durationYears: number
  phaseOutYears: number  // years of gradual reduction before full expiration
  phaseOutReductionPerYear: number  // fraction removed each year (e.g. 0.20)
}

// ─── Raw exemption row from Socrata muvi-b6kx ─────────────────────────────────
// Actual schema (verified 2026-04-04 against live dataset)

export interface RawExemption {
  parid: string       // 10-digit BBL (boro1 + block5 + lot4)
  boro: string        // "1"–"5"
  year: string        // tax year (e.g. "2025")
  exmp_code: string   // numeric exemption code ("5113", "5130", etc.)
  benftstart: string  // benefit start year — may have leading "+" (e.g. "+2009" or "2010")
  no_years: string    // total program duration in years ("15", "20", etc.)
  curexmptot: string  // current annual exempt amount in dollars
  basetot: string     // assessed base value — has leading "+" and zero-padding
  bldg_class: string  // building class code
}

// ─── Computed expiration window ───────────────────────────────────────────────

export interface ExpirationWindow {
  fullExpirationYear: number
  phaseOutStartYear: number
  phaseOutEndYear: number   // == fullExpirationYear
}

// ─── Processed exemption record ───────────────────────────────────────────────

export interface ExemptionRecord {
  bbl: string
  address: string
  borough: Borough | null
  exemptionCode: string
  taxYear: number
  benefitStartYear: number | null
  annualExemptAmount: number
  assessedValue: number
  buildingClass: string
  // computed
  benefitType: BenefitType | null
  expirationYear: number | null
  phaseOutStartYear: number | null
  phaseOutEndYear: number | null
  expirationStatus: ExpirationStatus | null
  edgeCaseFlags: string[]
  // condo aggregation: number of condo units collapsed into this parent record (null if not a condo building)
  condoUnitCount: number | null
}

// ─── ACRIS ────────────────────────────────────────────────────────────────────

export interface ACRISRecord {
  bbl: string
  lastDeedDate: string | null        // ISO date
  lastSalePrice: number | null
  lastMortgageAmount: number | null
  mortgageDate: string | null
  lenderName: string | null
  ownerName: string | null           // deed grantee (current owner)
  ownershipYears: number | null
  fetchedAt: string
}

// ─── HPD ─────────────────────────────────────────────────────────────────────

export interface HPDData {
  bbl: string
  totalUnits: number | null
  buildingClass: string | null
  registrationStatus: string | null
  registrationId: string | null
  violationCount12mo: number
  evictionCount12mo: number
  fetchedAt: string
}

// ─── PLUTO ────────────────────────────────────────────────────────────────────

export interface PLUTOData {
  bbl: string
  latitude: number | null
  longitude: number | null
  zoning: string | null
  far: number | null
  lotArea: number | null
  yearBuilt: number | null
  neighborhood: string | null
  address: string | null
  totalUnits: number | null
  fetchedAt: string
}

// ─── Distress score ───────────────────────────────────────────────────────────

export interface ScoreComponents {
  taxImpact: number        // 0–100
  timeToExpiration: number // 0–100
  debtLoad: number         // 0–100
  ownershipDuration: number // 0–100
  violations: number       // 0–100 (HPD + DOB combined)
  taxLien: number          // 0 or 100 (binary: on tax lien sale list)
  housingCourt: number     // 0–100 (HP actions + nonpayment case density)
}

export type DeregulationRisk = "high" | "medium" | "low"

export interface PropertyScore {
  bbl: string
  distressScore: number    // 0–100 weighted total
  components: ScoreComponents
  estimatedAnnualRentUpside: number | null
  deregulationRisk: DeregulationRisk | null
  amiTier: string          // "60%" | "80%" | "market" | "none"
  scoredAt: string
}

// ─── Full property record (joined) ───────────────────────────────────────────

export interface PropertyRecord {
  // from exemptions
  bbl: string
  address: string
  borough: Borough | null
  exemptionCode: string
  benefitType: BenefitType | null
  benefitStartYear: number | null
  expirationYear: number | null
  phaseOutStartYear: number | null
  expirationStatus: ExpirationStatus | null
  annualExemptAmount: number
  assessedValue: number
  buildingClass: string
  edgeCaseFlags: string[]
  // from acris
  lastDeedDate: string | null
  lastSalePrice: number | null
  lastMortgageAmount: number | null
  mortgageDate: string | null
  lenderName: string | null
  ownerName: string | null
  ownershipYears: number | null
  // from hpd
  totalUnits: number | null
  violationCount12mo: number
  evictionCount12mo: number
  registrationStatus: string | null
  // stabilization
  isRentStabilized: boolean | null
  stabilizationSource: string | null
  // from pluto
  latitude: number | null
  longitude: number | null
  zoning: string | null
  far: number | null
  yearBuilt: number | null
  neighborhood: string | null
  // score
  distressScore: number
  scoreComponents: ScoreComponents
  estimatedAnnualRentUpside: number | null
  deregulationRisk: DeregulationRisk | null
  amiTier: string
}

// ─── API filter params ────────────────────────────────────────────────────────

export interface PropertyFilters {
  borough?: Borough | "all"
  expiresFrom?: number  // expiration_year >= (default: current year)
  expiresTo?: number    // expiration_year <= (default: current year for YTD)
  minScore?: number     // default 0
  buildingClass?: string
  minUnits?: number
  owner?: string        // owner name search (ilike)
  condoOnly?: boolean   // show only condo buildings (has condo_unit_count > 0)
  limit?: number
  offset?: number
}

// ─── Pipeline run log ─────────────────────────────────────────────────────────

export interface PipelineRun {
  dataset: string
  rowsUpserted: number
  durationMs: number
  status: "success" | "error"
  error?: string
}
