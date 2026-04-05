/**
 * Bulk ACRIS fetcher for the weekly pipeline.
 *
 * Schema notes (verified 2026-04-05):
 *   - Legals (8h5j-fqxa): document_id, borough, block, lot — NO doc_type column
 *   - Master (bnx9-e6tj): document_id, doc_type, document_amt, recorded_datetime
 *   - Parties (636b-3b5g): document_id, party_type, name
 *   - DEED types: "DEED", "DEED, TS", "DEED, LE", "DEEDO", etc. (prefix match)
 *   - Mortgage types: "MTGE", "AGMT", "MORTGAGE"
 *
 * Processes in SUPER_WAVE batches so the caller can write incrementally to the DB
 * after each batch rather than buffering all results in memory.
 */

import { getSocrataClient } from "./socrata"
import { DATASETS } from "@/lib/analysis/config"
import { buildACRISOrClause, rowToBBL } from "./bbl-utils"
import type { ACRISRecord } from "@/types"

const LEGALS_CHUNK = 40    // BBLs per Legals OR-clause request (~2KB URL)
const MASTER_CHUNK = 150   // doc_ids per Master IN clause
const PARTIES_CHUNK = 150  // doc_ids per Parties IN clause
const CONCURRENCY = 5      // parallel requests per wave
export const ACRIS_SUPER_WAVE = 200 // BBLs per processable batch (caller iterates)

interface RawLegal {
  document_id: string
  borough: string
  block: string
  lot: string
}

interface RawMaster {
  document_id: string
  doc_type: string
  document_amt: string
  recorded_datetime: string
}

interface RawParty {
  document_id: string
  party_type: string
  name: string
}

/**
 * Process one batch of BBLs through all 3 ACRIS phases and return assembled records.
 * The caller should call this in a loop over super-wave slices and write results
 * to the DB after each call.
 */
