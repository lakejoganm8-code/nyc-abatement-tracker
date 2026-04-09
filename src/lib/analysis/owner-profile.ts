/**
 * Owner profiling and sell-likelihood scoring.
 *
 * Combines signals available in our DB to produce a composite sell-likelihood
 * score (0–100) and owner classification. This is a heuristic model —
 * individual properties should be verified.
 *
 * Sell-likelihood signal weights:
 *   - Long ownership duration (20+ yrs)     → high (seller fatigue, low basis)
 *   - Pre-2020 mortgage (refi pressure)     → high (facing rate shock + NOI compression)
 *   - Single-asset owner                    → medium (no portfolio reason to hold)
 *   - Tax lien present                      → high (financial distress)
 *   - High deregulation risk                → medium (opportunity signal for buyer)
 *   - Govt / nonprofit owner               → suppressed (almost never sell)
 *   - Large portfolio operator (>10 bldgs)  → lower (institutional, not distressed)
 *   - Recent refinance (post-2022)          → lower (locked in, less motivated)
 */

// ─── Owner type classification ────────────────────────────────────────────────

// Patterns that indicate govt/nonprofit/institutional owners unlikely to sell
const GOVT_PATTERNS = [
  "CITY OF NEW YORK", "THE CITY OF NEW YORK", "NYC HPD", "NYC HOUSING",
  "NEW YORK CITY HOUSING", "DEPARTMENT OF HOUSING", "HUD", "UNITED STATES",
  "U.S. DEPARTMENT", "FEDERAL HOME", "FANNIE MAE", "FREDDIE MAC",
  "HOUSING DEVELOPMENT FUND", "HOUSING DEVELOPMENT CORP",
  "NEIGHBORHOOD RESTORE", "NEHEMIAH HOUSING", "PARTNERSHIP HOUSING",
  "HABITAT FOR HUMANITY", "COMMUNITY LAND TRUST", "LAND BANK",
  "PRESERVATION DEVELOPMENT", "AFFORDABLE HOUSING",
]

const NONPROFIT_SUFFIXES = [
  "FUND CORP", "FUND COMPANY", "FUND CO.", "DEVELOPMENT FUND",
  "HDFC", "H.D.F.C", "NOT-FOR-PROFIT", "NON-PROFIT",
]

const INSTITUTIONAL_LENDERS = [
  "FANNIE MAE", "FREDDIE MAC", "FEDERAL HOME LOAN",
  "NEW YORK COMMUNITY BANK", "VALLEY NATIONAL", "SIGNATURE BANK",
  "INVESTORS BANK", "DIME SAVINGS",
]

export type OwnerType =
  | "government"      // city/state/federal agency
  | "nonprofit"       // HDFCs, CDCs, community land trusts
  | "institutional"   // REITs, large portfolio operators (10+ buildings)
  | "portfolio"       // private operator with 3–9 buildings
  | "individual"      // single-asset or small private owner

export interface OwnerProfile {
  ownerName: string | null
  ownerType: OwnerType
  isGovtOrNonprofit: boolean         // suppress from "motivated seller" lists
  portfolioSize: number              // # of buildings in our pipeline under same owner
  totalPortfolioTaxShock: number     // sum of annual_exempt_amount across portfolio
  portfolioBoroughs: string[]        // unique boroughs in portfolio
  refiPressure: boolean              // mortgage pre-2020 + abatement ≤ 2yr
  refiYear: number | null            // year of last recorded mortgage
  sellLikelihoodScore: number        // 0–100
  sellLikelihoodLabel: "low" | "medium" | "high" | "very high"
  sellSignals: string[]              // human-readable reasons
  suppressFromLeads: boolean         // true for govt/nonprofit/institutional
}

function classifyOwnerType(
  ownerName: string | null,
  portfolioSize: number
): OwnerType {
  if (!ownerName) return "individual"
  const upper = ownerName.toUpperCase()

  if (GOVT_PATTERNS.some((p) => upper.includes(p))) return "government"
  if (NONPROFIT_SUFFIXES.some((s) => upper.includes(s))) return "nonprofit"
  if (portfolioSize >= 10) return "institutional"
  if (portfolioSize >= 3) return "portfolio"
  return "individual"
}

