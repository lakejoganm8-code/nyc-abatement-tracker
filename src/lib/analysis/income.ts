/**
 * Stabilized income estimation and implied cap rate valuation.
 *
 * Uses NYC Rent Guidelines Board (RGB) average stabilized rents by borough
 * and building size tier as a proxy for gross income. This is a conservative
 * estimate — actual rents may vary significantly by neighborhood and vintage.
 *
 * Update RGB_STABILIZED_RENTS annually from:
 * https://rentguidelinesboard.cityofnewyork.us/resources/rent-stabilized-building-data/
 *
 * Cap rate assumptions (2025) sourced from CBRE/Cushman NYC multifamily surveys.
 * Post-expiration cap rates are slightly higher (more risk = lower value per $ NOI).
 */

// ─── RGB stabilized rent proxies (2025, per unit/month) ──────────────────────
// Source: RGB Income & Expense Study 2024, Table 1 (weighted avg by borough/size)
// Size tiers: small = ≤5 units, mid = 6–20 units, large = 21+ units

export const RGB_RENTS: Record<string, Record<string, number>> = {
  manhattan: { small: 2100, mid: 1950, large: 1850 },
  brooklyn:  { small: 1750, mid: 1600, large: 1500 },
  bronx:     { small: 1350, mid: 1250, large: 1150 },
  queens:    { small: 1600, mid: 1450, large: 1350 },
  staten_island: { small: 1400, mid: 1300, large: 1200 },
}

// Operating expense ratio for stabilized NYC multifamily (RGB data)
// Covers taxes, insurance, maintenance, management, utilities
// Note: this EXCLUDES property tax — we model tax separately so we can show pre/post
export const EXPENSE_RATIO_EX_TAX = 0.30  // 30% of gross revenue (ex-tax)

// Cap rate assumptions by borough (stabilized, 2025)
// Post-expiration cap rates 50–75bps higher (deregulation risk + higher taxes)
export const CAP_RATES: Record<string, { stabilized: number; postExpiration: number }> = {
  manhattan:     { stabilized: 0.045, postExpiration: 0.055 },
  brooklyn:      { stabilized: 0.050, postExpiration: 0.060 },
  bronx:         { stabilized: 0.055, postExpiration: 0.065 },
  queens:        { stabilized: 0.050, postExpiration: 0.060 },
  staten_island: { stabilized: 0.055, postExpiration: 0.065 },
}

function sizetier(units: number): "small" | "mid" | "large" {
  if (units <= 5) return "small"
  if (units <= 20) return "mid"
  return "large"
}

export interface ValuationResult {
  // Income
  grossRentEstimate: number          // annual gross rent (units × avg stabilized rent × 12)
  operatingExpenses: number          // ex-tax operating costs
  currentPropertyTax: number         // estimated current tax (assessedValue × effective rate)
  noiCurrent: number                 // NOI with abatement in place
  noiPostExpiration: number          // NOI after abatement expires (tax shock hits fully)

  // Valuation
  impliedValueCurrent: number        // NOI_current / cap_rate_stabilized
  impliedValuePostExpiration: number // NOI_post / cap_rate_postExpiration
  dofMarketValue: number | null      // DOF's own estimate for reference
  valueDelta: number                 // impliedValueCurrent - impliedValuePostExpiration (value destroyed)
  overvaluedVsDOF: number | null     // impliedValuePostExpiration - dofMarketValue (negative = DOF is higher)

  // Key metrics
  capRateUsed: number                // stabilized cap rate assumption
  postExpirationCapRate: number
  grossYield: number                 // gross rent / implied current value
  breakEvenOccupancy: number         // % occupancy needed to cover expenses + tax post-expiration

  // Assumptions flagged
  isEstimate: boolean                // always true — label clearly in UI
  missingUnits: boolean              // true if total_units was null (can't compute)
}

/**
 * Compute stabilized income and implied valuation for a property.
 * All inputs come from property_pipeline columns.
 */
export function computeValuation(params: {
  borough: string | null
  totalUnits: number | null
  annualExemptAmount: number        // = annual tax shock at expiration
  assessedValue: number
  dofMarketValue: number | null
  exemptionCode: string
}): ValuationResult | null {
  const { borough, totalUnits, annualExemptAmount, assessedValue, dofMarketValue } = params

  if (!totalUnits || totalUnits <= 0 || !borough) return null

  const bor = borough.toLowerCase()
  const tier = sizetier(totalUnits)
  const avgRent = RGB_RENTS[bor]?.[tier] ?? RGB_RENTS.brooklyn[tier]
  const caps = CAP_RATES[bor] ?? CAP_RATES.brooklyn

  // Gross rent
  const grossRentEstimate = Math.round(avgRent * totalUnits * 12)

  // Operating expenses (ex-tax)
  const operatingExpenses = Math.round(grossRentEstimate * EXPENSE_RATIO_EX_TAX)

  // Current property tax estimate
  // NYC class 2 effective rate ~12.267% of assessed value (2025 rate)
  // assessed_value from DOF is already the taxable assessed value
  const NYC_CLASS2_TAX_RATE = 0.12267
  const currentPropertyTax = Math.round(assessedValue * NYC_CLASS2_TAX_RATE)

  // NOI current (abatement reduces tax to near-zero on the exempt portion)
  // The exemption means the owner effectively pays tax only on the non-exempt assessed value
  // We simplify: current tax = assessed_value * rate (abatement already applied in assessed)
  const noiCurrent = grossRentEstimate - operatingExpenses - currentPropertyTax

  // NOI post-expiration: add back the full annual tax shock
  const noiPostExpiration = noiCurrent - annualExemptAmount

  // Implied values
  const impliedValueCurrent = noiCurrent > 0
    ? Math.round(noiCurrent / caps.stabilized)
    : 0

  const impliedValuePostExpiration = noiPostExpiration > 0
    ? Math.round(noiPostExpiration / caps.postExpiration)
    : 0

  // Deltas
  const valueDelta = impliedValueCurrent - impliedValuePostExpiration
  const overvaluedVsDOF = dofMarketValue
    ? impliedValuePostExpiration - dofMarketValue
    : null

  // Gross yield
  const grossYield = impliedValueCurrent > 0
    ? grossRentEstimate / impliedValueCurrent
    : 0

  // Break-even occupancy post expiration
  // Revenue needed = opEx + postExpTax; breakEven = needed / grossRent
  const postExpTax = currentPropertyTax + annualExemptAmount
  const revenueNeeded = operatingExpenses + postExpTax
  const breakEvenOccupancy = grossRentEstimate > 0
    ? Math.min(1, revenueNeeded / grossRentEstimate)
    : 1

  return {
    grossRentEstimate,
    operatingExpenses,
    currentPropertyTax,
    noiCurrent,
    noiPostExpiration,
    impliedValueCurrent,
    impliedValuePostExpiration,
    dofMarketValue: dofMarketValue ?? null,
    valueDelta,
    overvaluedVsDOF,
    capRateUsed: caps.stabilized,
    postExpirationCapRate: caps.postExpiration,
    grossYield,
    breakEvenOccupancy,
    isEstimate: true,
    missingUnits: false,
  }
}

