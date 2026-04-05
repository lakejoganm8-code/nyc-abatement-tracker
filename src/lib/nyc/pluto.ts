import { getSocrataClient } from "./socrata"
import type { PLUTOData } from "@/types"

// MapPLUTO on NYC Open Data — zoning, FAR, year built, coordinates per lot
const PLUTO_DATASET = "64uk-42ks"
const CHUNK_SIZE = 200

interface RawPLUTO {
  bbl: string
  latitude: string
  longitude: string
  zonedist1: string
  builtfar: string
  lotarea: string
  yearbuilt: string
  nta: string         // Neighborhood Tabulation Area name
  address: string
}

/**
 * Fetch PLUTO data (coordinates, zoning, FAR, year built) for a list of BBLs.
 * Returns a map of BBL → PLUTOData.
 */
export async function fetchPLUTOData(bbls: string[]): Promise<Map<string, PLUTOData>> {
  const client = getSocrataClient()
  const result = new Map<string, PLUTOData>()
  const now = new Date().toISOString()

  for (let i = 0; i < bbls.length; i += CHUNK_SIZE) {
    const chunk = bbls.slice(i, i + CHUNK_SIZE)
    // PLUTO stores BBL as a numeric string without leading zeros on block/lot
    const bblList = chunk.map((b) => `'${normalizeBBLForPLUTO(b)}'`).join(",")

    const rows = await client.fetchAll<RawPLUTO>(PLUTO_DATASET, {
      $where: `bbl IN (${bblList})`,
      $select: "bbl,latitude,longitude,zonedist1,builtfar,lotarea,yearbuilt,nta",
    })

    for (const row of rows) {
      const bbl = padBBL(row.bbl)
      result.set(bbl, {
        bbl,
        zoning: row.zonedist1 ?? null,
        far: row.builtfar ? parseFloat(row.builtfar) : null,
        lotArea: row.lotarea ? parseInt(row.lotarea) : null,
        yearBuilt: row.yearbuilt ? parseInt(row.yearbuilt) : null,
        neighborhood: row.nta ?? null,
        latitude: row.latitude ? parseFloat(row.latitude) : null,
        longitude: row.longitude ? parseFloat(row.longitude) : null,
        fetchedAt: now,
      } as PLUTOData & { latitude: number | null; longitude: number | null })
    }
  }

  return result
}

// PLUTO stores BBL as a 10-digit number (boro1 + block5 + lot4), no leading zeros on lot
function normalizeBBLForPLUTO(bbl: string): string {
  return bbl.replace(/\D/g, "").padStart(10, "0")
}

// Ensure BBL is always 10-digit padded
function padBBL(bbl: string): string {
  return bbl.replace(/\D/g, "").padStart(10, "0")
}
