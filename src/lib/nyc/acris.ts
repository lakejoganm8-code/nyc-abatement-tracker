import { getSocrataClient } from "./socrata"
import { DATASETS } from "@/lib/analysis/config"
import type { ACRISRecord } from "@/types"

/**
 * Fetch ACRIS deed + mortgage data for a single BBL (on-demand, 24hr cache fallback).
 *
 * Schema notes (verified 2026-04-05):
 *   - Legals (8h5j-fqxa): has document_id, borough, block, lot — NO doc_type column
 *   - Master (bnx9-e6tj): has document_id, doc_type, document_amt, recorded_datetime
 *   - Parties (636b-3b5g): has document_id, party_type, name
 *   - DEED types in Master: "DEED", "DEED, TS", "DEED, LE", "DEEDO", etc. (prefix match)
 *   - Mortgage types: "MTGE", "AGMT", "MORTGAGE"
 */
export async function getACRISData(bbl: string): Promise<ACRISRecord | null> {
  const client = getSocrataClient()
  const now = new Date().toISOString()

  const clean = bbl.replace(/\D/g, "").padStart(10, "0")
  const boro = clean[0]
  const block = clean.slice(1, 6).replace(/^0+/, "") || "0"
  const lot = clean.slice(6, 10).replace(/^0+/, "") || "0"

  // ── Step 1: Get doc_ids from Legals (no doc_type filter — Legals lacks that column) ──
  const legals = await client.fetchAll(DATASETS.ACRIS_LEGALS, {
    $where: `borough='${boro}' AND block='${block}' AND lot='${lot}'`,
    $select: "document_id",
  }) as { document_id: string }[]

  if (legals.length === 0) return null

  const docIds = [...new Set(legals.map((l) => l.document_id))]
  const docIdList = docIds.map((id) => `'${id}'`).join(",")

  // ── Step 2: Get master records, filter to deed/mortgage types in code ──────
  const masterRows = await client.fetchAll(DATASETS.ACRIS_MASTER, {
    $where: `document_id IN (${docIdList})`,
    $select: "document_id,doc_type,document_amt,recorded_datetime",
    $order: "recorded_datetime DESC",
  }) as {
    document_id: string
    doc_type: string
    document_amt: string
    recorded_datetime: string
  }[]

  const isDeed = (t: string) => t?.toUpperCase().startsWith("DEED") || t?.toUpperCase() === "DEEDO"
  const isMortgage = (t: string) => ["MTGE", "AGMT", "MORTGAGE"].includes(t?.toUpperCase())

  const deedRows = masterRows.filter((r) => isDeed(r.doc_type))
  const mortgageRows = masterRows.filter((r) => isMortgage(r.doc_type))

  if (deedRows.length === 0 && mortgageRows.length === 0) return null

  const latestDeed = deedRows[0] ?? null
  const lastDeedDate = latestDeed?.recorded_datetime?.split("T")[0] ?? null
  const lastSalePrice = latestDeed?.document_amt ? parseFloat(latestDeed.document_amt) || null : null
  const ownershipYears = lastDeedDate
    ? new Date().getFullYear() - new Date(lastDeedDate).getFullYear()
    : null

  const latestMortgage = mortgageRows[0] ?? null
  const mortgageDate = latestMortgage?.recorded_datetime?.split("T")[0] ?? null
  const mortgageDocId = latestMortgage?.document_id ?? null
  const deedDocId = latestDeed?.document_id ?? null

  // Portfolio loan adjustment: count how many BBLs share this mortgage doc_id.
  // A single ACRIS document recorded against multiple properties has the total
  // facility amount, not the per-building allocation — divide to get per-building.
  let lastMortgageAmount: number | null = null
  let mortgagePortfolioCount: number | null = null
  if (latestMortgage?.document_amt) {
    const rawAmt = parseFloat(latestMortgage.document_amt) || null
    if (rawAmt != null && mortgageDocId) {
      const sharedLegals = await client.fetchAll(DATASETS.ACRIS_LEGALS, {
        $where: `document_id='${mortgageDocId}'`,
        $select: "document_id",
      }) as { document_id: string }[]
      const sharedCount = Math.max(1, sharedLegals.length)
      lastMortgageAmount = sharedCount > 1 ? rawAmt / sharedCount : rawAmt
      mortgagePortfolioCount = sharedCount > 1 ? sharedCount : null
    }
  }

  // ── Step 3: Get lender + owner names from Parties ────────────────────────
  let lenderName: string | null = null
  let ownerName: string | null = null

  if (mortgageDocId) {
    const parties = await client.fetchAll(DATASETS.ACRIS_PARTIES, {
      $where: `document_id='${mortgageDocId}' AND party_type='2'`,
      $select: "name",
    }) as { name: string }[]
    lenderName = parties[0]?.name ?? null
  }

  if (deedDocId) {
    const parties = await client.fetchAll(DATASETS.ACRIS_PARTIES, {
      $where: `document_id='${deedDocId}' AND party_type='1'`,
      $select: "name",
    }) as { name: string }[]
    ownerName = parties[0]?.name ?? null
  }

  return {
    bbl,
    lastDeedDate,
    lastSalePrice,
    lastMortgageAmount,
    mortgageDate,
    lenderName,
    ownerName,
    ownershipYears,
    mortgagePortfolioCount,
    fetchedAt: now,
  }
}
