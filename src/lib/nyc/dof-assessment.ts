import { getSocrataClient } from "./socrata"
import { parseBBLParts } from "./bbl-utils"

// DOF Property Valuation and Assessment — dataset 8y4t-faws
// Contains actual DOF market value estimates per property.
// Better than assessed_value / 0.45 approximation for LTV scoring.
const DATASET = "8y4t-faws"

const CHUNK_SIZE = 200
const CONCURRENCY = 5

async function runChunked<T>(
  items: string[],
  chunkSize: number,
  concurrency: number,
  fn: (chunk: string[]) => Promise<T[]>
): Promise<T[]> {
  const chunks: string[][] = []
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize))
  }
  const results: T[] = []
  for (let i = 0; i < chunks.length; i += concurrency) {
    const wave = chunks.slice(i, i + concurrency)
    const waveResults = await Promise.all(wave.map(fn))
    for (const r of waveResults) results.push(...r)
  }
  return results
}

/**
 * Returns a map of BBL → DOF market value estimate (in dollars).
 */
export async function fetchDOFMarketValues(bbls: string[]): Promise<Map<string, number>> {
  const client = getSocrataClient()
  const result = new Map<string, number>()

  // Dataset uses boro/block/lot (not borocode), market value is pymkttot
  const rows = await runChunked(bbls, CHUNK_SIZE, CONCURRENCY, (chunk) => {
    const where = chunk
      .map((b) => {
        const { boro, block, lot } = parseBBLParts(b)
        return `(boro='${boro}' AND block='${block}' AND lot='${lot}')`
      })
      .join(" OR ")
    return client.fetchAll(DATASET, {
      $where: where,
      $select: "boro,block,lot,pymkttot",
    }) as Promise<Record<string, string>[]>
  })

  for (const row of rows) {
    const boro = row.boro ?? "0"
    const block = (row.block ?? "0").padStart(5, "0")
    const lot = (row.lot ?? "0").padStart(4, "0")
    const bbl = `${boro}${block}${lot}`
    const val = parseInt(row.pymkttot ?? "0", 10)
    if (val > 0) result.set(bbl, val)
  }

  return result
}
