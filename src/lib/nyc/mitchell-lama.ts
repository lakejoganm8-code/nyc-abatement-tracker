/**
 * Mitchell-Lama housing program detection via HPD Buildings Under Jurisdiction
 *
 * Dataset: kj4p-ruqc (HPD Buildings Subject to HPD Jurisdiction)
 * managementprogram values for M-L buildings:
 *   "M-L (STATE)"     — state-supervised Mitchell-Lama
 *   "M-L (NRF CITY)"  — city Mitchell-Lama, non-rental-fee
 *   "M-L (RF CITY)"   — city Mitchell-Lama, rental-fee
 *
 * Join: boro + block.padStart(5) + lot.padStart(4) → BBL
 */

import { getSocrataClient } from "./socrata"

const DATASET = "kj4p-ruqc"

const ML_PROGRAMS = ["M-L (STATE)", "M-L (NRF CITY)", "M-L (RF CITY)"]

export interface MitchellLamaRecord {
  bbl: string
  program_detail: string   // the specific M-L variant
  lifecycle: string | null
}

export async function fetchMitchellLama(): Promise<Map<string, MitchellLamaRecord>> {
  const client = getSocrataClient()
  const result = new Map<string, MitchellLamaRecord>()

  const programIn = ML_PROGRAMS.map((p) => `'${p}'`).join(",")

  const rows = await client.fetchAll(DATASET, {
    $where:  `managementprogram IN (${programIn})`,
    $select: "boroid,block,lot,managementprogram,lifecycle",
  }) as Record<string, string>[]

  for (const row of rows) {
    const boro  = row.boroid ?? ""
    const block = (row.block ?? "").padStart(5, "0")
    const lot   = (row.lot   ?? "").padStart(4, "0")
    if (!boro || !block || !lot) continue
    const bbl = `${boro}${block}${lot}`
    result.set(bbl, {
      bbl,
      program_detail: row.managementprogram ?? "",
      lifecycle:      row.lifecycle ?? null,
    })
  }

  return result
}
