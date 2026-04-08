import { getSocrataClient } from "./socrata"
import { parseBBLParts } from "./bbl-utils"

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

function buildTaxLienOrClause(bbls: string[]): string {
  // Tax lien dataset has a direct `bbl` column (10-digit string)
  const inList = bbls.map((b) => `'${b}'`).join(",")
  return `bbl IN (${inList})`
}

/**
 * Returns a Set of BBLs that appear on the current tax lien sale list.
 */
export async function fetchTaxLienBBLs(bbls: string[]): Promise<Set<string>> {
  const client = getSocrataClient()
  const result = new Set<string>()

  const rows = await runChunked(bbls, CHUNK_SIZE, CONCURRENCY, (chunk) => {
    return client.fetchAll(DATASET, {
      $where: buildTaxLienOrClause(chunk),
      $select: "bbl",
    }) as Promise<Record<string, string>[]>
  })

  for (const row of rows) {
    if (row.bbl) result.add(row.bbl.replace(/\D/g, "").padStart(10, "0"))
  }

  return result
}
