/**
 * HPD Regulatory Agreements via ACRIS Legals + Master
 *
 * For 421-a affordable buildings, HPD files regulatory agreements in ACRIS
 * recording the unit mix (studio/1BR/2BR/3BR) and AMI levels.
 * Doc types to look for: "REG AGMT", "RPTTL", "AGMT OF REG", "REGULATORY AGMT"
 *
 * This gives us actual affordable unit counts for a subset of buildings,
 * sharpening the income estimate beyond the blended 20/50/25/5 assumption.
 *
 * Strategy:
 *   1. Query ACRIS Legals for doc_type matching regulatory agreement patterns + target BBLs
 *   2. Pull Master records for those doc_ids to get filing date
 *   3. Parse document_date to identify most recent agreement per BBL
 *   4. We can't parse PDF text via Socrata — but we can surface the doc link
 *      so investors can pull the actual agreement from ACRIS web portal
 *
 * Note: actual unit mix from the agreement text requires PDF parsing (not available
 * via Socrata). What we CAN get: confirmation that an agreement exists, its date,
 * and a direct ACRIS link. This tells us the building has a recorded affordable
 * commitment — useful for deregulation risk assessment even without unit mix.
 */

import { getSocrataClient } from "./socrata"
import { buildACRISOrClause } from "./bbl-utils"

const LEGALS_DATASET = "8h5j-fqxa"
const MASTER_DATASET = "bnx9-e6tj"

// ACRIS doc types that indicate HPD regulatory agreements
const REG_AGREEMENT_TYPES = [
  "REG AGMT",
  "AGMT OF REG",
  "REGULATORY AGMT",
  "REGULATORY AGREEMENT",
  "HAP CONTRACT",
  "LAND DISPOSITION AGMT",
  "URBAN DEVELOPMENT ACTION AREA AGMT",
]

export interface RegAgreement {
  bbl: string
  docId: string
  docType: string
  documentDate: string | null
  acrisUrl: string
  hasAffordableCommitment: boolean
}

const CHUNK = 150
const CONCURRENCY = 4

async function runChunked<T>(
  items: string[],
  chunkSize: number,
  concurrency: number,
  fn: (chunk: string[]) => Promise<T[]>
): Promise<T[]> {
  const chunks: string[][] = []
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize))
  }
  const results: T[] = []
  for (let i = 0; i < chunks.length; i += concurrency) {
    const wave = chunks.slice(i, i + concurrency)
    const waveResults = await Promise.all(wave.map(fn))
    for (const r of waveResults) results.push(...r)
  }
  return results
}

/**
 * Fetch HPD regulatory agreements for a list of BBLs.
 * Returns map of bbl → most recent RegAgreement.
 */
export async function fetchRegAgreements(
  bbls: string[]
): Promise<Map<string, RegAgreement>> {
  const client = getSocrataClient()
  const result = new Map<string, RegAgreement>()

  // Build doc_type IN clause
  const typeIn = REG_AGREEMENT_TYPES.map((t) => `'${t}'`).join(",")

  // Query ACRIS Legals: BBL match only (doc_type is on Master, not Legals)
  const legalRows = await runChunked(bbls, CHUNK, CONCURRENCY, (chunk) => {
    const bblClause = buildACRISOrClause(chunk)
    return client.fetchAll(LEGALS_DATASET, {
      $where: `(${bblClause})`,
      $select: "document_id,borough,block,lot",
    }) as Promise<Record<string, string>[]>
  })

  if (legalRows.length === 0) return result

  // Map doc_id → bbl (doc_type unknown until we hit Master)
  const docToBBL = new Map<string, string>()
  const bblSet = new Set(bbls)
  for (const row of legalRows) {
    const boro = row.borough ?? "0"
    const block = (row.block ?? "0").padStart(5, "0")
    const lot = (row.lot ?? "0").padStart(4, "0")
    const bbl = `${boro}${block}${lot}`
    const docId = row.document_id
    if (docId && bblSet.has(bbl)) {
      docToBBL.set(docId, bbl)
    }
  }

  if (docToBBL.size === 0) return result

  // Fetch Master records — filter by doc_type here, get date
  const docIds = Array.from(docToBBL.keys())
  const masterRows = await runChunked(docIds, 200, CONCURRENCY, (chunk) => {
    const inClause = chunk.map((id) => `'${id}'`).join(",")
    return client.fetchAll(MASTER_DATASET, {
      $where: `document_id IN (${inClause}) AND doc_type IN (${typeIn})`,
      $select: "document_id,doc_type,doc_date",
    }) as Promise<Record<string, string>[]>
  })

  const masterByDoc = new Map<string, { docType: string; docDate: string | null }>()
  for (const row of masterRows) {
    if (row.document_id) {
      masterByDoc.set(row.document_id, {
        docType: row.doc_type ?? "",
        docDate: row.doc_date ?? null,
      })
    }
  }

  // Build result — keep most recent agreement per BBL
  for (const [docId, bbl] of docToBBL) {
    const master = masterByDoc.get(docId)
    if (!master) continue  // not a reg agreement doc type
    const { docType, docDate } = master
    const existing = result.get(bbl)

    // Prefer more recent document date
    if (existing && existing.documentDate && docDate) {
      if (docDate <= existing.documentDate) continue
    }

    result.set(bbl, {
      bbl,
      docId,
      docType,
      documentDate: docDate,
      acrisUrl: `https://acris.nyc.gov/DS/DocumentSearch/DocumentImageView?doc_id=${docId}`,
      hasAffordableCommitment: true,
    })
  }

  return result
}
