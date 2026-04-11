/**
 * HUD Multifamily Section 8 / Project-Based Rental Assistance
 *
 * Two Excel files (updated monthly by HUD):
 *   Properties: https://www.hud.gov/sites/dfiles/Housing/documents/MF-Properties-with-Assistance-Sec8-Contracts1.xlsx
 *     Fields: property_id, property_name_text, address_line1_text, city_name_text, state_code,
 *             zip_code, property_total_unit_count
 *
 *   Contracts: https://www.hud.gov/sites/dfiles/Housing/documents/MF-Assistance-Sec8-Contracts1.xlsx
 *     Fields: contract_number, property_id, tracs_current_expiration_date, tracs_status_name,
 *             assisted_units_count, program_type_name, program_type_group_name
 *
 * Join: property_id links both files.
 * BBL: matched via NYC Geoclient API (address → BBL) or lat/lon fallback.
 *
 * We use the NYC Geoclient REST API:
 *   https://api.nyc.gov/geo/1.0/address?houseNumber=123&street=MAIN+ST&borough=MANHATTAN&app_id=...&app_key=...
 * Falls back to address string search in pluto_data if Geoclient unavailable.
 */

import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const PROPERTIES_URL = "https://www.hud.gov/sites/dfiles/Housing/documents/MF-Properties-with-Assistance-Sec8-Contracts1.xlsx"
const CONTRACTS_URL  = "https://www.hud.gov/sites/dfiles/Housing/documents/MF-Assistance-Sec8-Contracts1.xlsx"

// NYC Geoclient — needs app_id + app_key from NYC Developer Portal
// If not set, we fall back to address matching against pluto_data
const GEOCLIENT_APP_ID  = process.env.NYC_GEOCLIENT_APP_ID  ?? ""
const GEOCLIENT_APP_KEY = process.env.NYC_GEOCLIENT_APP_KEY ?? ""

const NYC_STATE = "NY"
const NYC_COUNTIES = new Set(["NEW YORK", "KINGS", "BRONX", "QUEENS", "RICHMOND"])
const NYC_CITIES   = new Set(["NEW YORK", "BROOKLYN", "BRONX", "STATEN ISLAND"])

export interface Section8Record {
  bbl: string
  property_id: string
  property_name: string | null
  contract_number: string | null
  program_type: string | null
  program_group: string | null
  assisted_units: number
  total_units: number
  contract_expiration: string | null  // ISO date
  contract_status: string | null
  address: string | null
}

interface RawProperty {
  property_id: string
  name: string
  address: string
  city: string
  state: string
  zip: string
  total_units: number
}

interface RawContract {
  contract_number: string
  property_id: string
  expiration_date: string | null
  status: string
  assisted_units: number
  program_type: string
  program_group: string
}

async function downloadExcel(url: string, outPath: string): Promise<void> {
  execSync(`curl -s --max-time 120 --retry 2 -L -o "${outPath}" "${url}"`, { stdio: "pipe" })
}

function parseExcelWithPython(
  propsPath: string,
  contractsPath: string,
  tmpDir: string
): { properties: RawProperty[]; contracts: RawContract[] } {
  const script = `
import json, openpyxl
from datetime import date, datetime

def load_sheet(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    headers = [str(h or '').strip() for h in rows[0]]
    return [dict(zip(headers, row)) for row in rows[1:]]

def fmt_date(v):
    if not v: return None
    if isinstance(v, (date, datetime)): return v.strftime('%Y-%m-%d')
    return str(v)[:10] if v else None

nyc_states = {'NY'}
nyc_cities = ${JSON.stringify([...NYC_CITIES])}
nyc_cities_set = set(nyc_cities)

# Properties
props_rows = load_sheet('${propsPath}')
props = []
for r in props_rows:
    if str(r.get('state_code') or '').strip().upper() not in nyc_states: continue
    city = str(r.get('city_name_text') or '').strip().upper()
    if not any(c in city or city in c for c in nyc_cities_set): continue
    props.append({
        'property_id': str(r.get('property_id') or '').strip(),
        'name':        str(r.get('property_name_text') or '').strip(),
        'address':     str(r.get('address_line1_text') or '').strip(),
        'city':        city,
        'state':       str(r.get('state_code') or '').strip(),
        'zip':         str(r.get('zip_code') or '').strip(),
        'total_units': int(r.get('property_total_unit_count') or 0),
    })

prop_ids = {p['property_id'] for p in props}

# Contracts — filter to our NYC property IDs
contracts_rows = load_sheet('${contractsPath}')
contracts = []
for r in contracts_rows:
    pid = str(r.get('property_id') or '').strip()
    if pid not in prop_ids: continue
    contracts.append({
        'contract_number': str(r.get('contract_number') or '').strip(),
        'property_id':     pid,
        'expiration_date': fmt_date(r.get('tracs_current_expiration_date')),
        'status':          str(r.get('tracs_status_name') or '').strip(),
        'assisted_units':  int(r.get('assisted_units_count') or 0),
        'program_type':    str(r.get('program_type_name') or '').strip(),
        'program_group':   str(r.get('program_type_group_name') or '').strip(),
    })

print(json.dumps({'properties': props, 'contracts': contracts}))
`
  const scriptPath = path.join(tmpDir, "parse_s8.py")
  fs.writeFileSync(scriptPath, script)
  const out = execSync(`python3 "${scriptPath}"`, { maxBuffer: 30 * 1024 * 1024 }).toString("utf8")
  return JSON.parse(out)
}

