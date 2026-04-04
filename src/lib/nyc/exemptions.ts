import { getSocrataClient } from "./socrata"
import { DATASETS, ALL_TARGET_CODES, BOROUGH_CODES } from "@/lib/analysis/config"
import type { RawExemption } from "@/types"

/**
 * Fetch all active 421-a and J-51 exemption records from NYC Open Data.
 * Optionally filter by borough (1=Manhattan, 2=Bronx, 3=Brooklyn, 4=Queens, 5=SI).
 */
export async function fetchExemptions(boroCode?: string): Promise<RawExemption[]> {
  const client = getSocrataClient()

  // Build $where clause — filter to target exemption codes
  const codeList = ALL_TARGET_CODES.map((c) => `'${c}'`).join(",")
  let where = `exmptcode IN (${codeList})`
  if (boroCode) where += ` AND boro='${boroCode}'`

  console.log(`[exemptions] Fetching 421-a/J-51 exemptions${boroCode ? ` for boro ${boroCode}` : " (all boroughs)"}...`)

  const rows = await client.fetchAll<RawExemption>(DATASETS.EXEMPTION_DETAIL, {
    $where: where,
    $select: "bble,taxyear,exmptcode,exmptamt,gross,bldgclass,stname,housenum_lo,housenum_hi,boro,zip",
  })

  console.log(`[exemptions] Fetched ${rows.length} rows`)
  return rows
}

/**
 * Fetch J-51 specific records (y7az-s7wc dataset has more detail on J-51).
 * Merges with the main exemption dataset for better start-year accuracy.
 */
export async function fetchJ51Records(boroCode?: string): Promise<Record<string, unknown>[]> {
  const client = getSocrataClient()

  let where = "exempt_amount > 0"
  if (boroCode) where += ` AND boro='${boroCode}'`

  console.log(`[j51] Fetching J-51 records...`)
  const rows = await client.fetchAll(DATASETS.J51, {
    $where: where,
    $select: "bble,tax_year,exempt_amount,abate_amount,bldgclass,stname,housenum_lo,boro",
  })

  console.log(`[j51] Fetched ${rows.length} rows`)
  return rows
}

/** Convert borough name to Socrata boro code */
export function boroughToCode(borough: string): string | undefined {
  const entry = Object.entries(BOROUGH_CODES).find(
    ([, name]) => name.toLowerCase() === borough.toLowerCase().replace(" ", "_")
  )
  return entry?.[0]
}
