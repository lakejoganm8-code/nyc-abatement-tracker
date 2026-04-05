import { getSocrataClient } from "./socrata"
import type { PLUTOData } from "@/types"

// MapPLUTO on NYC Open Data — zoning, FAR, year built, coordinates per lot
const PLUTO_DATASET = "64uk-42ks"
const CHUNK_SIZE = 200
const CONCURRENCY = 5

interface RawPLUTO {
  bbl: string
  latitude: string
  longitude: string
  zonedist1: string
  builtfar: string
  lotarea: string
  yearbuilt: string
  address: string
  unitstotal: string
}

/**
 * Fetch PLUTO data for a list of BBLs.
 * For condo unit BBLs (lot ≥ 1001) that have no PLUTO record, falls back to
 * the parent lot (same boro+block, lot=0001) to get the building address.
 */
export async function fetchPLUTOData(bbls: string[]): Promise<Map<string, PLUTOData>> {
  const client = getSocrataClient()
  const result = new Map<string, PLUTOData>()
  const now = new Date().toISOString()

  const chunks: string[][] = []
  for (let i = 0; i < bbls.length; i += CHUNK_SIZE) {
    chunks.push(bbls.slice(i, i + CHUNK_SIZE))
  }

  // Fetch PLUTO in concurrent waves
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const wave = chunks.slice(i, i + CONCURRENCY)
    const waveResults = await Promise.all(
      wave.map((chunk) => {
        const bblList = chunk.map((b) => `'${normalizeBBLForPLUTO(b)}'`).join(",")
        return client.fetchAll<RawPLUTO>(PLUTO_DATASET, {
          $where: `bbl IN (${bblList})`,
          $select: "bbl,latitude,longitude,zonedist1,builtfar,lotarea,yearbuilt,address,unitstotal",
        })
      })
    )
    for (const rows of waveResults) {
      for (const row of rows) {
        const bbl = padBBL(row.bbl)
        result.set(bbl, rowToPluto(bbl, row, now))
      }
    }
  }

  // For condo BBLs (lot ≥ 1001) with no PLUTO record, try the parent lot (lot 0001)
  // to get building address, zoning, year built, etc.
  const missingCondoBBLs = bbls.filter((b) => !result.has(b) && isCondoBBL(b))
  if (missingCondoBBLs.length > 0) {
    // Map parent lot BBL → list of condo BBLs that should inherit it
    const parentToCondos = new Map<string, string[]>()
    for (const bbl of missingCondoBBLs) {
      const parent = getParentLot(bbl)
      if (!parentToCondos.has(parent)) parentToCondos.set(parent, [])
      parentToCondos.get(parent)!.push(bbl)
    }

    const parentBBLs = [...parentToCondos.keys()]
    const parentChunks: string[][] = []
    for (let i = 0; i < parentBBLs.length; i += CHUNK_SIZE) {
      parentChunks.push(parentBBLs.slice(i, i + CHUNK_SIZE))
    }

    for (let i = 0; i < parentChunks.length; i += CONCURRENCY) {
      const wave = parentChunks.slice(i, i + CONCURRENCY)
      const waveResults = await Promise.all(
        wave.map((chunk) => {
          const bblList = chunk.map((b) => `'${normalizeBBLForPLUTO(b)}'`).join(",")
          return client.fetchAll<RawPLUTO>(PLUTO_DATASET, {
            $where: `bbl IN (${bblList})`,
            $select: "bbl,latitude,longitude,zonedist1,builtfar,lotarea,yearbuilt,address,unitstotal",
          })
        })
      )
      for (const rows of waveResults) {
        for (const row of rows) {
          const parentBBL = padBBL(row.bbl)
          const condos = parentToCondos.get(parentBBL) ?? []
          for (const condoBBL of condos) {
            // Inherit building-level data; keep the condo's own BBL
            result.set(condoBBL, rowToPluto(condoBBL, row, now))
          }
        }
      }
    }
  }

  return result
}

function rowToPluto(bbl: string, row: RawPLUTO, now: string): PLUTOData {
  return {
    bbl,
    zoning: row.zonedist1 ?? null,
    far: row.builtfar ? parseFloat(row.builtfar) : null,
    lotArea: row.lotarea ? parseInt(row.lotarea) : null,
    yearBuilt: row.yearbuilt ? parseInt(row.yearbuilt) : null,
    neighborhood: null,
    latitude: row.latitude ? parseFloat(row.latitude) : null,
    longitude: row.longitude ? parseFloat(row.longitude) : null,
    address: row.address ?? null,
    totalUnits: row.unitstotal ? parseInt(row.unitstotal) : null,
    fetchedAt: now,
  }
}

/** Condo unit BBLs have lot ≥ 1001 */
function isCondoBBL(bbl: string): boolean {
  return parseInt(bbl.slice(6), 10) >= 1001
}

/** Parent lot: same boro+block, lot = 0001 */
function getParentLot(bbl: string): string {
  return bbl.slice(0, 6) + "0001"
}

function normalizeBBLForPLUTO(bbl: string): string {
  return bbl.replace(/\D/g, "").padStart(10, "0")
}

function padBBL(rawBbl: string): string {
  const digits = rawBbl.replace(/\D/g, "")
  return digits.length > 10 ? digits.slice(0, 10) : digits.padStart(10, "0")
}
