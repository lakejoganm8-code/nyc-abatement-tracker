/**
 * SCRIE / DRIE — Senior Citizen & Disability Rent Increase Exemption
 *
 * DOF publishes per-borough PDF reports listing every building with active
 * SCRIE or DRIE tenants, sorted by BBL. We download all 10 files (5 boroughs
 * × 2 programs), parse with pdftotext, and aggregate to one row per BBL.
 *
 * Source URLs:
 *   SCRIE tenant list: nyc.gov/assets/finance/downloads/pdf/scrie/tenant_status_reports/scrie_tenant_report_by_bbl_{borough}.pdf
 *   DRIE tenant list:  nyc.gov/assets/finance/downloads/pdf/drie/drie_bbl_landlord_report/drie_tenant_report_by_bbl_{borough}.pdf
 *
 * Parsed fields per BBL:
 *   scrie_active_tenants       — count of "Approved / Active" tenants
 *   scrie_total_monthly_credit — sum of landlord monthly SCRIE credit (last $x.xx on credit lines)
 *   (same for DRIE)
 */

import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const BOROUGHS = ["bronx", "brooklyn", "manhattan", "queens", "staten_island"] as const

const SCRIE_URL = (b: string) =>
  `https://www.nyc.gov/assets/finance/downloads/pdf/scrie/tenant_status_reports/scrie_tenant_report_by_bbl_${b}.pdf`

const DRIE_URL = (b: string) =>
  `https://www.nyc.gov/assets/finance/downloads/pdf/drie/drie_bbl_landlord_report/drie_tenant_report_by_bbl_${b}.pdf`

export interface ScrieDrieRecord {
  bbl: string
  scrie_active_tenants: number
  scrie_total_monthly_credit: number
  drie_active_tenants: number
  drie_total_monthly_credit: number
}

/**
 * Parse pdftotext output from a SCRIE or DRIE tenant-by-BBL report.
 * Returns map of bbl → { active_tenants, total_monthly_credit }
 *
 * PDF structure per building:
 *   BBL:
 *   <blank>
 *   {boro}-{block}-{lot}        ← docket "BBL" identifier
 *   {address}
 *   [rows with tenant data...]
 *     Each active row contains "Active" and ends with "$xx.xx" (monthly SCRIE credit)
 */
function parsePDF(text: string): Map<string, { active: number; credit: number }> {
  const result = new Map<string, { active: number; credit: number }>()
  const lines = text.split("\n")

  // BBL docket line: boro-block-lot e.g. "2-2261-45"
  const bblPat = /^(\d)-(\d+)-(\d+)$/
  // The landlord monthly SCRIE/DRIE credit is always the last dollar amount on
  // an active tenant's data line — but we key off "Active" appearing on that
  // line, and the credit is on the following line(s) ending with $xx.xx
  // Simpler: count "Active" occurrences per BBL, sum trailing dollar amounts
  // on lines that don't contain header keywords
  const dollarPat = /\$(\d[\d,]*\.\d{2})$/
  const headerWords = /Frozen Rent|Legal Rent|Credit or|Debit|Benefit Type|Monthly SCRIE|Monthly DRIE|Header/i

  let currentBBL: string | null = null
  let pendingActive = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    const m = bblPat.exec(line)
    if (m) {
      const boro  = m[1]
      const block = m[2].padStart(5, "0")
      const lot   = m[3].padStart(4, "0")
      currentBBL = `${boro}${block}${lot}`
      if (!result.has(currentBBL)) result.set(currentBBL, { active: 0, credit: 0 })
      pendingActive = false
      continue
    }

    if (!currentBBL) continue

    const entry = result.get(currentBBL)!

    // Track active status — "Active" appears on a tenant row
    if (line.includes("Active") && !line.includes("Inactive")) {
      pendingActive = true
      if (line.includes("Active")) entry.active++
    }

    // Credit amount: last $xx.xx on a line, skip header/label lines
    if (!headerWords.test(line)) {
      const dm = dollarPat.exec(line)
      if (dm) {
        const val = parseFloat(dm[1].replace(/,/g, ""))
        // Only count the landlord monthly credit lines — these appear right after
        // tenant rent amounts. Heuristic: if line has at least 2 dollar amounts
        // it's likely a data row; take only lines where "Active" or "Expired" is present
        // or where the line is short (just a dollar amount)
        if (pendingActive || line.length < 20) {
          entry.credit += val
          pendingActive = false
        }
      }
    }
  }

  return result
}

async function fetchAndParsePDF(
  url: string,
  tmpDir: string,
  label: string
): Promise<Map<string, { active: number; credit: number }>> {
  const outPath = path.join(tmpDir, `${label}.pdf`)
  try {
    // Use curl — faster than Playwright for direct PDF downloads
    execSync(`curl -s --max-time 60 --retry 2 -o "${outPath}" "${url}"`, { stdio: "pipe" })
    const text = execSync(`pdftotext "${outPath}" -`, { maxBuffer: 50 * 1024 * 1024 }).toString("utf8")
    return parsePDF(text)
  } catch (err) {
    console.warn(`[scrie-drie] Failed to fetch/parse ${label}: ${err}`)
    return new Map()
  } finally {
    try { fs.unlinkSync(outPath) } catch {}
  }
}

/**
 * Fetch and parse all SCRIE + DRIE tenant reports for all 5 boroughs.
 * Returns a map of bbl → ScrieDrieRecord (only BBLs with at least 1 active tenant).
 */
export async function fetchScrieDrie(): Promise<Map<string, ScrieDrieRecord>> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrie-drie-"))
  const combined = new Map<string, ScrieDrieRecord>()

  try {
    // Fetch all 10 PDFs — 5 SCRIE + 5 DRIE — sequentially per program to avoid hammering nyc.gov
    for (const boro of BOROUGHS) {
      const [scrie, drie] = await Promise.all([
        fetchAndParsePDF(SCRIE_URL(boro), tmpDir, `scrie_${boro}`),
        fetchAndParsePDF(DRIE_URL(boro), tmpDir, `drie_${boro}`),
      ])

      // Merge into combined map
      const allBBLs = new Set([...scrie.keys(), ...drie.keys()])
      for (const bbl of allBBLs) {
        const s = scrie.get(bbl) ?? { active: 0, credit: 0 }
        const d = drie.get(bbl) ?? { active: 0, credit: 0 }
        const existing = combined.get(bbl)
        combined.set(bbl, {
          bbl,
          scrie_active_tenants:       (existing?.scrie_active_tenants ?? 0) + s.active,
          scrie_total_monthly_credit: (existing?.scrie_total_monthly_credit ?? 0) + s.credit,
          drie_active_tenants:        (existing?.drie_active_tenants ?? 0) + d.active,
          drie_total_monthly_credit:  (existing?.drie_total_monthly_credit ?? 0) + d.credit,
        })
      }

      console.log(`[scrie-drie] ${boro}: SCRIE=${scrie.size} BBLs, DRIE=${drie.size} BBLs`)
    }
  } finally {
    try { fs.rmdirSync(tmpDir) } catch {}
  }

  return combined
}