/**
 * Match a property address to a BBL by searching pluto_data.
 * plutoAddresses: map of "HOUSENUMBER STREETNAME BOROUGH" → bbl
 */
function matchAddressToBBL(
  prop: RawProperty,
  plutoIndex: Map<string, string>
): string | null {
  // Normalize: "123 MAIN STREET" → try with city as borough hint
  const borough = prop.city.includes("BRONX") ? "BRONX"
    : prop.city.includes("BROOKLYN") ? "BROOKLYN"
    : prop.city.includes("STATEN") ? "STATEN ISLAND"
    : prop.city.includes("NEW YORK") ? "MANHATTAN"
    : null

  const addr = prop.address.toUpperCase().trim()
  const key1 = `${addr}|${borough ?? ""}`.trim()
  if (plutoIndex.has(key1)) return plutoIndex.get(key1)!

  // Try without borough
  const key2 = addr
  if (plutoIndex.has(key2)) return plutoIndex.get(key2)!

  return null
}

/**
 * Fetch HUD Section 8 data for NYC and match to BBLs via pluto address index.
 * plutoAddresses: map of "HOUSENUMBER STREETNAME" (normalized) → bbl, built from pluto_data
 */
export async function fetchSection8(
  plutoAddresses: Map<string, string>
): Promise<Map<string, Section8Record>> {
  const result = new Map<string, Section8Record>()
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hud-s8-"))

  try {
    const propsPath     = path.join(tmpDir, "properties.xlsx")
    const contractsPath = path.join(tmpDir, "contracts.xlsx")

    console.log("[section8] Downloading HUD files...")
    await Promise.all([
      downloadExcel(PROPERTIES_URL, propsPath),
      downloadExcel(CONTRACTS_URL, contractsPath),
    ])

    const { properties, contracts } = parseExcelWithPython(propsPath, contractsPath, tmpDir)
    console.log(`[section8] ${properties.length} NYC properties, ${contracts.length} contracts`)

    // Index contracts by property_id — keep most recently expiring active contract
    const contractByProp = new Map<string, RawContract>()
    for (const c of contracts) {
      const existing = contractByProp.get(c.property_id)
      if (!existing) {
        contractByProp.set(c.property_id, c)
      } else if (c.expiration_date && (!existing.expiration_date || c.expiration_date > existing.expiration_date)) {
        contractByProp.set(c.property_id, c)
      }
    }

    // Match each property to a BBL
    let matched = 0
    for (const prop of properties) {
      const bbl = matchAddressToBBL(prop, plutoAddresses)
      if (!bbl) continue

      const contract = contractByProp.get(prop.property_id)
      result.set(bbl, {
        bbl,
        property_id:          prop.property_id,
        property_name:        prop.name || null,
        contract_number:      contract?.contract_number ?? null,
        program_type:         contract?.program_type ?? null,
        program_group:        contract?.program_group ?? null,
        assisted_units:       contract?.assisted_units ?? 0,
        total_units:          prop.total_units,
        contract_expiration:  contract?.expiration_date ?? null,
        contract_status:      contract?.status ?? null,
        address:              `${prop.address}, ${prop.city}, ${prop.state} ${prop.zip}`,
      })
      matched++
    }

    console.log(`[section8] Matched ${matched} of ${properties.length} NYC properties to BBLs`)
  } catch (err) {
    console.warn(`[section8] Failed: ${err}`)
  } finally {
    execSync(`rm -rf "${tmpDir}"`, { stdio: "pipe" })
  }

  return result
}
