import { getSocrataClient } from "./socrata"
import { parseBBLParts } from "./bbl-utils"

// NYC Housing Court Litigations — dataset 59kj-x8nc
// HP actions (tenant-filed) and nonpayment proceedings (landlord-filed).
// HP actions = tenants suing landlord for conditions; nonpayment = rent collection problems.
const DATASET = "59kj-x8nc"

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

function buildHCOrClause(bbls: string[]): string {
  // Housing court dataset uses boroid, block, lot
  return bbls
    .map((b) => {
      const { boro, block, lot } = parseBBLParts(b)
      return `(boroid='${boro}' AND block='${block}' AND lot='${lot}')`
    })
    .join(" OR ")
}

function hcRowToBBL(row: Record<string, string>): string {
  const boro = row.boroid ?? "0"
  const block = (row.block ?? "0").padStart(5, "0")
  const lot = (row.lot ?? "0").padStart(4, "0")
  return `${boro}${block}${lot}`
}

export interface HousingCourtCounts {
  hpActions: number
  nonpaymentCases: number
}

/**
 * Returns a map of BBL → housing court case counts for the last 12 months.
 */
export async function fetchHousingCourtCounts(bbls: string[]): Promise<Map<string, HousingCourtCounts>> {
  const client = getSocrataClient()
  const hpResult = new Map<string, number>()
  const npResult = new Map<string, number>()

  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  const cutoffStr = cutoff.toISOString().split("T")[0]

  const rows = await runChunked(bbls, CHUNK_SIZE, CONCURRENCY, (chunk) => {
    const where = buildHCOrClause(chunk)
    return client.fetchAll(DATASET, {
      $where: `(${where}) AND caseopendate >= '${cutoffStr}'`,
      $select: "boroid,block,lot,casetype,caseopendate",
    }) as Promise<Record<string, string>[]>
  })

  for (const row of rows) {
    const bbl = hcRowToBBL(row)
    const caseType = (row.casetype ?? "").toLowerCase()

    if (caseType.includes("hp") || caseType.includes("housing part") || caseType.includes("tenant")) {
      hpResult.set(bbl, (hpResult.get(bbl) ?? 0) + 1)
    } else if (caseType.includes("nonpayment") || caseType.includes("non-payment") || caseType.includes("holdover")) {
      npResult.set(bbl, (npResult.get(bbl) ?? 0) + 1)
    }
  }

  const result = new Map<string, HousingCourtCounts>()
  const allBBLs = new Set([...hpResult.keys(), ...npResult.keys()])
  for (const bbl of allBBLs) {
    result.set(bbl, {
      hpActions: hpResult.get(bbl) ?? 0,
      nonpaymentCases: npResult.get(bbl) ?? 0,
    })
  }

  return result
}
