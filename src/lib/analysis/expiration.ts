import {
  BENEFIT_TYPES,
  EXEMPTION_CODES_421A,
  EXEMPTION_CODES_J51,
  DEFAULT_WINDOW_MAX_MONTHS,
  DEFAULT_WINDOW_MIN_MONTHS,
} from "./config"
import type {
  BenefitType,
  ExemptionRecord,
  ExpirationStatus,
  ExpirationWindow,
  RawExemption,
  Borough,
} from "@/types"
import { BOROUGH_CODES } from "./config"

const CURRENT_YEAR = new Date().getFullYear()

// ─── Code → benefit type lookup ───────────────────────────────────────────────

/**
 * Map an exemption code to a known BenefitType.
 * Returns null if code is unrecognized — caller should flag UNKNOWN_CODE.
 */
export function mapCodeToBenefitType(code: string): BenefitType | null {
  const normalized = code.trim().toUpperCase()

  // Direct lookup first
  if (BENEFIT_TYPES[normalized]) return BENEFIT_TYPES[normalized]

  // Prefix-based fallbacks for codes seen in the wild
  if (EXEMPTION_CODES_421A.has(normalized)) {
    // Determine likely duration from numeric suffix or prefix pattern
    if (normalized.includes("16")) return BENEFIT_TYPES["42116"]
    if (normalized.includes("15")) return BENEFIT_TYPES["42115"]
    if (normalized === "4210" || normalized === "4211") return BENEFIT_TYPES["4212"]
    return BENEFIT_TYPES["4212"] // generic 20yr fallback for unmatched 421-a
  }

  if (EXEMPTION_CODES_J51.has(normalized)) {
    return BENEFIT_TYPES["J51S"] // default to standard 14yr
  }

  return null
}

// ─── Expiration window calculation ────────────────────────────────────────────

/**
 * Calculate expiration timeline given a benefit start year and type.
 *
 * Example for a 421-a(16) 35yr starting in 2019:
 *   fullExpiration = 2019 + 35 = 2054
 *   phaseOutStart  = 2054 - 4  = 2050
 *   phaseOutEnd    = 2054
 */
export function calculateExpiration(
  startYear: number,
  benefitType: BenefitType
): ExpirationWindow {
  const fullExpirationYear = startYear + benefitType.durationYears
  const phaseOutStartYear = fullExpirationYear - benefitType.phaseOutYears
  return {
    fullExpirationYear,
    phaseOutStartYear,
    phaseOutEndYear: fullExpirationYear,
  }
}

// ─── Status classification ────────────────────────────────────────────────────

/**
 * Classify where this property sits relative to the target window.
 *
 * @param window      - calculated expiration window
 * @param minMonths   - start of target window (months from now), default 0
 * @param maxMonths   - end of target window (months from now), default 36
 */
export function classifyStatus(
  window: ExpirationWindow,
  minMonths = DEFAULT_WINDOW_MIN_MONTHS,
  maxMonths = DEFAULT_WINDOW_MAX_MONTHS
): ExpirationStatus {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() // 0-indexed

  // Convert window bounds to year fractions
  const windowStartYear = currentYear + minMonths / 12
  const windowEndYear = currentYear + maxMonths / 12

  const fullExp = window.fullExpirationYear
  const phaseStart = window.phaseOutStartYear

  // Already fully expired
  if (fullExp < currentYear || (fullExp === currentYear && currentMonth >= 11)) {
    return "EXPIRED"
  }

  // Currently in phase-out (phase has started, full expiration hasn't hit)
  if (phaseStart <= currentYear && fullExp > currentYear) {
    return "IN_PHASE_OUT"
  }

  // Full expiration falls within target window
  if (fullExp >= windowStartYear && fullExp <= windowEndYear) {
    return "APPROACHING"
  }

  // Phase-out starts within target window (owner will start feeling pain)
  if (phaseStart >= windowStartYear && phaseStart <= windowEndYear) {
    return "APPROACHING"
  }

  return "FUTURE"
}

// ─── Month delta helper ───────────────────────────────────────────────────────

export function monthsUntilExpiration(expirationYear: number): number {
  const now = new Date()
  return (expirationYear - now.getFullYear()) * 12 - now.getMonth()
}

// ─── BBL parsing ─────────────────────────────────────────────────────────────

export function parseBBL(bble: string): { boro: string; block: string; lot: string } | null {
  // bble is typically 10 digits: 1 (boro) + 5 (block) + 4 (lot)
  const clean = bble.replace(/\D/g, "").padStart(10, "0")
  if (clean.length !== 10) return null
  return {
    boro: clean[0],
    block: clean.slice(1, 6),
    lot: clean.slice(6, 10),
  }
}

export function formatBBL(bble: string): string {
  const parts = parseBBL(bble)
  if (!parts) return bble
  return `${parts.boro}-${parts.block.replace(/^0+/, "")}-${parts.lot.replace(/^0+/, "")}`
}

