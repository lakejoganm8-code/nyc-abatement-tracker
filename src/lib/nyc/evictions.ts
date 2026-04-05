/**
 * NYC Housing Court eviction data.
 * Dataset: 6z8x-tj6h — NYC Evictions (Marshal Evictions / Housing Court).
 *
 * Matches by HPD buildingid (= registration_id stored in hpd_data).
 * Returns eviction counts in the last 12 months per registrationId.
 */

import { getSocrataClient } from "./socrata"
import { DATASETS } from "@/lib/analysis/config"

const CHUNK_SIZE = 200

/**
 * Fetch eviction counts (last 12 months) for a list of HPD registration IDs.
 * Returns Map<registrationId, count>.
 */
export async function fetchEvictionCounts(
  registrationIds: string[]
): Promise<Map<string, number>> {
  const client = getSocrataClient()
  const result = new Map<string, number>()

  if (registrationIds.length === 0) return result

  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  const cutoffStr = cutoff.toISOString().split("T")[0]

  for (let i = 0; i < registrationIds.length; i += CHUNK_SIZE) {
    const chunk = registrationIds.slice(i, i + CHUNK_SIZE)
    const inClause = chunk.map((id) => `'${id}'`).join(",")

    const rows = await client.fetchAll<{ buildingid: string }>(DATASETS.EVICTIONS, {
      $where: `buildingid IN (${inClause}) AND executeddate >= '${cutoffStr}'`,
      $select: "buildingid",
      $limit: 50000,
    })

    for (const row of rows) {
      const id = row.buildingid
      result.set(id, (result.get(id) ?? 0) + 1)
    }
  }

  return result
}
