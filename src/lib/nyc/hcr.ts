/**
 * HCR (NYS Homes and Community Renewal) rent stabilization registry.
 * Dataset: 8y9c-t29b — DHCR Rent Stabilized Building List.
 */

import { getSocrataClient } from "./socrata"
import { DATASETS } from "@/lib/analysis/config"
import { buildBBLOrClause, rowToBBL } from "./bbl-utils"

const CHUNK_SIZE = 100
const CONCURRENCY = 5

export async function fetchHCRStabilizedBuildings(
  bbls: string[]
): Promise<Map<string, boolean>> {
  const client = getSocrataClient()
  const result = new Map<string, boolean>()

  const chunks: string[][] = []
  for (let i = 0; i < bbls.length; i += CHUNK_SIZE) {
    chunks.push(bbls.slice(i, i + CHUNK_SIZE))
  }

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const wave = chunks.slice(i, i + CONCURRENCY)
    const waveResults = await Promise.all(
      wave.map((chunk) => {
        const where = buildBBLOrClause(chunk)
        return client.fetchAll<Record<string, string>>("8y9c-t29b", {
          $where: where,
          $select: "boroid,block,lot",
          $limit: 10000,
        })
      })
    )
    for (const rows of waveResults) {
      for (const row of rows) {
        result.set(rowToBBL(row), true)
      }
    }
  }

  return result
}
