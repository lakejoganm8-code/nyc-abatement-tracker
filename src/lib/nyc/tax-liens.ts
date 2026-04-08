import { getSocrataClient } from "./socrata"
import { parseBBLParts, buildACRISOrClause } from "./bbl-utils"

// NYC Tax Lien Sale List — dataset 9rz4-mjek
// Properties with unpaid property tax or water/sewer liens eligible for NYC tax lien sale.
// A property on this list has extreme financial distress.
const DATASET = "9rz4-mjek"

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
 * Returns a Set of BBLs that appear on the current tax lien sale list.
 * Dataset uses borough/block/lot columns (same layout as ACRIS).
 */
export async function fetchTaxLienBBLs(bbls: string[]): Promise<Set<string>> {
  const client = getSocrataClient()
  const result = new Set<string>()

  const rows = await runChunked(bbls, CHUNK_SIZE, CONCURRENCY, (chunk) => {
    const where = buildACRISOrClause(chunk)  // borough/block/lot
    return client.fetchAll(DATASET, {
      $where: where,
      $select: "borough,block,lot",
    }) as Promise<Record<string, string>[]>
  })

  for (const row of rows) {
    const boro = row.borough ?? "0"
    const block = (row.block ?? "0").padStart(5, "0")
    const lot = (row.lot ?? "0").padStart(4, "0")
    result.add(`${boro}${block}${lot}`)
  }

  return result
}
