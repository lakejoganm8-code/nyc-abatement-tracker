import { SCORE_WEIGHTS } from "./config"
import type { ExemptionRecord, HPDData, ACRISRecord, PropertyScore, ScoreComponents } from "@/types"

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
 * Rough estimate: mortgage / assessed_value * equalization_rate (assume ~45% for NYC class 2).
 * LTV 0% = 0, LTV 100%+ = 100.
 */
function debtLoadScore(
  lastMortgageAmount: number | null,
  assessedValue: number
): number {
  if (!lastMortgageAmount || !assessedValue) return 0
  // NYC class 2 equalization rate ~45%
  const estimatedMarketValue = assessedValue / 0.45
  const ltv = lastMortgageAmount / estimatedMarketValue
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
 * HPD violations: more violations = higher distress signal.
 * 0 = 0, 20+ = 100.
 */
function violationScore(violationCount12mo: number): number {
  return clamp((violationCount12mo / 20) * 100)
}

// ─── Main scorer ─────────────────────────────────────────────────────────────

export function scoreProperty(
  exemption: ExemptionRecord,
  hpd: HPDData | null,
  acris: ACRISRecord | null
): PropertyScore {
  const components: ScoreComponents = {
    taxImpact: taxImpactScore(exemption.annualExemptAmount),
    timeToExpiration: timeToExpirationScore(
      exemption.expirationYear,
      exemption.phaseOutStartYear
    ),
    debtLoad: debtLoadScore(
      acris?.lastMortgageAmount ?? null,
      exemption.assessedValue
    ),
    ownershipDuration: ownershipDurationScore(acris?.ownershipYears ?? null),
    violations: violationScore(hpd?.violationCount12mo ?? 0),
  }

  const distressScore =
    components.taxImpact       * SCORE_WEIGHTS.taxImpact +
    components.timeToExpiration * SCORE_WEIGHTS.timeToExpiration +
    components.debtLoad         * SCORE_WEIGHTS.debtLoad +
    components.ownershipDuration * SCORE_WEIGHTS.ownershipDuration +
    components.violations       * SCORE_WEIGHTS.violations

  return {
    bbl: exemption.bbl,
    distressScore: Math.round(distressScore * 10) / 10,
    components,
    scoredAt: new Date().toISOString(),
  }
}

/**
 * Score a batch of exemptions and return sorted by distress score descending.
 */
export function scoreAll(
  exemptions: ExemptionRecord[],
  hpdMap: Map<string, HPDData>,
  acrisMap: Map<string, ACRISRecord>
): PropertyScore[] {
  return exemptions
    .map((e) => scoreProperty(e, hpdMap.get(e.bbl) ?? null, acrisMap.get(e.bbl) ?? null))
    .sort((a, b) => b.distressScore - a.distressScore)
}
