/**
 * NYC Marshal Evictions dataset.
 * Dataset: 6z8x-wfk4 — Evictions (has bbl column directly).
 * Returns eviction counts in the last 12 months per BBL.
 */

import { getSocrataClient } from "./socrata"
import { DATASETS } from "@/lib/analysis/config"

const CHUNK_SIZE = 100
const CONCURRENCY = 5

export async function fetchEvictionCounts(
  bbls: string[]
): Promise<Map<string, number>> {
  const client = getSocrataClient()
  const result = new Map<string, number>()

  if (bbls.length === 0) return result

  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  const cutoffStr = cutoff.toISOString().split("T")[0]

  const chunks: string[][] = []
  for (let i = 0; i < bbls.length; i += CHUNK_SIZE) {
    chunks.push(bbls.slice(i, i + CHUNK_SIZE))
  }

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const wave = chunks.slice(i, i + CONCURRENCY)
    const waveResults = await Promise.all(
      wave.map((chunk) => {
        const inClause = chunk.map((b) => `'${b}'`).join(",")
        return client.fetchAll<{ bbl: string }>(DATASETS.EVICTIONS, {
          $where: `bbl IN (${inClause}) AND executed_date >= '${cutoffStr}' AND residential_commercial_ind='Residential'`,
          $select: "bbl",
        })
      })
    )
    for (const rows of waveResults) {
      for (const row of rows) {
        const bbl = row.bbl
        if (bbl) result.set(bbl, (result.get(bbl) ?? 0) + 1)
      }
    }
  }

  return result
}
