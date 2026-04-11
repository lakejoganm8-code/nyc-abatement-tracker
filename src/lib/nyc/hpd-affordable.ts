/**
 * HPD Affordable Housing Production by Building
 *
 * Dataset: hg8x-zxpr
 * Contains buildings with HPD-administered affordable housing programs
 * (421-a with HPD financing, Mitchell-Lama new construction, LIHTC via HPD,
 *  Inclusionary Housing, etc.) and their AMI unit counts.
 *
 * Join: bbl field (direct)
 *
 * We store one row per BBL — if a building has multiple projects we take the
 * most recently started one and aggregate unit counts.
 */

import { getSocrataClient } from "./socrata"

const DATASET = "hg8x-zxpr"

export interface HPDAffordableRecord {
  bbl: string
  hpd_project_id: string | null
  hpd_extended_affordability: boolean
  ami_extremely_low: number
  ami_very_low: number
  ami_low: number
  ami_moderate: number
  ami_middle: number
  total_affordable_units: number
  project_start_date: string | null
}

export async function fetchHPDAffordable(bbls: string[]): Promise<Map<string, HPDAffordableRecord>> {
  if (bbls.length === 0) return new Map()
  const client = getSocrataClient()
  const result = new Map<string, HPDAffordableRecord>()

  // Dataset has bbl field directly — query in chunks of 200
  const CHUNK = 200
  const allRows: Record<string, string>[] = []

  for (let i = 0; i < bbls.length; i += CHUNK) {
    const chunk = bbls.slice(i, i + CHUNK)
    const inClause = chunk.map((b) => `'${b}'`).join(",")
    const rows = await client.fetchAll(DATASET, {
      $where:  `bbl IN (${inClause})`,
      $select: "bbl,project_id,project_start_date,extended_affordability_status,extremely_low_income_units,very_low_income_units,low_income_units,moderate_income_units,middle_income_units,all_counted_units",
    }) as Record<string, string>[]
    allRows.push(...rows)
  }

  for (const row of allRows) {
    const bbl = row.bbl
    if (!bbl) continue

    const num = (v: string | undefined) => parseInt(v ?? "0") || 0
    const newRecord: HPDAffordableRecord = {
      bbl,
      hpd_project_id:             row.project_id ?? null,
      hpd_extended_affordability: (row.extended_affordability_status ?? "").toLowerCase() === "yes",
      ami_extremely_low:          num(row.extremely_low_income_units),
      ami_very_low:               num(row.very_low_income_units),
      ami_low:                    num(row.low_income_units),
      ami_moderate:               num(row.moderate_income_units),
      ami_middle:                 num(row.middle_income_units),
      total_affordable_units:     num(row.all_counted_units),
      project_start_date:         row.project_start_date ?? null,
    }

    // Keep the most recently started project per BBL
    const existing = result.get(bbl)
    if (
      !existing ||
      (newRecord.project_start_date && existing.project_start_date &&
        newRecord.project_start_date > existing.project_start_date)
    ) {
      result.set(bbl, newRecord)
    }
  }

  return result
}
