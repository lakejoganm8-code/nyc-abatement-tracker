/**
 * HUD LIHTC (Low-Income Housing Tax Credit) — NYC properties
 *
 * Source: HUD LIHTC Public Use Database
 * Download: https://www.huduser.gov/portal/datasets/lihtc/lihtcpub.zip
 * Format: DBF file (LIHTCPUB.DBF) inside the ZIP
 *
 * No BBL in the dataset — we join by lat/lon proximity to our known BBLs
 * using the pluto_data table (which has lat/lng per BBL).
 * Threshold: ≤ 50 meters between LIHTC lat/lon and PLUTO centroid.
 *
 * Key fields:
 *   HUD_ID        — unique project identifier
 *   PROJECT       — project name
 *   PROJ_ADD      — street address
 *   PROJ_CTY      — city
 *   PROJ_ZIP      — zip
 *   N_UNITS       — total units
 *   LI_UNITS      — low-income units
 *   YR_PIS        — year placed in service
 *   YR_ALLOC      — year credit allocated
 *   LATITUDE / LONGITUDE
 *
 * Compliance period: 30 years from YR_PIS (15-yr initial + 15-yr extended use)
 */

import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const LIHTC_ZIP_URL = "https://www.huduser.gov/portal/datasets/lihtc/lihtcpub.zip"

// NYC city names in the PROJ_CTY field
const NYC_CITIES = new Set([
  "NEW YORK", "BRONX", "BROOKLYN", "STATEN ISLAND",
  "FLUSHING", "JAMAICA", "CORONA", "ASTORIA", "LONG ISLAND CITY",
  "JACKSON HEIGHTS", "ELMHURST", "RICHMOND HILL", "OZONE PARK",
  "BAYSIDE", "FRESH MEADOWS", "HOLLIS", "CAMBRIA HEIGHTS",
  "EAST NEW YORK", "FLATBUSH", "BEDFORD", "CANARSIE", "BUSHWICK",
  "RIDGEWOOD", "MASPETH", "WOODHAVEN", "REGO PARK", "FOREST HILLS",
  "KEW GARDENS", "SOUTH RICHMOND HILL", "SPRINGFIELD GARDENS",
  "FAR ROCKAWAY", "ROCKAWAY PARK", "ARVERNE", "HOWARD BEACH",
  "WHITESTONE", "COLLEGE POINT", "LITTLE NECK", "DOUGLAS MANOR",
  "PELHAM BAY", "THROGS NECK", "MORRIS PARK", "SOUNDVIEW",
  "HUNTS POINT", "MOTT HAVEN", "PORT MORRIS", "HIGHBRIDGE",
  "TREMONT", "MORRISANIA", "CLAREMONT VILLAGE",
])

export interface LIHTCRecord {
  bbl: string
  hud_id: string
  project_name: string | null
  n_units: number
  li_units: number
  yr_pis: number | null      // year placed in service
  yr_alloc: number | null    // year credit allocated
  compliance_end: number | null  // YR_PIS + 30
  latitude: number | null
  longitude: number | null
}

interface RawLIHTCRow {
  HUD_ID: string
  PROJECT: string
  PROJ_ADD: string
  PROJ_CTY: string
  PROJ_ST: string
  PROJ_ZIP: string
  N_UNITS: number | null
  LI_UNITS: number | null
  YR_PIS: number | null
  YR_ALLOC: number | null
  LATITUDE: number | null
  LONGITUDE: number | null
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

/**
 * Download LIHTC ZIP, extract DBF, parse NYC rows.
 */
async function downloadAndParseLIHTC(): Promise<RawLIHTCRow[]> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lihtc-"))
  const zipPath = path.join(tmpDir, "lihtcpub.zip")

