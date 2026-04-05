/**
 * Rent upside estimation and deregulation risk assessment.
 *
 * All functions are pure (no I/O). Values are based on 2025 AMI data and
 * conservative NYC market rents. Update AMI_YEAR, AMI_RENTS, and MARKET_RENTS
 * in config.ts annually.
 */

import {
  AMI_RENTS,
  MARKET_RENTS,
  BLENDED_UNIT_MIX,
  EXEMPTION_AMI_TIER,
  STABILIZATION_CUTOFF_YEAR,
  EXEMPTION_CODES_421A,
  EXEMPTION_CODES_J51,
} from "./config"

export type DeregulationRisk = "high" | "medium" | "low"

/** Map exemption code to AMI tier label: "60%", "80%", "market", or "none" */
export function inferAMITier(exemptionCode: string): string {
  return EXEMPTION_AMI_TIER[exemptionCode] ?? "none"
}

/**
 * Estimate annual rent gain when abatement expires and rent stabilization ends.
 *
 * Returns null if:
 *   - totalUnits is null (can't compute without unit count)
 *   - AMI tier is "market" (421-a(16) buildings — units already market-rate)
 *
 * For "60%" and "80%" tiers: upside = (market - AMI_cap) × units × 12
 * For "none" (J-51): assumes current stabilized rent ≈ 70% of market rate
 */
export function computeRentUpside(
  totalUnits: number | null,
  exemptionCode: string
): number | null {
  if (totalUnits === null || totalUnits <= 0) return null

  const tier = inferAMITier(exemptionCode)

  if (tier === "market") return null // already market-rate, no upside to capture

  // Compute blended regulated and market rent across unit mix
  let regulatedRentPerUnit: number
  let marketRentPerUnit: number

  if (tier === "60%" || tier === "80%") {
    const amiRents = AMI_RENTS[tier]
    regulatedRentPerUnit =
      amiRents.studio * BLENDED_UNIT_MIX.studio +
      amiRents["1br"] * BLENDED_UNIT_MIX["1br"] +
      amiRents["2br"] * BLENDED_UNIT_MIX["2br"] +
      amiRents["3br"] * BLENDED_UNIT_MIX["3br"]
  } else {
    // J-51 ("none"): stabilized rent assumed ~70% of market
    marketRentPerUnit =
      MARKET_RENTS.studio * BLENDED_UNIT_MIX.studio +
      MARKET_RENTS["1br"] * BLENDED_UNIT_MIX["1br"] +
      MARKET_RENTS["2br"] * BLENDED_UNIT_MIX["2br"] +
      MARKET_RENTS["3br"] * BLENDED_UNIT_MIX["3br"]
    regulatedRentPerUnit = marketRentPerUnit * 0.70
    return Math.round((marketRentPerUnit - regulatedRentPerUnit) * totalUnits * 12)
  }

  marketRentPerUnit =
    MARKET_RENTS.studio * BLENDED_UNIT_MIX.studio +
    MARKET_RENTS["1br"] * BLENDED_UNIT_MIX["1br"] +
    MARKET_RENTS["2br"] * BLENDED_UNIT_MIX["2br"] +
    MARKET_RENTS["3br"] * BLENDED_UNIT_MIX["3br"]

  const monthlyUpsidePerUnit = marketRentPerUnit - regulatedRentPerUnit
  if (monthlyUpsidePerUnit <= 0) return null

  return Math.round(monthlyUpsidePerUnit * totalUnits * 12)
}

/**
 * Assess likelihood of full rent deregulation when abatement expires.
 *
 * Heuristic based on NYC Rent Stabilization Law (1969/1974 cutoff):
 * - Pre-1974 buildings with 6+ units were stabilized independently of abatements.
 *   A J-51 benefit on a pre-1974 building doesn't change that — still stabilized at expiry.
 * - Post-1974 421-a buildings: stabilization exists only because of the abatement.
 *   At expiry, no abatement = no stabilization = full deregulation.
 *
 * Verify individually for edge cases (former co-op conversions, mixed portfolios, etc.)
 */
export function assessDeregulationRisk(
  exemptionCode: string,
  yearBuilt: number | null
): DeregulationRisk {
  const is421a = EXEMPTION_CODES_421A.has(exemptionCode)
  const isJ51 = EXEMPTION_CODES_J51.has(exemptionCode)

  if (yearBuilt === null) return "medium" // unknown — can't classify confidently

  if (is421a) {
    // Post-1974 421-a: only stabilized because of the abatement → will deregulate
    return yearBuilt >= STABILIZATION_CUTOFF_YEAR ? "high" : "medium"
  }

  if (isJ51) {
    // Pre-1974 J-51: building was stabilized before the J-51 benefit → stays regulated
    return yearBuilt < STABILIZATION_CUTOFF_YEAR ? "low" : "medium"
  }

  return "medium" // unknown code
}
