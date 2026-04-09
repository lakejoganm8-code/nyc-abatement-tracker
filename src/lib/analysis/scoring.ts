import { SCORE_WEIGHTS } from "./config"
import { inferAMITier, computeRentUpside, assessDeregulationRisk } from "./rent-upside"
import { computeValuation } from "./income"
import { buildOwnerProfile, buildPortfolioMap } from "./owner-profile"
import type { ExemptionRecord, HPDData, ACRISRecord, PLUTOData, PropertyScore, ScoreComponents } from "@/types"

// ─── Normalization helpers ────────────────────────────────────────────────────

/** Clamp a value to [0, 100] */
const clamp = (v: number) => Math.max(0, Math.min(100, v))

// ─── Individual component scorers ────────────────────────────────────────────

/**
 * Tax impact: how big is the annual exemption amount being lost?
 * Scaled: $0 = 0, $500k+ = 100
 */
function taxImpactScore(annualExemptAmount: number): number {
  const MAX = 500_000
  return clamp((annualExemptAmount / MAX) * 100)
}

/**
 * Time to expiration: closer = higher urgency score.
 * 0 months (already expiring) = 100, 36 months out = 0, beyond 36 = 0.
 * In phase-out gets partial score based on phase-out start.
 */
function timeToExpirationScore(
  expirationYear: number | null,
  phaseOutStartYear: number | null
): number {
  if (!expirationYear) return 0
  const now = new Date()
  const currentYear = now.getFullYear()

  // If currently in phase-out, use phase-out start as the "event"
  const targetYear = phaseOutStartYear !== null && phaseOutStartYear <= currentYear
    ? expirationYear          // already in phase-out — score on full expiration
    : phaseOutStartYear ?? expirationYear

  const monthsOut = (targetYear - currentYear) * 12 - now.getMonth()
  if (monthsOut <= 0) return 100
  if (monthsOut >= 36) return 0
  return clamp(100 - (monthsOut / 36) * 100)
}

/**
 * Debt load: estimated LTV. Higher LTV = more refinancing pressure.
 * Uses DOF market value if available; falls back to assessed_value / 0.45.
 * LTV 0% = 0, LTV 100%+ = 100.
 */
function debtLoadScore(
  lastMortgageAmount: number | null,
  assessedValue: number,
  dofMarketValue?: number | null
): number {
  if (!lastMortgageAmount) return 0
  const marketValue = dofMarketValue && dofMarketValue > 0
    ? dofMarketValue
    : assessedValue > 0 ? assessedValue / 0.45 : 0
  if (!marketValue) return 0
  const ltv = lastMortgageAmount / marketValue
  return clamp(ltv * 100)
}

/**
 * Ownership duration: longer = more potential seller fatigue / lower basis.
 * 0 years = 0, 20+ years = 100.
 */
function ownershipDurationScore(ownershipYears: number | null): number {
  if (!ownershipYears) return 0
  return clamp((ownershipYears / 20) * 100)
}

/**
 * Building condition: HPD violations + DOB violations combined.
 * 0 = 0, 30+ combined = 100.
 */
function violationScore(hpdViolations: number, dobViolations: number): number {
  return clamp(((hpdViolations + dobViolations) / 30) * 100)
}

/**
 * Tax lien: binary — if property is on the tax lien sale list, full score.
 */
function taxLienScore(hasLien: boolean): number {
  return hasLien ? 100 : 0
}

/**
 * Housing court activity: HP actions + nonpayment cases (last 12mo).
 * 0 = 0, 10+ cases = 100.
 */
function housingCourtScore(hpActions: number, nonpaymentCases: number): number {
  return clamp(((hpActions + nonpaymentCases) / 10) * 100)
}

// ─── Main scorer ─────────────────────────────────────────────────────────────

export interface ScoringExtra {
  hasLien: boolean
  dobViolationCount: number
  hpActionCount: number
  nonpaymentCount: number
  dofMarketValue?: number | null
  portfolioSize?: number
  totalPortfolioTaxShock?: number
  portfolioBoroughs?: string[]
}

