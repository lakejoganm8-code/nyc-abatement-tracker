import { getSocrataClient } from "./socrata"
import { DATASETS } from "@/lib/analysis/config"
import { buildBBLOrClause, rowToBBL } from "./bbl-utils"
import type { HPDData } from "@/types"

const CHUNK_SIZE = 100  // OR-condition queries are longer; use smaller chunks

/**
 * Fetch HPD registration data for a list of BBLs.
 * Returns registration status per BBL.
 */
export async function fetchHPDRegistrations(
  bbls: string[]
): Promise<Map<string, Partial<HPDData>>> {
  const client = getSocrataClient()
  const result = new Map<string, Partial<HPDData>>()

  for (let i = 0; i < bbls.length; i += CHUNK_SIZE) {
    const chunk = bbls.slice(i, i + CHUNK_SIZE)
    const where = buildBBLOrClause(chunk)

    const rows = await client.fetchAll(DATASETS.HPD_REGISTRATION, {
      $where: where,
      $select: "boroid,block,lot,registrationid,lastregistrationdate,registrationenddate",
    })

    for (const row of rows as Record<string, string>[]) {
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
  }

  return result
}

/**
 * Fetch violation counts (last 12 months) for a list of BBLs.
 * Returns a map of BBL → violation count.
 */
export async function fetchHPDViolations(bbls: string[]): Promise<Map<string, number>> {
  const client = getSocrataClient()
  const result = new Map<string, number>()

  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  const cutoffStr = cutoff.toISOString().split("T")[0]

  for (let i = 0; i < bbls.length; i += CHUNK_SIZE) {
    const chunk = bbls.slice(i, i + CHUNK_SIZE)
    const bblClause = buildBBLOrClause(chunk)

    const rows = await client.fetchAll(DATASETS.HPD_VIOLATIONS, {
      $where: `(${bblClause}) AND novissueddate >= '${cutoffStr}'`,
      $select: "boroid,block,lot,violationid",
    })

    for (const row of rows as Record<string, string>[]) {
      const bbl = rowToBBL(row)
      result.set(bbl, (result.get(bbl) ?? 0) + 1)
    }
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
