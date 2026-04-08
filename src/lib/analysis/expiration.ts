import {
  BENEFIT_TYPE_META,
  DEFAULT_WINDOW_MAX_MONTHS,
  DEFAULT_WINDOW_MIN_MONTHS,
  BOROUGH_CODES,
} from "./config"
import type {
  BenefitType,
  ExemptionRecord,
  ExpirationStatus,
  ExpirationWindow,
  RawExemption,
  Borough,
} from "@/types"

const PHASE_OUT_YEARS = 4 // universal NYC abatement phase-out schedule

// ─── Expiration window calculation ────────────────────────────────────────────

/**
 * Calculate expiration timeline.
 * Expiration = benefitStartYear + totalYears
 * Phase-out = last PHASE_OUT_YEARS years of the benefit period
 */
export function calculateExpiration(
  startYear: number,
  totalYears: number
): ExpirationWindow {
  const fullExpirationYear = startYear + totalYears
  const phaseOutStartYear = fullExpirationYear - PHASE_OUT_YEARS
  return {
    fullExpirationYear,
    phaseOutStartYear,
    phaseOutEndYear: fullExpirationYear,
  }
}

// ─── Status classification ────────────────────────────────────────────────────

export function classifyStatus(
  window: ExpirationWindow,
  minMonths = DEFAULT_WINDOW_MIN_MONTHS,
  maxMonths = DEFAULT_WINDOW_MAX_MONTHS
): ExpirationStatus {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()

  const windowStartYear = currentYear + minMonths / 12
  const windowEndYear = currentYear + maxMonths / 12

  const fullExp = window.fullExpirationYear
  const phaseStart = window.phaseOutStartYear

  if (fullExp < currentYear || (fullExp === currentYear && currentMonth >= 11)) {
    return "EXPIRED"
  }

  if (phaseStart <= currentYear && fullExp > currentYear) {
    return "IN_PHASE_OUT"
  }

  if (fullExp >= windowStartYear && fullExp <= windowEndYear) {
    return "APPROACHING"
  }

  if (phaseStart >= windowStartYear && phaseStart <= windowEndYear) {
    return "APPROACHING"
  }

  return "FUTURE"
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function monthsUntilExpiration(expirationYear: number): number {
  const now = new Date()
  return (expirationYear - now.getFullYear()) * 12 - now.getMonth()
}

export function parseBBL(parid: string): { boro: string; block: string; lot: string } | null {
  const clean = parid.replace(/\D/g, "").padStart(10, "0")
  if (clean.length !== 10) return null
  return {
    boro: clean[0],
    block: clean.slice(1, 6),
    lot: clean.slice(6, 10),
  }
}

/**
 * True condo unit BBLs: NYC DOF assigns lots 1001-7499 to individual condo units.
 * Lots 1-999 are regular tax lots (whole buildings, garages, stores, etc.).
 * Lot 0001 is the condo master/parent lot (the whole building).
 */
export function isCondoBBL(parid: string): boolean {
  const parts = parseBBL(parid)
  if (!parts) return false
  const lot = parseInt(parts.lot, 10)
  return lot >= 1001 && lot <= 7499
}

/** Return the parent/master BBL for a condo unit (same boro+block, lot 0001) */
export function getParentBBL(parid: string): string {
  const clean = parid.replace(/\D/g, "").padStart(10, "0")
  return clean.slice(0, 6) + "0001"
}

/** Strip leading "+" and parse numeric string from basetot / benftstart */
function parseNumericField(val: string): number {
  return parseInt(val.replace(/^\+0*/, "")) || 0
}

// ─── Build BenefitType from row data ─────────────────────────────────────────

function buildBenefitType(code: string, noYears: number): BenefitType | null {
  const meta = BENEFIT_TYPE_META[code]
  if (!meta) return null
  return {
    code,
    label: meta.label,
    exemptionType: meta.exemptionType,
    durationYears: noYears,
    phaseOutYears: PHASE_OUT_YEARS,
    phaseOutReductionPerYear: 0.25,
  }
}

// ─── Main: process raw exemption rows → ExemptionRecords ─────────────────────

/**
 * Convert raw Socrata rows into processed ExemptionRecords.
 * Groups by BBL (parid), deduplicates by taking the most recent tax year,
 * and computes expiration dates using the `benftstart` + `no_years` fields
 * directly from the dataset.
 *
 * Condo handling: NYC assigns lots 1001-7499 to individual condo units.
 * These are collapsed into their parent lot (same boro+block, lot 0001).
 * The parent record receives the sum of all unit exempt amounts and a
 * `condoUnitCount` reflecting how many units were merged.
 */
export function processExemptions(
  rows: RawExemption[],
  minMonths = DEFAULT_WINDOW_MIN_MONTHS,
  maxMonths = DEFAULT_WINDOW_MAX_MONTHS
): ExemptionRecord[] {
  // Group by BBL (parid)
  const byBBL = new Map<string, RawExemption[]>()
  for (const row of rows) {
    const bbl = row.parid.replace(/\D/g, "").padStart(10, "0")
    if (!byBBL.has(bbl)) byBBL.set(bbl, [])
    byBBL.get(bbl)!.push(row)
  }

  // ── Pass 1: process every BBL independently ──────────────────────────────
  const recordsByBBL = new Map<string, ExemptionRecord>()

  for (const [bbl, bblRows] of byBBL) {
    const flags: string[] = []

    // Sort by tax year descending — use the most recent row
    bblRows.sort((a, b) => parseInt(b.year) - parseInt(a.year))
    const latest = bblRows[0]

    // Detect multiple distinct exemption codes on same BBL
    const codes = new Set(bblRows.map((r) => r.exmp_code))
    if (codes.size > 1) flags.push("MULTI_EXEMPTION")

    const code = latest.exmp_code
    const noYears = parseInt(latest.no_years) || 0
    const benefitType = buildBenefitType(code, noYears)
    if (!benefitType) flags.push("UNKNOWN_CODE")

    // Parse benefit start year (may have leading "+" like "+2009")
    const startYear = parseNumericField(latest.benftstart)
    if (!startYear) flags.push("MISSING_START_YEAR")

    // True condo unit: lots 1001–7499
    const isCondo = isCondoBBL(bbl)
    if (isCondo) flags.push("CONDO_BBL")

    // Compute expiration
    let expirationYear: number | null = null
    let phaseOutStartYear: number | null = null
    let phaseOutEndYear: number | null = null
    let status: ExpirationStatus | null = null

    if (noYears && startYear) {
      const window = calculateExpiration(startYear, noYears)
      expirationYear = window.fullExpirationYear
      phaseOutStartYear = window.phaseOutStartYear
      phaseOutEndYear = window.phaseOutEndYear
      status = classifyStatus(window, minMonths, maxMonths)
    }

    // Use most recent non-zero exempt amount — latest year may be 0 during phase-out
    const annualExemptAmount = bblRows
      .map((r) => parseFloat(r.curexmptot ?? "0") || 0)
      .find((v) => v > 0) ?? 0
    const assessedValue = parseNumericField(latest.basetot ?? "0")
    const boroCode = parseBBL(bbl)?.boro ?? latest.boro ?? null
    const borough = boroCode ? (BOROUGH_CODES[boroCode] as Borough) : null

    recordsByBBL.set(bbl, {
      bbl,
      address: `BBL ${bbl}`, // address comes from PLUTO join in property_pipeline view
      borough,
      exemptionCode: code,
      taxYear: parseInt(latest.year),
      benefitStartYear: startYear || null,
      annualExemptAmount,
      assessedValue,
      buildingClass: latest.bldg_class ?? "",
      benefitType,
      expirationYear,
      phaseOutStartYear,
      phaseOutEndYear,
      expirationStatus: status,
      edgeCaseFlags: flags,
      condoUnitCount: null,
    })
  }

  // ── Pass 2: collapse condo units (lots 1001-7499) into their parent lot ──
  // Track condo units grouped by parent BBL
  const condoByParent = new Map<string, ExemptionRecord[]>()
  const nonCondoRecords: ExemptionRecord[] = []

  for (const record of recordsByBBL.values()) {
    if (record.edgeCaseFlags.includes("CONDO_BBL")) {
      const parentBBL = getParentBBL(record.bbl)
      if (!condoByParent.has(parentBBL)) condoByParent.set(parentBBL, [])
      condoByParent.get(parentBBL)!.push(record)
    } else {
      nonCondoRecords.push(record)
    }
  }

  // Merge condo units into parent records (or synthesize a parent if none exists)
  for (const [parentBBL, units] of condoByParent) {
    const existingParent = recordsByBBL.get(parentBBL)

    // Sum exempt amounts across all units
    const totalExempt = units.reduce((s, u) => s + u.annualExemptAmount, 0)
    const totalAssessed = units.reduce((s, u) => s + u.assessedValue, 0)
    // Use the earliest expiration year (most urgent unit drives the timeline)
    const earliestExpiry = units
      .map((u) => u.expirationYear)
      .filter((y): y is number => y !== null)
      .sort((a, b) => a - b)[0] ?? null

    if (existingParent) {
      // Parent lot already has its own exemption record — enrich it
      existingParent.annualExemptAmount += totalExempt
      existingParent.assessedValue += totalAssessed
      existingParent.condoUnitCount = units.length
      // If parent expires later than some units, use earliest
      if (earliestExpiry && (!existingParent.expirationYear || earliestExpiry < existingParent.expirationYear)) {
        existingParent.expirationYear = earliestExpiry
      }
    } else {
      // No parent lot in dataset — synthesize one from the representative unit
      const rep = units.sort((a, b) =>
        (b.annualExemptAmount) - (a.annualExemptAmount)
      )[0]
      const syntheticFlags = rep.edgeCaseFlags.filter((f) => f !== "CONDO_BBL")
      nonCondoRecords.push({
        ...rep,
        bbl: parentBBL,
        annualExemptAmount: totalExempt,
        assessedValue: totalAssessed,
        expirationYear: earliestExpiry,
        edgeCaseFlags: syntheticFlags,
        condoUnitCount: units.length,
      })
    }
  }

  return nonCondoRecords
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

// Keep mapCodeToBenefitType for backward compat (scoring module uses it)
export function mapCodeToBenefitType(code: string): BenefitType | null {
  const meta = BENEFIT_TYPE_META[code]
  if (!meta) return null
  return {
    code,
    label: meta.label,
    exemptionType: meta.exemptionType,
    durationYears: 0,
    phaseOutYears: PHASE_OUT_YEARS,
    phaseOutReductionPerYear: 0.25,
  }
}