export async function fetchACRISBatch(bbls: string[]): Promise<Map<string, ACRISRecord>> {
  if (bbls.length === 0) return new Map()

  const client = getSocrataClient()
  const now = new Date().toISOString()

  // ── Phase 1: Legals ──────────────────────────────────────────────────────────
  const bblToDocIds = new Map<string, string[]>()

  const chunks: string[][] = []
  for (let i = 0; i < bbls.length; i += LEGALS_CHUNK) {
    chunks.push(bbls.slice(i, i + LEGALS_CHUNK))
  }

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const wave = chunks.slice(i, i + CONCURRENCY)
    const waveResults = await Promise.all(
      wave.map((chunk) =>
        client.fetchAll<RawLegal>(DATASETS.ACRIS_LEGALS, {
          $where: buildACRISOrClause(chunk),
          $select: "document_id,borough,block,lot",
        })
      )
    )
    for (const rows of waveResults) {
      for (const row of rows) {
        const bbl = rowToBBL(row as unknown as Record<string, string>, "borough")
        if (!bblToDocIds.has(bbl)) bblToDocIds.set(bbl, [])
        bblToDocIds.get(bbl)!.push(row.document_id)
      }
    }
  }

  if (bblToDocIds.size === 0) return new Map()

  const allDocIds = [...new Set([...bblToDocIds.values()].flat())]

  // ── Phase 2: Master ──────────────────────────────────────────────────────────
  const masterByDocId = new Map<string, RawMaster>()

  const masterChunks: string[][] = []
  for (let i = 0; i < allDocIds.length; i += MASTER_CHUNK) {
    masterChunks.push(allDocIds.slice(i, i + MASTER_CHUNK))
  }

  for (let i = 0; i < masterChunks.length; i += CONCURRENCY) {
    const wave = masterChunks.slice(i, i + CONCURRENCY)
    const waveResults = await Promise.all(
      wave.map((chunk) => {
        const inClause = chunk.map((id) => `'${id}'`).join(",")
        return client.fetchAll<RawMaster>(DATASETS.ACRIS_MASTER, {
          $where: `document_id IN (${inClause})`,
          $select: "document_id,doc_type,document_amt,recorded_datetime",
          $order: "recorded_datetime DESC",
        })
      })
    )
    for (const rows of waveResults) {
      for (const row of rows) {
        const upper = row.doc_type?.toUpperCase() ?? ""
        const isDeed = upper.startsWith("DEED") || upper === "DEEDO"
        const isMortgage = upper === "MTGE" || upper === "AGMT" || upper.startsWith("MORTGAGE")
        if (!isDeed && !isMortgage) continue
        if (!masterByDocId.has(row.document_id)) masterByDocId.set(row.document_id, row)
      }
    }
  }

  // Filter to only BBLs that have relevant doc_ids in Master
  const bblToRelevantDocs = new Map<string, { docId: string; docType: string }[]>()
  for (const [bbl, docIds] of bblToDocIds) {
    const relevant = docIds
      .filter((id) => masterByDocId.has(id))
      .map((id) => ({ docId: id, docType: masterByDocId.get(id)!.doc_type }))
    if (relevant.length > 0) bblToRelevantDocs.set(bbl, relevant)
  }

  if (bblToRelevantDocs.size === 0) return new Map()

  // ── Phase 3: Parties ─────────────────────────────────────────────────────────
  const relevantDocIds = [...new Set([...bblToRelevantDocs.values()].flatMap((d) => d.map((x) => x.docId)))]
  const partiesByDocId = new Map<string, RawParty[]>()

  const partyChunks: string[][] = []
  for (let i = 0; i < relevantDocIds.length; i += PARTIES_CHUNK) {
    partyChunks.push(relevantDocIds.slice(i, i + PARTIES_CHUNK))
  }

  for (let i = 0; i < partyChunks.length; i += CONCURRENCY) {
    const wave = partyChunks.slice(i, i + CONCURRENCY)
    const waveResults = await Promise.all(
      wave.map((chunk) => {
        const inClause = chunk.map((id) => `'${id}'`).join(",")
        return client.fetchAll<RawParty>(DATASETS.ACRIS_PARTIES, {
          $where: `document_id IN (${inClause}) AND party_type IN ('1','2')`,
          $select: "document_id,party_type,name",
        })
      })
    )
    for (const rows of waveResults) {
      for (const row of rows) {
        if (!partiesByDocId.has(row.document_id)) partiesByDocId.set(row.document_id, [])
        partiesByDocId.get(row.document_id)!.push(row)
      }
    }
  }

  // ── Assemble ─────────────────────────────────────────────────────────────────
  const result = new Map<string, ACRISRecord>()

  for (const [bbl, docs] of bblToRelevantDocs) {
    const isDeed = (t: string) => t?.toUpperCase().startsWith("DEED") || t?.toUpperCase() === "DEEDO"
    const isMortgage = (t: string) => ["MTGE", "AGMT"].includes(t?.toUpperCase()) || t?.toUpperCase().startsWith("MORTGAGE")

    const sortedByDate = (ids: { docId: string }[]) =>
      ids
        .map(({ docId }) => ({ docId, master: masterByDocId.get(docId) }))
        .filter((x) => x.master)
        .sort((a, b) => (b.master!.recorded_datetime ?? "").localeCompare(a.master!.recorded_datetime ?? ""))

    const latestDeedDocId = sortedByDate(docs.filter(({ docType }) => isDeed(docType)))[0]?.docId ?? null
    const latestMortgageDocId = sortedByDate(docs.filter(({ docType }) => isMortgage(docType)))[0]?.docId ?? null

    const deedMaster = latestDeedDocId ? masterByDocId.get(latestDeedDocId) : null
    const mortgageMaster = latestMortgageDocId ? masterByDocId.get(latestMortgageDocId) : null

    const lastDeedDate = deedMaster?.recorded_datetime?.split("T")[0] ?? null
    const lastSalePrice = deedMaster?.document_amt ? parseFloat(deedMaster.document_amt) || null : null
    const ownershipYears = lastDeedDate ? new Date().getFullYear() - new Date(lastDeedDate).getFullYear() : null
    const ownerName = latestDeedDocId
      ? (partiesByDocId.get(latestDeedDocId) ?? []).find((p) => p.party_type === "1")?.name ?? null
      : null

    const lastMortgageAmount = mortgageMaster?.document_amt ? parseFloat(mortgageMaster.document_amt) || null : null
    const mortgageDate = mortgageMaster?.recorded_datetime?.split("T")[0] ?? null
    const lenderName = latestMortgageDocId
      ? (partiesByDocId.get(latestMortgageDocId) ?? []).find((p) => p.party_type === "2")?.name ?? null
      : null

    result.set(bbl, {
      bbl, lastDeedDate, lastSalePrice, lastMortgageAmount,
      mortgageDate, lenderName, ownerName, ownershipYears, fetchedAt: now,
    })
  }

  return result
}

/** Convenience wrapper — fetches all BBLs across super-waves, returns combined map. */
export async function fetchACRISBulk(bbls: string[]): Promise<Map<string, ACRISRecord>> {
  const result = new Map<string, ACRISRecord>()
  for (let i = 0; i < bbls.length; i += ACRIS_SUPER_WAVE) {
    const batch = bbls.slice(i, i + ACRIS_SUPER_WAVE)
    const batchResult = await fetchACRISBatch(batch)
    for (const [bbl, record] of batchResult) result.set(bbl, record)
  }
  return result
}