  try {
    execSync(`curl -s --max-time 120 --retry 2 -o "${zipPath}" "${LIHTC_ZIP_URL}"`, { stdio: "pipe" })
    execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: "pipe" })

    // Parse DBF with Python (fastest approach)
    const script = `
import json, sys
from dbfread import DBF

cities = ${JSON.stringify([...NYC_CITIES])}
cities_set = set(cities)

table = DBF('${path.join(tmpDir, "LIHTCPUB.DBF")}', encoding='latin-1')
rows = []
for rec in table:
    r = dict(rec)
    if str(r.get('PROJ_ST') or '').strip().upper() != 'NY':
        continue
    city = str(r.get('PROJ_CTY') or '').strip().upper()
    if not any(c in city or city in c for c in cities_set):
        continue
    rows.append({
        'HUD_ID':    r.get('HUD_ID') or '',
        'PROJECT':   r.get('PROJECT') or '',
        'PROJ_ADD':  r.get('PROJ_ADD') or '',
        'PROJ_CTY':  r.get('PROJ_CTY') or '',
        'PROJ_ST':   r.get('PROJ_ST') or '',
        'PROJ_ZIP':  r.get('PROJ_ZIP') or '',
        'N_UNITS':   r.get('N_UNITS'),
        'LI_UNITS':  r.get('LI_UNITS'),
        'YR_PIS':    r.get('YR_PIS'),
        'YR_ALLOC':  r.get('YR_ALLOC'),
        'LATITUDE':  float(r['LATITUDE']) if r.get('LATITUDE') else None,
        'LONGITUDE': float(r['LONGITUDE']) if r.get('LONGITUDE') else None,
    })
print(json.dumps(rows))
`
    const scriptPath = path.join(tmpDir, "parse.py")
    fs.writeFileSync(scriptPath, script)
    const out = execSync(`python3 "${scriptPath}"`, { maxBuffer: 20 * 1024 * 1024 }).toString("utf8")
    return JSON.parse(out) as RawLIHTCRow[]
  } finally {
    execSync(`rm -rf "${tmpDir}"`, { stdio: "pipe" })
  }
}

/**
 * Fetch LIHTC data for NYC and match to BBLs via lat/lon proximity.
 * plutoCoords: map of bbl → { latitude, longitude }
 */
export async function fetchLIHTC(
  plutoCoords: Map<string, { latitude: number; longitude: number }>
): Promise<Map<string, LIHTCRecord>> {
  const result = new Map<string, LIHTCRecord>()

  let rows: RawLIHTCRow[]
  try {
    rows = await downloadAndParseLIHTC()
    console.log(`[lihtc] Downloaded ${rows.length} NYC LIHTC properties`)
  } catch (err) {
    console.warn(`[lihtc] Failed to download/parse: ${err}`)
    return result
  }

  // Build spatial index: bucket by ~0.01° grid cell for fast lookup
  const grid = new Map<string, Array<{ bbl: string; lat: number; lon: number }>>()
  for (const [bbl, coords] of plutoCoords) {
    const key = `${Math.round(coords.latitude * 100)},${Math.round(coords.longitude * 100)}`
    const bucket = grid.get(key) ?? []
    bucket.push({ bbl, lat: coords.latitude, lon: coords.longitude })
    grid.set(key, bucket)
  }

  let matched = 0
  for (const row of rows) {
    if (!row.LATITUDE || !row.LONGITUDE) continue

    // Search nearby grid cells (±1 cell ≈ ±110m)
    let bestBBL: string | null = null
    let bestDist = Infinity
    const gx = Math.round(row.LATITUDE * 100)
    const gy = Math.round(row.LONGITUDE * 100)

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${gx + dx},${gy + dy}`)
        if (!bucket) continue
        for (const candidate of bucket) {
          const dist = haversineMeters(row.LATITUDE, row.LONGITUDE, candidate.lat, candidate.lon)
          if (dist < bestDist) {
            bestDist = dist
            bestBBL = candidate.bbl
          }
        }
      }
    }

    // 50m threshold — tight enough to avoid false matches in dense NYC blocks
    if (bestBBL && bestDist <= 50) {
      const yrPis = row.YR_PIS ? Number(row.YR_PIS) : null
      result.set(bestBBL, {
        bbl:              bestBBL,
        hud_id:           row.HUD_ID,
        project_name:     row.PROJECT || null,
        n_units:          row.N_UNITS ? Number(row.N_UNITS) : 0,
        li_units:         row.LI_UNITS ? Number(row.LI_UNITS) : 0,
        yr_pis:           yrPis,
        yr_alloc:         row.YR_ALLOC ? Number(row.YR_ALLOC) : null,
        compliance_end:   yrPis ? yrPis + 30 : null,
        latitude:         row.LATITUDE,
        longitude:        row.LONGITUDE,
      })
      matched++
    }
  }

  console.log(`[lihtc] Matched ${matched} of ${rows.length} NYC LIHTC properties to BBLs`)
  return result
}
