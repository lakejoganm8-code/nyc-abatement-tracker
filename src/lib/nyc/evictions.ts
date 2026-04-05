/**
 * NYC Housing Court eviction data.
 * Dataset: 6z8x-tj6h — NYC Evictions.
 * Matches by HPD buildingid (= registration_id stored in hpd_data).
 */

import { getSocrataClient } from "./socrata"
import { DATASETS } from "@/lib/analysis/config"

const CHUNK_SIZE = 200
const CONCURRENCY = 5

export async function fetchEvictionCounts(
  registrationIds: string[]
): Promise<Map<string, number>> {
  const client = getSocrataClient()
  const result = new Map<string, number>()

  if (registrationIds.length === 0) return result

  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  const cutoffStr = cutoff.toISOString().split("T")[0]

  const chunks: string[][] = []
  for (let i = 0; i < registrationIds.length; i += CHUNK_SIZE) {
    chunks.push(registrationIds.slice(i, i + CHUNK_SIZE))
  }

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const wave = chunks.slice(i, i + CONCURRENCY)
    const waveResults = await Promise.all(
      wave.map((chunk) => {
        const inClause = chunk.map((id) => `'${id}'`).join(",")
        return client.fetchAll<{ buildingid: string }>(DATASETS.EVICTIONS, {
          $where: `buildingid IN (${inClause}) AND executeddate >= '${cutoffStr}'`,
          $select: "buildingid",
          $limit: 50000,
        })
      })
    )
    for (const rows of waveResults) {
      for (const row of rows) {
        const id = row.buildingid
        result.set(id, (result.get(id) ?? 0) + 1)
      }
    }
  }

  return result
}
