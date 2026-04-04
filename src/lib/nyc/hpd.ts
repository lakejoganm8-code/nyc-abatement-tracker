import { getSocrataClient } from "./socrata"
import { DATASETS } from "@/lib/analysis/config"
import type { HPDData } from "@/types"

const CHUNK_SIZE = 200  // max BBLs per IN clause to avoid URL length limits

/**
 * Fetch HPD registration data (unit counts, building class, registration status)
 * for a list of BBLs. Returns a map of BBL → HPDData.
 */
export async function fetchHPDRegistrations(
  bbls: string[]
): Promise<Map<string, Partial<HPDData>>> {
  const client = getSocrataClient()
  const result = new Map<string, Partial<HPDData>>()

  for (let i = 0; i < bbls.length; i += CHUNK_SIZE) {
    const chunk = bbls.slice(i, i + CHUNK_SIZE)
    const bblList = chunk.map((b) => `'${formatBBLForHPD(b)}'`).join(",")

    const rows = await client.fetchAll(DATASETS.HPD_REGISTRATION, {
      $where: `boroid||block||lot IN (${bblList})`,
      $select: "boroid,block,lot,totalunits,bldgclass,registrationid,lastregistrationdate",
    })

    for (const row of rows as Record<string, string>[]) {
      const bbl = `${row.boroid}${row.block?.padStart(5, "0")}${row.lot?.padStart(4, "0")}`
      if (!result.has(bbl)) {
        result.set(bbl, {
          bbl,
          totalUnits: parseInt(row.totalunits ?? "0") || null,
          buildingClass: row.bldgclass ?? null,
          registrationStatus: row.lastregistrationdate ? "registered" : "unregistered",
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

  // Calculate cutoff date 12 months ago
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  const cutoffStr = cutoff.toISOString().split("T")[0]

  for (let i = 0; i < bbls.length; i += CHUNK_SIZE) {
    const chunk = bbls.slice(i, i + CHUNK_SIZE)
    const bblList = chunk.map((b) => `'${formatBBLForHPD(b)}'`).join(",")

    const rows = await client.fetchAll(DATASETS.HPD_VIOLATIONS, {
      $where: `boroid||block||lot IN (${bblList}) AND inspectiondate >= '${cutoffStr}'`,
      $select: "boroid,block,lot,violationid",
    })

    for (const row of rows as Record<string, string>[]) {
      const bbl = `${row.boroid}${row.block?.padStart(5, "0")}${row.lot?.padStart(4, "0")}`
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
  const allBBLs = new Set([...registrations.keys(), ...violations.keys(), ...bbls])

  for (const bbl of allBBLs) {
    const reg = registrations.get(bbl) ?? {}
    result.set(bbl, {
      bbl,
      totalUnits: reg.totalUnits ?? null,
      buildingClass: reg.buildingClass ?? null,
      registrationStatus: reg.registrationStatus ?? null,
      violationCount12mo: violations.get(bbl) ?? 0,
      fetchedAt: now,
    })
  }

  return result
}

/** HPD uses boroid+block+lot as a concatenated string in some fields */
function formatBBLForHPD(bbl: string): string {
  const clean = bbl.replace(/\D/g, "").padStart(10, "0")
  return clean  // 10-digit concatenated BBL
}
