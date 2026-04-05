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

export interface RawExemption {
  bble: string          // BBL with leading zeros
  taxyear: string
  exmptcode: string
  exmptamt: string      // annual exempt amount ($)
  gross: string         // assessed value
  bldgclass: string
  // address fields may vary
  stname?: string
  housenum_lo?: string
  housenum_hi?: string
  boro?: string
  zip?: string
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
}

// ─── ACRIS ────────────────────────────────────────────────────────────────────

export interface ACRISRecord {
  bbl: string
  lastDeedDate: string | null        // ISO date
  lastSalePrice: number | null
  lastMortgageAmount: number | null
  mortgageDate: string | null
  lenderName: string | null
  ownershipYears: number | null
  fetchedAt: string
}

// ─── HPD ─────────────────────────────────────────────────────────────────────

export interface HPDData {
  bbl: string
  totalUnits: number | null
  buildingClass: string | null
  registrationStatus: string | null
  violationCount12mo: number
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
  fetchedAt: string
}

// ─── Distress score ───────────────────────────────────────────────────────────

export interface ScoreComponents {
  taxImpact: number        // 0–100
  timeToExpiration: number // 0–100
  debtLoad: number         // 0–100
  ownershipDuration: number // 0–100
  violations: number       // 0–100
}

export interface PropertyScore {
  bbl: string
  distressScore: number    // 0–100 weighted total
  components: ScoreComponents
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
  ownershipYears: number | null
  // from hpd
  totalUnits: number | null
  violationCount12mo: number
  registrationStatus: string | null
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
}

// ─── API filter params ────────────────────────────────────────────────────────

export interface PropertyFilters {
  borough?: Borough | "all"
  minMonths?: number   // default 0
  maxMonths?: number   // default 36
  minScore?: number    // default 0
  buildingClass?: string
  minUnits?: number
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
