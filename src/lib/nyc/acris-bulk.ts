/**
 * Bulk ACRIS fetcher for the weekly pipeline.
 *
 * Fetches deed + mortgage data for a list of BBLs using batched Socrata queries.
 * Strategy:
 *   1. Legals (8h5j-fqxa): OR-clause on borough/block/lot → collect doc_ids per BBL
 *   2. Master (bnx9-e6tj): IN clause on doc_ids → amounts, dates, doc_types
 *   3. Parties (636b-3b5g): IN clause on doc_ids → lender name (type='2'), owner name (type='1')
 *
 * Returns Map<bbl, ACRISRecord>. BBLs with no ACRIS records are omitted.
 *
 * For on-demand per-property fetch, use acris.ts instead.
 */

import { getSocrataClient } from "./socrata"
import { DATASETS, ACRIS_DEED_TYPES, ACRIS_MORTGAGE_TYPES } from "@/lib/analysis/config"
import { buildACRISOrClause, parseBBLParts, rowToBBL } from "./bbl-utils"
import type { ACRISRecord } from "@/types"

const LEGALS_CHUNK = 50    // BBLs per Legals OR-clause request (POST avoids URL limits)
const MASTER_CHUNK = 200   // doc_ids per Master IN clause
const PARTIES_CHUNK = 200  // doc_ids per Parties IN clause
const CONCURRENCY = 5      // parallel Legals requests per wave

interface RawLegal {
  document_id: string
  doc_type: string
  borough: string
  block: string
  lot: string
}

interface RawMaster {
  document_id: string
  doc_type: string
  doc_amount: string
  recorded_datetime: string
}

interface RawParty {
  document_id: string
  party_type: string
  name: string
}

export async function fetchACRISBulk(bbls: string[]): Promise<Map<string, ACRISRecord>> {
  const client = getSocrataClient()
  const now = new Date().toISOString()

  // ── Step 1: Legals — get doc_ids for all BBLs ────────────────────────────
  const targetDocTypes = [...ACRIS_DEED_TYPES, ...ACRIS_MORTGAGE_TYPES]
  const docTypeList = targetDocTypes.map((t) => `'${t}'`).join(",")

  // Map BBL → doc_ids
  const bblToDocIds = new Map<string, { docId: string; docType: string }[]>()

  // Process in waves of CONCURRENCY chunks
  for (let i = 0; i < bbls.length; i += LEGALS_CHUNK * CONCURRENCY) {
    const wave = bbls.slice(i, i + LEGALS_CHUNK * CONCURRENCY)
    const chunks: string[][] = []
    for (let j = 0; j < wave.length; j += LEGALS_CHUNK) {
      chunks.push(wave.slice(j, j + LEGALS_CHUNK))
    }

    const waveResults = await Promise.all(
      chunks.map(async (chunk) => {
        const whereClause = buildACRISOrClause(chunk)
        return client.fetchAllPost<RawLegal>(DATASETS.ACRIS_LEGALS, {
          $where: `(${whereClause}) AND doc_type IN (${docTypeList})`,
          $select: "document_id,doc_type,borough,block,lot",
        })
      })
    )

    for (const rows of waveResults) {
      for (const row of rows) {
        // Reconstruct BBL from borough/block/lot (ACRIS uses 'borough' not 'boroid')
        const bbl = rowToBBL(row as unknown as Record<string, string>, "borough")
        if (!bblToDocIds.has(bbl)) bblToDocIds.set(bbl, [])
        bblToDocIds.get(bbl)!.push({ docId: row.document_id, docType: row.doc_type })
      }
    }
  }

  if (bblToDocIds.size === 0) return new Map()

  // Collect all unique doc_ids
  const allDocIds = [...new Set([...bblToDocIds.values()].flatMap((d) => d.map((x) => x.docId)))]

  // ── Step 2: Master — get amounts + dates ─────────────────────────────────
  const masterByDocId = new Map<string, RawMaster>()

  for (let i = 0; i < allDocIds.length; i += MASTER_CHUNK) {
    const chunk = allDocIds.slice(i, i + MASTER_CHUNK)
    const inClause = chunk.map((id) => `'${id}'`).join(",")
    const rows = await client.fetchAllPost<RawMaster>(DATASETS.ACRIS_MASTER, {
      $where: `document_id IN (${inClause})`,
      $select: "document_id,doc_type,doc_amount,recorded_datetime",
      $order: "recorded_datetime DESC",
    })
    for (const row of rows) {
      // Keep only the first (most recent) record per doc_id
      if (!masterByDocId.has(row.document_id)) {
        masterByDocId.set(row.document_id, row)
      }
    }
  }

  // ── Step 3: Parties — get lender + owner names ───────────────────────────
  // Collect deed doc_ids (need grantee = owner) and mortgage doc_ids (need lender)
  const deedDocIds: string[] = []
  const mortgageDocIds: string[] = []

  for (const [, docs] of bblToDocIds) {
    for (const { docId, docType } of docs) {
      const upper = docType.toUpperCase()
      if (ACRIS_DEED_TYPES.some((t) => upper.startsWith(t.split(",")[0].trim()))) {
        deedDocIds.push(docId)
      } else if (ACRIS_MORTGAGE_TYPES.some((t) => upper.startsWith(t.split(",")[0].trim()))) {
        mortgageDocIds.push(docId)
      }
    }
  }

  const uniquePartyDocIds = [...new Set([...deedDocIds, ...mortgageDocIds])]
  const partiesByDocId = new Map<string, RawParty[]>()

  for (let i = 0; i < uniquePartyDocIds.length; i += PARTIES_CHUNK) {
    const chunk = uniquePartyDocIds.slice(i, i + PARTIES_CHUNK)
    const inClause = chunk.map((id) => `'${id}'`).join(",")
    const rows = await client.fetchAllPost<RawParty>(DATASETS.ACRIS_PARTIES, {
      $where: `document_id IN (${inClause}) AND party_type IN ('1','2')`,
      $select: "document_id,party_type,name",
    })
    for (const row of rows) {
      if (!partiesByDocId.has(row.document_id)) partiesByDocId.set(row.document_id, [])
      partiesByDocId.get(row.document_id)!.push(row)
    }
  }

  // ── Assemble results per BBL ─────────────────────────────────────────────
  const result = new Map<string, ACRISRecord>()

  for (const [bbl, docs] of bblToDocIds) {
    // Split into deeds and mortgages
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
    const lastSalePrice = deedMaster?.doc_amount ? parseFloat(deedMaster.doc_amount) || null : null
    const ownershipYears = lastDeedDate
      ? new Date().getFullYear() - new Date(lastDeedDate).getFullYear()
      : null

    // Owner name from deed grantee (party_type='1')
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
    const lastMortgageAmount = mortgageMaster?.doc_amount
      ? parseFloat(mortgageMaster.doc_amount) || null
      : null
    const mortgageDate = mortgageMaster?.recorded_datetime?.split("T")[0] ?? null

    // Lender name from mortgage parties (party_type='2')
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