export function scoreProperty(
  exemption: ExemptionRecord,
  hpd: HPDData | null,
  acris: ACRISRecord | null,
  pluto: PLUTOData | null,
  extra?: ScoringExtra
): PropertyScore {
  const components: ScoreComponents = {
    taxImpact: taxImpactScore(exemption.annualExemptAmount),
    timeToExpiration: timeToExpirationScore(
      exemption.expirationYear,
      exemption.phaseOutStartYear
    ),
    debtLoad: debtLoadScore(
      acris?.lastMortgageAmount ?? null,
      exemption.assessedValue,
      extra?.dofMarketValue
    ),
    ownershipDuration: ownershipDurationScore(acris?.ownershipYears ?? null),
    violations: violationScore(hpd?.violationCount12mo ?? 0, extra?.dobViolationCount ?? 0),
    taxLien: taxLienScore(extra?.hasLien ?? false),
    housingCourt: housingCourtScore(extra?.hpActionCount ?? 0, extra?.nonpaymentCount ?? 0),
  }

  const distressScore =
    components.taxImpact        * SCORE_WEIGHTS.taxImpact +
    components.timeToExpiration  * SCORE_WEIGHTS.timeToExpiration +
    components.debtLoad          * SCORE_WEIGHTS.debtLoad +
    components.ownershipDuration * SCORE_WEIGHTS.ownershipDuration +
    components.violations        * SCORE_WEIGHTS.violations +
    components.taxLien           * SCORE_WEIGHTS.taxLien +
    components.housingCourt      * SCORE_WEIGHTS.housingCourt

  const totalUnits = pluto?.totalUnits ?? hpd?.totalUnits ?? null
  const amiTier = inferAMITier(exemption.exemptionCode)
  const estimatedAnnualRentUpside = computeRentUpside(totalUnits, exemption.exemptionCode)
  const deregulationRisk = assessDeregulationRisk(exemption.exemptionCode, pluto?.yearBuilt ?? null)

  // Valuation
  const valuation = computeValuation({
    borough: exemption.borough,
    totalUnits,
    annualExemptAmount: exemption.annualExemptAmount,
    assessedValue: exemption.assessedValue,
    dofMarketValue: extra?.dofMarketValue ?? null,
    exemptionCode: exemption.exemptionCode,
  })

  // Owner profile
  const ownerName = acris?.ownerName ?? null
  const profile = buildOwnerProfile({
    ownerName,
    portfolioSize: extra?.portfolioSize ?? 1,
    totalPortfolioTaxShock: extra?.totalPortfolioTaxShock ?? exemption.annualExemptAmount,
    portfolioBoroughs: extra?.portfolioBoroughs ?? (exemption.borough ? [exemption.borough] : []),
    mortgageDate: acris?.mortgageDate ?? null,
    expirationYear: exemption.expirationYear,
    ownershipYears: acris?.ownershipYears ?? null,
    hasLien: extra?.hasLien ?? false,
    deregulationRisk,
    dosEntityStatus: null,  // not in scoring context — used in slide-over
    dosDateOfFormation: null,
  })

  return {
    bbl: exemption.bbl,
    distressScore: Math.round(distressScore * 10) / 10,
    components,
    estimatedAnnualRentUpside,
    deregulationRisk,
    amiTier,
    scoredAt: new Date().toISOString(),
    // Valuation
    grossRentEstimate: valuation?.grossRentEstimate ?? null,
    noiCurrent: valuation?.noiCurrent ?? null,
    noiPostExpiration: valuation?.noiPostExpiration ?? null,
    impliedValueCurrent: valuation?.impliedValueCurrent ?? null,
    impliedValuePostExpiration: valuation?.impliedValuePostExpiration ?? null,
    valueDelta: valuation?.valueDelta ?? null,
    breakEvenOccupancy: valuation?.breakEvenOccupancy ?? null,
    // Owner profile
    ownerType: profile.ownerType,
    portfolioSize: profile.portfolioSize,
    totalPortfolioTaxShock: profile.totalPortfolioTaxShock,
    refiPressure: profile.refiPressure,
    sellLikelihoodScore: profile.sellLikelihoodScore,
    sellLikelihoodLabel: profile.sellLikelihoodLabel,
    sellSignals: profile.sellSignals,
    suppressFromLeads: profile.suppressFromLeads,
  }
}

/**
 * Score a batch of exemptions and return sorted by distress score descending.
 * Builds a portfolio map from all exemptions to enrich owner profiles.
 */
export function scoreAll(
  exemptions: ExemptionRecord[],
  hpdMap: Map<string, HPDData>,
  acrisMap: Map<string, ACRISRecord>,
  plutoMap: Map<string, PLUTOData>,
  extraMap?: Map<string, ScoringExtra>
): PropertyScore[] {
  // Build portfolio map across all properties (owner name → count + tax shock)
  const portfolioMap = buildPortfolioMap(
    exemptions.map((e) => ({
      bbl: e.bbl,
      owner_name: acrisMap.get(e.bbl)?.ownerName ?? null,
      annual_exempt_amount: e.annualExemptAmount,
      borough: e.borough,
    }))
  )

  return exemptions
    .map((e) => {
      const ownerName = acrisMap.get(e.bbl)?.ownerName?.trim().toUpperCase() ?? null
      const portfolio = ownerName ? portfolioMap.get(ownerName) : null
      const base = extraMap?.get(e.bbl) ?? {
        hasLien: false, dobViolationCount: 0, hpActionCount: 0, nonpaymentCount: 0,
      }
      return scoreProperty(
        e,
        hpdMap.get(e.bbl) ?? null,
        acrisMap.get(e.bbl) ?? null,
        plutoMap.get(e.bbl) ?? null,
        {
          ...base,
          portfolioSize: portfolio?.count ?? 1,
          totalPortfolioTaxShock: portfolio?.totalTaxShock ?? e.annualExemptAmount,
          portfolioBoroughs: portfolio?.boroughs ?? (e.borough ? [e.borough] : []),
        },
      )
    })
    .sort((a, b) => b.distressScore - a.distressScore)
}
