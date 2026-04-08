// NY DOS Corporation Search — Active Corporations dataset (open.ny.gov)
// Dataset: w7hz-rri8 (NY Open Data, not NYC)
// Contains entity name, DOS ID, status, registered agent, date of formation.
// We match against owner_name from ACRIS to enrich LLC-owned properties.

const NY_OPEN_DATA_BASE = "https://data.ny.gov/resource"
const DATASET = "hn44-r3ic"  // Active Corporations and Business Entities

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

    // Build OR clause for entity_name
    const orClause = chunk
      .map((n) => `entity_name='${n.replace(/'/g, "''")}'`)
      .join(" OR ")

    try {
      const url = new URL(`${NY_OPEN_DATA_BASE}/${DATASET}.json`)
      url.searchParams.set("$where", orClause)
      url.searchParams.set("$select", "entity_name,dos_id,entity_status,initial_dos_filing_date,agent_name,agent_address")
      url.searchParams.set("$limit", "200")

      const appToken = process.env.NYC_OPEN_DATA_APP_TOKEN ?? ""
      const headers: Record<string, string> = { "Accept": "application/json" }
      if (appToken) headers["X-App-Token"] = appToken

      const res = await fetch(url.toString(), { headers })
      if (!res.ok) continue

      const rows = await res.json() as Record<string, string>[]

      // Match rows back to BBLs by entity_name
      const byName = new Map<string, Record<string, string>>()
      for (const row of rows) {
        const name = (row.entity_name ?? "").trim().toUpperCase()
        // Keep active records; prefer active over dissolved
        const existing = byName.get(name)
        if (!existing || (row.entity_status ?? "").toUpperCase() === "ACTIVE") {
          byName.set(name, row)
        }
      }

      for (const name of chunk) {
        const row = byName.get(name)
        const bbls = nameToBBLs.get(name) ?? []
        for (const bbl of bbls) {
          result.set(bbl, {
            bbl,
            entityName: row?.entity_name ?? null,
            dosId: row?.dos_id ?? null,
            entityStatus: row?.entity_status ?? null,
            dateOfFormation: row?.initial_dos_filing_date ?? null,
            registeredAgentName: row?.agent_name ?? null,
            registeredAgentAddress: row?.agent_address ?? null,
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
