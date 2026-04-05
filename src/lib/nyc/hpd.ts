import { getSocrataClient } from "./socrata"
import { DATASETS } from "@/lib/analysis/config"
import { buildBBLOrClause, rowToBBL } from "./bbl-utils"
import type { HPDData } from "@/types"

const CHUNK_SIZE = 100   // OR-condition queries are longer; use smaller chunks
const CONCURRENCY = 5    // parallel requests per wave

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
 * Fetch HPD registration data for a list of BBLs.
 */
export async function fetchHPDRegistrations(
  bbls: string[]
): Promise<Map<string, Partial<HPDData>>> {
  const client = getSocrataClient()
  const result = new Map<string, Partial<HPDData>>()

  const rows = await runChunked(bbls, CHUNK_SIZE, CONCURRENCY, (chunk) => {
    const where = buildBBLOrClause(chunk)
    return client.fetchAll(DATASETS.HPD_REGISTRATION, {
      $where: where,
      $select: "boroid,block,lot,registrationid,lastregistrationdate,registrationenddate",
    }) as Promise<Record<string, string>[]>
  })

  for (const row of rows) {
    const bbl = rowToBBL(row)
    if (!result.has(bbl)) {
      const endDate = row.registrationenddate
      const isActive = !endDate || new Date(endDate) > new Date()
      result.set(bbl, {
        bbl,
        totalUnits: null,
        buildingClass: null,
        registrationStatus: isActive ? "registered" : "lapsed",
        registrationId: row.registrationid ?? null,
      })
    }
  }

  return result
}

/**
 * Fetch violation counts (last 12 months) for a list of BBLs.
 */
export async function fetchHPDViolations(bbls: string[]): Promise<Map<string, number>> {
  const client = getSocrataClient()
  const result = new Map<string, number>()

  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  const cutoffStr = cutoff.toISOString().split("T")[0]

  const rows = await runChunked(bbls, CHUNK_SIZE, CONCURRENCY, (chunk) => {
    const bblClause = buildBBLOrClause(chunk)
    return client.fetchAll(DATASETS.HPD_VIOLATIONS, {
      $where: `(${bblClause}) AND novissueddate >= '${cutoffStr}'`,
      $select: "boroid,block,lot,violationid",
    }) as Promise<Record<string, string>[]>
  })

  for (const row of rows) {
    const bbl = rowToBBL(row)
    result.set(bbl, (result.get(bbl) ?? 0) + 1)
  }

  return result
}

/**
 * Fetch all HPD data for a list of BBLs and merge into HPDData records.
 */
export async function getHPDData(bbls: string[]): Promise<Map<string, HPDData>> {
  const now = new Date().toISOString()
  const [registrations, violations] = await Promise.all([
    fetchHPDRegistrations(bbls),
    fetchHPDViolations(bbls),
  ])

  const result = new Map<string, HPDData>()

  for (const bbl of bbls) {
    const reg = registrations.get(bbl) ?? {}
    result.set(bbl, {
      bbl,
      totalUnits: reg.totalUnits ?? null,
      buildingClass: reg.buildingClass ?? null,
      registrationStatus: reg.registrationStatus ?? null,
      registrationId: reg.registrationId ?? null,
      violationCount12mo: violations.get(bbl) ?? 0,
      evictionCount12mo: 0,  // populated later in pipeline via fetchEvictionCounts
      fetchedAt: now,
    })
  }

  return result
}
