/**
 * Bulk ACRIS fetcher for the weekly pipeline.
 *
 * Strategy:
 *   1. Legals (8h5j-fqxa): OR-clause on borough/block/lot → collect doc_ids per BBL
 *      NOTE: Legals has NO doc_type column — filter by doc_type via Master
 *   2. Master (bnx9-e6tj): IN clause on doc_ids → doc_type, amounts, dates
 *      Filter to deed/mortgage types here.
 *   3. Parties (636b-3b5g): IN clause on relevant doc_ids → lender (type='2'), owner (type='1')
 *
 * Returns Map<bbl, ACRISRecord>. BBLs with no ACRIS records are omitted.
 */

import { getSocrataClient } from "./socrata"
import { DATASETS, ACRIS_DEED_TYPES, ACRIS_MORTGAGE_TYPES } from "@/lib/analysis/config"
import { buildACRISOrClause, rowToBBL } from "./bbl-utils"
import type { ACRISRecord } from "@/types"

const LEGALS_CHUNK = 40    // BBLs per Legals OR-clause request (~2KB URL, well under limit)
const MASTER_CHUNK = 150   // doc_ids per Master IN clause
const PARTIES_CHUNK = 150  // doc_ids per Parties IN clause
const CONCURRENCY = 5      // parallel requests per wave

interface RawLegal {
  document_id: string
  borough: string
  block: string
  lot: string
}

interface RawMaster {
  document_id: string
  doc_type: string
  document_amt: string   // ACRIS Master uses "document_amt", not "document_amt"
  recorded_datetime: string
}

interface RawParty {
  document_id: string
  party_type: string
  name: string
}

export async function fetchACRISBulk(bbls: string[]): Promise<Map<string, ACRISRecord>> {
  if (bbls.length === 0) return new Map()

  const client = getSocrataClient()
  const now = new Date().toISOString()

  // ── Step 1: Legals — get all doc_ids for each BBL ───────────────────────────
  // Legals dataset has NO doc_type column; we filter by doc_type in Step 2 (Master)
  const bblToDocIds = new Map<string, string[]>()

  const chunks: string[][] = []
  for (let i = 0; i < bbls.length; i += LEGALS_CHUNK) {
    chunks.push(bbls.slice(i, i + LEGALS_CHUNK))
  }

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const wave = chunks.slice(i, i + CONCURRENCY)
    const waveResults = await Promise.all(
      wave.map((chunk) => {
        const whereClause = buildACRISOrClause(chunk)
        return client.fetchAll<RawLegal>(DATASETS.ACRIS_LEGALS, {
          $where: whereClause,
          $select: "document_id,borough,block,lot",
        })
      })
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

  // Collect all unique doc_ids
  const allDocIds = [...new Set([...bblToDocIds.values()].flat())]

  // ── Step 2: Master — get doc_type, amounts, dates ────────────────────────────
  // Filter to only deed + mortgage types here
  const targetDocTypes = [...ACRIS_DEED_TYPES, ...ACRIS_MORTGAGE_TYPES]
  const docTypeList = targetDocTypes.map((t) => `'${t}'`).join(",")
  const masterByDocId = new Map<string, RawMaster>()

  // Master column is "document_amt" not "document_amt"
  // Filter by doc_type prefix in code (DEED*, MTGE, AGMT, MORTGAGE) rather than SQL IN
  // because exact strings like "DEED, BARGAIN AND SALE" don't match ACRIS types like "DEED, TS"
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
        const isMortgage = upper === "MTGE" || upper === "AGMT" || upper === "MORTGAGE" || upper.startsWith("MORTGAGE")
        if (!isDeed && !isMortgage) continue
        if (!masterByDocId.has(row.document_id)) {
          masterByDocId.set(row.document_id, row)
        }
      }
    }
  }

  // Filter bblToDocIds to only keep doc_ids that appear in Master (i.e., are deed/mortgage)
  const bblToRelevantDocIds = new Map<string, { docId: string; docType: string }[]>()
  for (const [bbl, docIds] of bblToDocIds) {
    const relevant = docIds
      .filter((id) => masterByDocId.has(id))
      .map((id) => ({ docId: id, docType: masterByDocId.get(id)!.doc_type }))
    if (relevant.length > 0) bblToRelevantDocIds.set(bbl, relevant)
  }

  if (bblToRelevantDocIds.size === 0) return new Map()

  // ── Step 3: Parties — lender + owner names ───────────────────────────────────
  const relevantDocIds = [...new Set([...bblToRelevantDocIds.values()].flatMap((d) => d.map((x) => x.docId)))]
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

  // ── Assemble results per BBL ─────────────────────────────────────────────────
  const result = new Map<string, ACRISRecord>()

  for (const [bbl, docs] of bblToRelevantDocIds) {
    const deedDocs = docs.filter(({ docType }) =>
      ACRIS_DEED_TYPES.some((t) => docType.toUpperCase().startsWith(t.split(",")[0].trim()))
    )
    const mortgageDocs = docs.filter(({ docType }) =>
      ACRIS_MORTGAGE_TYPES.some((t) => docType.toUpperCase().startsWith(t.split(",")[0].trim()))
    )

    // Most recent deed
    const latestDeedDocId = deedDocs
      .map(({ docId }) => ({ docId, master: masterByDocId.get(docId) }))
      .filter((x) => x.master)
      .sort((a, b) =>
        (b.master!.recorded_datetime ?? "").localeCompare(a.master!.recorded_datetime ?? "")
      )[0]?.docId ?? null

    const deedMaster = latestDeedDocId ? masterByDocId.get(latestDeedDocId) : null
    const lastDeedDate = deedMaster?.recorded_datetime?.split("T")[0] ?? null
    const lastSalePrice = deedMaster?.document_amt ? parseFloat(deedMaster.document_amt) || null : null
    const ownershipYears = lastDeedDate
      ? new Date().getFullYear() - new Date(lastDeedDate).getFullYear()
      : null

    const deedParties = latestDeedDocId ? (partiesByDocId.get(latestDeedDocId) ?? []) : []
    const ownerName = deedParties.find((p) => p.party_type === "1")?.name ?? null

    // Most recent mortgage
    const latestMortgageDocId = mortgageDocs
      .map(({ docId }) => ({ docId, master: masterByDocId.get(docId) }))
      .filter((x) => x.master)
      .sort((a, b) =>
        (b.master!.recorded_datetime ?? "").localeCompare(a.master!.recorded_datetime ?? "")
      )[0]?.docId ?? null

    const mortgageMaster = latestMortgageDocId ? masterByDocId.get(latestMortgageDocId) : null
    const lastMortgageAmount = mortgageMaster?.document_amt
      ? parseFloat(mortgageMaster.document_amt) || null
      : null
    const mortgageDate = mortgageMaster?.recorded_datetime?.split("T")[0] ?? null

    const mortgageParties = latestMortgageDocId
      ? (partiesByDocId.get(latestMortgageDocId) ?? [])
      : []
    const lenderName = mortgageParties.find((p) => p.party_type === "2")?.name ?? null

    result.set(bbl, {
      bbl,
      lastDeedDate,
      lastSalePrice,
      lastMortgageAmount,
      mortgageDate,
      lenderName,
      ownerName,
      ownershipYears,
      fetchedAt: now,
    })
  }

  return result
}
