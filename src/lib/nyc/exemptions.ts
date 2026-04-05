import { getSocrataClient } from "./socrata"
import { DATASETS, ALL_TARGET_CODES } from "@/lib/analysis/config"
import type { RawExemption } from "@/types"

/**
 * Fetch all active 421-a and J-51 exemption records from NYC Open Data.
 * Dataset: muvi-b6kx (DOF Property Exemption Detail)
 * Column names verified against live dataset on 2026-04-04.
 */
export async function fetchExemptions(boroCode?: string): Promise<RawExemption[]> {
  const client = getSocrataClient()

  const codeList = ALL_TARGET_CODES.map((c) => `'${c}'`).join(",")
  let where = `exmp_code IN (${codeList}) AND no_years > '0' AND benftstart > '0'`
  if (boroCode) where += ` AND boro='${boroCode}'`

  console.log(`[exemptions] Fetching 421-a/J-51 exemptions${boroCode ? ` for boro ${boroCode}` : " (all boroughs)"}...`)

  const rows = await client.fetchAll<RawExemption>(DATASETS.EXEMPTION_DETAIL, {
    $where: where,
    $select: "parid,boro,year,exmp_code,benftstart,no_years,curexmptot,basetot,bldg_class",
  })

  console.log(`[exemptions] Fetched ${rows.length} rows`)
  return rows
}
