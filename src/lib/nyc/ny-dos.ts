// NY DOS Corporation Search — Active Corporations dataset (open.ny.gov)
// Dataset: n9v6-gdp6 "Active Corporations: Beginning 1800" (NY Open Data, not NYC)
// Contains entity name, DOS ID, registered agent address, date of formation.
// All records in this dataset are active (no entity_status field needed).
// We match against owner_name from ACRIS to enrich LLC-owned properties.

const NY_OPEN_DATA_BASE = "https://data.ny.gov/resource"
const DATASET = "n9v6-gdp6"  // Active Corporations: Beginning 1800

export interface DOSEntityInfo {
  bbl: string
  entityName: string | null
  dosId: string | null
  entityStatus: string | null
  dateOfFormation: string | null
  registeredAgentName: string | null
  registeredAgentAddress: string | null
  dosSearchUrl: string | null
}

function isLLCName(name: string | null): boolean {
  if (!name) return false
  const upper = name.toUpperCase()
  return upper.includes(" LLC") || upper.includes(" L.L.C") || upper.includes(" LP ") ||
    upper.includes(" L.P") || upper.includes(" INC") || upper.includes(" CORP") ||
    upper.includes(" REALTY") || upper.includes(" MGMT") || upper.includes(" ASSOC")
}

function buildDOSSearchUrl(entityName: string): string {
  const encoded = encodeURIComponent(entityName)
  return `https://apps.dos.ny.gov/publicInquiry/EntitySearch?searchType=EntityName&searchName=${encoded}`
}

/**
 * Lookup NY DOS entity information for a list of owner names.
 * Returns a map of bbl → DOSEntityInfo.
 * ownersByBBL: map of bbl → owner_name (from ACRIS).
 */
export async function fetchDOSEntityInfo(
  ownersByBBL: Map<string, string>
): Promise<Map<string, DOSEntityInfo>> {
  const result = new Map<string, DOSEntityInfo>()

  // Only process LLC/corp-style names
  const llcEntries = Array.from(ownersByBBL.entries())
    .filter(([, name]) => isLLCName(name))

  if (llcEntries.length === 0) return result

  // Batch entity name lookups — chunk by 20 unique names per request
  // Build a reverse map: normalized name → list of BBLs
  const nameToBBLs = new Map<string, string[]>()
  for (const [bbl, name] of llcEntries) {
    const normalized = name.trim().toUpperCase()
    const existing = nameToBBLs.get(normalized) ?? []
    existing.push(bbl)
    nameToBBLs.set(normalized, existing)
  }

  const uniqueNames = Array.from(nameToBBLs.keys())
  const CHUNK = 10

  for (let i = 0; i < uniqueNames.length; i += CHUNK) {
    const chunk = uniqueNames.slice(i, i + CHUNK)

    // Build OR clause for current_entity_name
    const orClause = chunk
      .map((n) => `current_entity_name='${n.replace(/'/g, "''")}'`)
      .join(" OR ")

    try {
      const url = new URL(`${NY_OPEN_DATA_BASE}/${DATASET}.json`)
      url.searchParams.set("$where", orClause)
      url.searchParams.set("$select", "current_entity_name,dos_id,initial_dos_filing_date,dos_process_name,dos_process_address_1,dos_process_city,dos_process_state,dos_process_zip")
      url.searchParams.set("$limit", "200")

      const appToken = process.env.NYC_OPEN_DATA_APP_TOKEN ?? ""
      const headers: Record<string, string> = { "Accept": "application/json" }
      if (appToken) headers["X-App-Token"] = appToken

      const res = await fetch(url.toString(), { headers })
      if (!res.ok) continue

      const rows = await res.json() as Record<string, string>[]

      // Match rows back to BBLs by current_entity_name
      const byName = new Map<string, Record<string, string>>()
      for (const row of rows) {
        const name = (row.current_entity_name ?? "").trim().toUpperCase()
        if (!byName.has(name)) byName.set(name, row)
      }

      for (const name of chunk) {
        const row = byName.get(name)
        const bbls = nameToBBLs.get(name) ?? []
        // Build agent address from components
        const agentAddr = row
          ? [row.dos_process_address_1, row.dos_process_city, row.dos_process_state, row.dos_process_zip]
              .filter(Boolean).join(", ")
          : null
        for (const bbl of bbls) {
          result.set(bbl, {
            bbl,
            entityName: row?.current_entity_name ?? null,
            dosId: row?.dos_id ?? null,
            entityStatus: row ? "ACTIVE" : null,
            dateOfFormation: row?.initial_dos_filing_date ?? null,
            registeredAgentName: row?.dos_process_name ?? null,
            registeredAgentAddress: agentAddr || null,
            dosSearchUrl: buildDOSSearchUrl(name),
          })
        }
      }
    } catch {
      // Non-fatal — DOS lookup is best-effort
      continue
    }
  }

  // For BBLs with LLC names but no DOS match, still return the search URL
  for (const [bbl, name] of llcEntries) {
    if (!result.has(bbl)) {
      result.set(bbl, {
        bbl,
        entityName: null,
        dosId: null,
        entityStatus: null,
        dateOfFormation: null,
        registeredAgentName: null,
        registeredAgentAddress: null,
        dosSearchUrl: buildDOSSearchUrl(name),
      })
    }
  }

  return result
}
