import { getSocrataClient } from "./socrata"
import { parseBBLParts } from "./bbl-utils"

// DOB Violations — dataset 3h2n-5cm9
// Department of Buildings violation type, date, and resolution status.
// Open DOB violations = structural/safety/code issues = capital expenditure signal.
const DATASET = "3h2n-5cm9"

const CHUNK_SIZE = 100
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

function buildDOBOrClause(bbls: string[]): string {
  // DOB dataset stores block/lot as zero-padded strings (e.g. "00847", "00038")
  return bbls
    .map((b) => {
      const { boro, block, lot } = parseBBLParts(b)
      const blockPadded = block.padStart(5, "0")
      const lotPadded = lot.padStart(4, "0")
      return `(boro='${boro}' AND block='${blockPadded}' AND lot='${lotPadded}')`
    })
    .join(" OR ")
}

function dobRowToBBL(row: Record<string, string>): string {
  const boro = row.boro ?? "0"
  const block = (row.block ?? "0").padStart(5, "0")
  const lot = (row.lot ?? "0").padStart(4, "0")
  return `${boro}${block}${lot}`
}

/**
 * Returns a map of BBL → count of open DOB violations.
 * Only counts violations not marked as "RESOLVED".
 */
export async function fetchDOBViolationCounts(bbls: string[]): Promise<Map<string, number>> {
  const client = getSocrataClient()
  const result = new Map<string, number>()

  // Only count active violations (violation_category contains "ACTIVE" for open ones)
  const rows = await runChunked(bbls, CHUNK_SIZE, CONCURRENCY, (chunk) => {
    const where = buildDOBOrClause(chunk)
    return client.fetchAll(DATASET, {
      $where: `(${where}) AND violation_category LIKE '%ACTIVE%'`,
      $select: "boro,block,lot,violation_type_code",
    }) as Promise<Record<string, string>[]>
  })

  for (const row of rows) {
    const bbl = dobRowToBBL(row)
    result.set(bbl, (result.get(bbl) ?? 0) + 1)
  }

  return result
}