export function buildOwnerProfile(params: {
  ownerName: string | null
  portfolioSize: number
  totalPortfolioTaxShock: number
  portfolioBoroughs: string[]
  mortgageDate: string | null
  expirationYear: number | null
  ownershipYears: number | null
  hasLien: boolean
  deregulationRisk: "high" | "medium" | "low" | null
  dosEntityStatus: string | null
  dosDateOfFormation: string | null
}): OwnerProfile {
  const {
    ownerName, portfolioSize, totalPortfolioTaxShock, portfolioBoroughs,
    mortgageDate, expirationYear, ownershipYears, hasLien,
    deregulationRisk, dosEntityStatus, dosDateOfFormation,
  } = params

  const ownerType = classifyOwnerType(ownerName, portfolioSize)
  const isGovtOrNonprofit = ownerType === "government" || ownerType === "nonprofit"
  const suppressFromLeads = isGovtOrNonprofit || ownerType === "institutional"

  // Refi pressure: mortgage pre-2020 AND abatement expires ≤ 2 years
  const currentYear = new Date().getFullYear()
  const refiYear = mortgageDate ? new Date(mortgageDate).getFullYear() : null
  const expiringVeryShortly = expirationYear != null && expirationYear <= currentYear + 2
  const refiPressure = refiYear != null && refiYear < 2020 && expiringVeryShortly

  // ─── Sell likelihood scoring ──────────────────────────────────────────────
  const signals: string[] = []
  let score = 0

  if (isGovtOrNonprofit) {
    return {
      ownerName,
      ownerType,
      isGovtOrNonprofit: true,
      portfolioSize,
      totalPortfolioTaxShock,
      portfolioBoroughs,
      refiPressure: false,
      refiYear,
      sellLikelihoodScore: 0,
      sellLikelihoodLabel: "low",
      sellSignals: ["Government or nonprofit owner — unlikely to sell"],
      suppressFromLeads: true,
    }
  }

  // Ownership duration
  if (ownershipYears != null && ownershipYears >= 25) {
    score += 30; signals.push(`${ownershipYears}-year hold — very long basis, seller fatigue likely`)
  } else if (ownershipYears != null && ownershipYears >= 15) {
    score += 18; signals.push(`${ownershipYears}-year hold — long basis, possible seller fatigue`)
  } else if (ownershipYears != null && ownershipYears >= 10) {
    score += 8; signals.push(`${ownershipYears}-year hold`)
  }

  // Refi pressure
  if (refiPressure) {
    score += 25
    signals.push(`Mortgage from ${refiYear} — faces refi into 7%+ rates with compressed NOI`)
  } else if (refiYear != null && refiYear < 2020) {
    score += 12
    signals.push(`Mortgage from ${refiYear} — aging debt, refinance pressure building`)
  }

  // Tax lien
  if (hasLien) {
    score += 20; signals.push("On tax lien sale list — active financial distress")
  }

  // Single-asset owner
  if (portfolioSize === 1) {
    score += 10; signals.push("Single-asset owner — no portfolio diversification incentive to hold")
  } else if (portfolioSize <= 2) {
    score += 5
  } else if (portfolioSize >= 10) {
    score -= 15; signals.push(`Portfolio operator (${portfolioSize} buildings) — institutional, less motivated`)
  }

  // Deregulation risk (for buyer signal — owner may not realize the upside)
  if (deregulationRisk === "high") {
    score += 8; signals.push("High deregulation risk — post-expiration upside may not be priced in")
  }

  // DOS entity dissolved/inactive (bad sign for the LLC)
  if (dosEntityStatus && dosEntityStatus.toUpperCase() !== "ACTIVE") {
    score += 10; signals.push(`DOS entity status: ${dosEntityStatus} — LLC may be inactive`)
  }

  // DOS entity very young (<3 years) — speculative vehicle, may flip
  if (dosDateOfFormation) {
    const formedYear = new Date(dosDateOfFormation).getFullYear()
    const age = currentYear - formedYear
    if (age <= 3) {
      score += 8; signals.push(`LLC formed ${formedYear} — young entity, possibly opportunistic`)
    }
  }

  // Recent refi (post-2022) suppresses score — locked in
  if (refiYear != null && refiYear >= 2022) {
    score -= 10; signals.push(`Recently refinanced (${refiYear}) — likely locked in`)
  }

  const clamped = Math.max(0, Math.min(100, score))

  const label: OwnerProfile["sellLikelihoodLabel"] =
    clamped >= 70 ? "very high" :
    clamped >= 45 ? "high" :
    clamped >= 20 ? "medium" : "low"

  return {
    ownerName,
    ownerType,
    isGovtOrNonprofit,
    portfolioSize,
    totalPortfolioTaxShock,
    portfolioBoroughs,
    refiPressure,
    refiYear,
    sellLikelihoodScore: clamped,
    sellLikelihoodLabel: label,
    sellSignals: signals,
    suppressFromLeads,
  }
}

/**
 * Build portfolio map from a full list of properties.
 * Returns owner_name → { count, totalTaxShock, boroughs }
 */
export function buildPortfolioMap(properties: Array<{
  bbl: string
  owner_name: string | null
  annual_exempt_amount: number
  borough: string | null
}>): Map<string, { count: number; totalTaxShock: number; boroughs: string[] }> {
  const map = new Map<string, { count: number; totalTaxShock: number; boroughs: Set<string> }>()

  for (const p of properties) {
    const key = p.owner_name?.trim().toUpperCase()
    if (!key) continue
    const entry = map.get(key) ?? { count: 0, totalTaxShock: 0, boroughs: new Set() }
    entry.count++
    entry.totalTaxShock += p.annual_exempt_amount ?? 0
    if (p.borough) entry.boroughs.add(p.borough)
    map.set(key, entry)
  }

  return new Map(
    Array.from(map.entries()).map(([k, v]) => [
      k,
      { count: v.count, totalTaxShock: v.totalTaxShock, boroughs: Array.from(v.boroughs) },
    ])
  )
}
