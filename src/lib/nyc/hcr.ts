/**
 * HCR (NYS Homes and Community Renewal) rent stabilization registry.
 * Dataset: 8y9c-t29b — DHCR Rent Stabilized Building List.
 *
 * Returns a set of BBLs that are registered as containing rent-stabilized units.
 * Uses the same OR-clause strategy as hpd.ts (dataset stores boroid/block/lot separately).
 */

import { getSocrataClient } from "./socrata"
import { DATASETS } from "@/lib/analysis/config"
import { buildBBLOrClause, rowToBBL } from "./bbl-utils"

const CHUNK_SIZE = 100

/**
 * Fetch HCR rent stabilization registry for a list of BBLs.
 * Returns Map<bbl, true> for BBLs found in the HCR registry.
 */
export async function fetchHCRStabilizedBuildings(
  bbls: string[]
): Promise<Map<string, boolean>> {
  const client = getSocrataClient()
  const result = new Map<string, boolean>()

  for (let i = 0; i < bbls.length; i += CHUNK_SIZE) {
    const chunk = bbls.slice(i, i + CHUNK_SIZE)
    const where = buildBBLOrClause(chunk)

    const rows = await client.fetchAll<Record<string, string>>(DATASETS.HCR_STABILIZED, {
      $where: where,
      $select: "boroid,block,lot",
      $limit: 10000,
    })

    for (const row of rows) {
      const bbl = rowToBBL(row)
      result.set(bbl, true)
    }
  }

  return result
}
