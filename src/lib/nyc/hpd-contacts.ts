import { getSocrataClient } from "./socrata"

// HPD Registration Contacts — dataset feu5-w2e2
// Provides owner name, owner phone, managing agent name/phone/address for HPD-registered buildings.
// Join: registration_id (stored in hpd_data.registration_id)
const DATASET = "feu5-w2e2"

export interface HPDContact {
  bbl: string
  registrationId: string
  ownerName: string | null
  ownerType: string | null
  ownerPhone: string | null
  ownerMailingAddress: string | null
  agentName: string | null
  agentPhone: string | null
  agentAddress: string | null
}

/**
 * Fetch HPD registration contacts for the given registration IDs.
 * Returns a map of bbl → HPDContact (one record per building).
 * registrationIds is a map of registrationId → bbl (from hpd_data).
 */
export async function fetchHPDContacts(
  registrationIdToBBL: Map<string, string>
): Promise<Map<string, HPDContact>> {
  if (registrationIdToBBL.size === 0) return new Map()

  const client = getSocrataClient()
  const result = new Map<string, HPDContact>()

  // Initialize result map with empty contacts for all BBLs
  const regIdList = Array.from(registrationIdToBBL.keys())

  // Batch in chunks of 500 registration IDs
  const CHUNK = 500
  for (let i = 0; i < regIdList.length; i += CHUNK) {
    const chunk = regIdList.slice(i, i + CHUNK)
    const inClause = chunk.map((id) => `'${id}'`).join(",")

    const rows = await client.fetchAll(DATASET, {
      $where: `registrationid IN (${inClause})`,
      $select: "registrationid,type,contactdescription,firstname,lastname,corporationname,businesshousenumber,businessstreetname,businessapartment,businesscity,businessstate,businesszip,businessphone",
    }) as Record<string, string>[]

    // Group by registrationid — we want one "owner" contact and one "agent" contact per building
    const byRegId = new Map<string, { owner?: Record<string, string>; agent?: Record<string, string> }>()
    for (const row of rows) {
      const regId = row.registrationid
      if (!regId) continue
      const entry = byRegId.get(regId) ?? {}

      // contactdescription: "Owner", "CorporateOwner", "Agent", "HeadOfficer", etc.
      const desc = (row.contactdescription ?? "").toLowerCase()
      const isOwner = desc.includes("owner") || desc.includes("head officer") || desc.includes("officer")
      const isAgent = desc.includes("agent") || desc.includes("manager") || desc.includes("janitor") || desc.includes("superintendent")

      if (isOwner && !entry.owner) entry.owner = row
      else if (isAgent && !entry.agent) entry.agent = row

      byRegId.set(regId, entry)
    }

    for (const [regId, contacts] of byRegId) {
      const bbl = registrationIdToBBL.get(regId)
      if (!bbl) continue

      const ownerRow = contacts.owner
      const agentRow = contacts.agent

      const formatName = (row: Record<string, string> | undefined): string | null => {
        if (!row) return null
        if (row.corporationname) return row.corporationname.trim() || null
        const parts = [row.firstname, row.lastname].filter(Boolean)
        return parts.length ? parts.join(" ") : null
      }

      const formatAddress = (row: Record<string, string> | undefined): string | null => {
        if (!row) return null
        const parts = [
          [row.businesshousenumber, row.businessstreetname].filter(Boolean).join(" "),
          row.businessapartment ? `Apt ${row.businessapartment}` : null,
          [row.businesscity, row.businessstate, row.businesszip].filter(Boolean).join(", "),
        ].filter(Boolean)
        return parts.length ? parts.join(", ") : null
      }

      const formatPhone = (row: Record<string, string> | undefined): string | null => {
        const raw = row?.businessphone ?? ""
        if (!raw || raw.length < 7) return null
        // Format: strip non-digits, format as (XXX) XXX-XXXX
        const digits = raw.replace(/\D/g, "")
        if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
        if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
        return raw
      }

      result.set(bbl, {
        bbl,
        registrationId: regId,
        ownerName: formatName(ownerRow),
        ownerType: ownerRow ? (ownerRow.type ?? null) : null,
        ownerPhone: formatPhone(ownerRow),
        ownerMailingAddress: formatAddress(ownerRow),
        agentName: formatName(agentRow),
        agentPhone: formatPhone(agentRow),
        agentAddress: formatAddress(agentRow),
      })
    }
  }

  return result
}