export function isCondoBBL(bble: string): boolean {
  const parts = parseBBL(bble)
  if (!parts) return false
  // Condo unit lots are typically 0001+; whole-building condo lots are 7501+
  const lot = parseInt(parts.lot, 10)
  return lot >= 1 && lot <= 1000
}

// ─── Address assembly ─────────────────────────────────────────────────────────

export function buildAddress(row: RawExemption): string {
  const num = row.housenum_lo ?? ""
  const street = row.stname ?? ""
  const boro = BOROUGH_CODES[row.boro ?? ""] ?? ""
  if (!num && !street) return `BBL ${row.bble}`
  return [num, street, boro ? `, ${titleCase(boro)}` : ""].filter(Boolean).join(" ").trim()
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1))
}

// ─── Benefit start year estimation ───────────────────────────────────────────

/**
 * Estimate the benefit start year from available data.
 * The muvi-b6kx dataset includes taxyear but not an explicit start year.
 * Strategy: find the earliest tax year for this BBL/code combo — that's likely
 * the start year. Callers should pass the minimum tax year seen across all rows
 * for this BBL.
 */
export function estimateStartYear(
  earliestTaxYear: number,
  benefitType: BenefitType | null
): number | null {
  if (!benefitType) return null
  // Tax years in NYC run July 1–June 30 of the following calendar year.
  // The "start year" in common usage is the tax year when benefit began.
  return earliestTaxYear
}

// ─── Main: process raw exemption rows → ExemptionRecords ─────────────────────

/**
 * Convert raw Socrata rows into processed ExemptionRecords with computed
 * expiration dates, status classification, and edge-case flags.
 *
 * Groups by BBL first to detect multi-exemption cases and find start year.
 */
export function processExemptions(
  rows: RawExemption[],
  minMonths = DEFAULT_WINDOW_MIN_MONTHS,
  maxMonths = DEFAULT_WINDOW_MAX_MONTHS
): ExemptionRecord[] {
  // Group by BBL
  const byBBL = new Map<string, RawExemption[]>()
  for (const row of rows) {
    const key = row.bble
    if (!byBBL.has(key)) byBBL.set(key, [])
    byBBL.get(key)!.push(row)
  }

  const results: ExemptionRecord[] = []

  for (const [bbl, bblRows] of byBBL) {
    const flags: string[] = []

    // Sort by tax year ascending to find start year
    bblRows.sort((a, b) => parseInt(a.taxyear) - parseInt(b.taxyear))
    const earliest = bblRows[0]
    const latest = bblRows[bblRows.length - 1]

    // Detect multiple distinct exemption codes on same BBL
    const codes = new Set(bblRows.map((r) => r.exmptcode))
    if (codes.size > 1) flags.push("MULTI_EXEMPTION")

    // Use the most recent row for current values, earliest for start year
    const exemptionCode = latest.exmptcode ?? earliest.exmptcode
    const benefitType = mapCodeToBenefitType(exemptionCode)
    if (!benefitType) flags.push("UNKNOWN_CODE")

    const startYear = estimateStartYear(parseInt(earliest.taxyear), benefitType)
    if (!startYear) flags.push("MISSING_START_YEAR")

    // Condo check
    if (isCondoBBL(bbl)) flags.push("CONDO_BBL")

    // Compute expiration
    let expirationYear: number | null = null
    let phaseOutStartYear: number | null = null
    let phaseOutEndYear: number | null = null
    let status: ExpirationStatus | null = null

    if (benefitType && startYear) {
      const window = calculateExpiration(startYear, benefitType)
      expirationYear = window.fullExpirationYear
      phaseOutStartYear = window.phaseOutStartYear
      phaseOutEndYear = window.phaseOutEndYear
      status = classifyStatus(window, minMonths, maxMonths)
    }

    const annualExemptAmount = parseFloat(latest.exmptamt ?? "0") || 0
    const assessedValue = parseFloat(latest.gross ?? "0") || 0
    const boroCode = parseBBL(bbl)?.boro ?? null
    const borough = boroCode ? (BOROUGH_CODES[boroCode] as Borough) : null

    results.push({
      bbl,
      address: buildAddress(latest),
      borough,
      exemptionCode,
      taxYear: parseInt(latest.taxyear),
      benefitStartYear: startYear,
      annualExemptAmount,
      assessedValue,
      buildingClass: latest.bldgclass ?? "",
      benefitType,
      expirationYear,
      phaseOutStartYear,
      phaseOutEndYear,
      expirationStatus: status,
      edgeCaseFlags: flags,
    })
  }

  return results
}

/**
 * Filter processed records to only those within the target expiration window.
 */
export function filterToWindow(
  records: ExemptionRecord[],
  includeInPhaseOut = true
): ExemptionRecord[] {
  return records.filter((r) => {
    if (r.expirationStatus === "APPROACHING") return true
    if (includeInPhaseOut && r.expirationStatus === "IN_PHASE_OUT") return true
    return false
  })
}
