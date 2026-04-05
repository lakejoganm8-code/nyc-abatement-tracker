import { getSocrataClient } from "./socrata"
import { DATASETS, ACRIS_DEED_TYPES, ACRIS_MORTGAGE_TYPES } from "@/lib/analysis/config"
import type { ACRISRecord } from "@/types"

/**
 * Fetch ACRIS deed + mortgage data for a single BBL.
 *
 * Join strategy:
 *   1. Query Legals (8h5j-fqxa) by BBL → get list of doc_ids for DEED and MTGE docs
 *   2. Query Master (bnx9-e6tj) by doc_id → get doc amounts, dates, doc_type
 *   3. Query Parties (636b-3b5g) by doc_id for mortgages → get lender name
 *
 * Returns null if no records found (flagged in output, not dropped).
 */
export async function getACRISData(bbl: string): Promise<ACRISRecord | null> {
  const client = getSocrataClient()
  const now = new Date().toISOString()

  // Parse BBL into boro/block/lot for ACRIS query format
  const clean = bbl.replace(/\D/g, "").padStart(10, "0")
  const boro = clean[0]
  const block = clean.slice(1, 6).replace(/^0+/, "") || "0"
  const lot = clean.slice(6, 10).replace(/^0+/, "") || "0"

  // ── Step 1: Get doc_ids from Legals ──────────────────────────────────────
  const targetDocTypes = [...ACRIS_DEED_TYPES, ...ACRIS_MORTGAGE_TYPES]
  const docTypeList = targetDocTypes.map((t) => `'${t}'`).join(",")

  const legals = await client.fetchAll(DATASETS.ACRIS_LEGALS, {
    $where: `borough='${boro}' AND block='${block}' AND lot='${lot}' AND doc_type IN (${docTypeList})`,
    $select: "document_id,doc_type",
    $limit: 500,
  }) as { document_id: string; doc_type: string }[]

  if (legals.length === 0) return null

  const docIds = [...new Set(legals.map((l) => l.document_id))]
  const docIdList = docIds.map((id) => `'${id}'`).join(",")

  // ── Step 2: Get master records ────────────────────────────────────────────
  const masterRows = await client.fetchAll(DATASETS.ACRIS_MASTER, {
    $where: `document_id IN (${docIdList})`,
    $select: "document_id,doc_type,doc_amount,good_through_date,recorded_datetime",
    $order: "recorded_datetime DESC",
    $limit: 500,
  }) as {
    document_id: string
    doc_type: string
    doc_amount: string
    good_through_date: string
    recorded_datetime: string
  }[]

  // ── Step 3: Split into deeds + mortgages ──────────────────────────────────
  const deedRows = masterRows.filter((r) =>
    ACRIS_DEED_TYPES.some((t) => r.doc_type?.toUpperCase().startsWith(t.split(",")[0].trim()))
  )
  const mortgageRows = masterRows.filter((r) =>
    ACRIS_MORTGAGE_TYPES.some((t) => r.doc_type?.toUpperCase().startsWith(t.split(",")[0].trim()))
  )

  // Most recent deed
  const latestDeed = deedRows[0] ?? null
  const lastDeedDate = latestDeed?.recorded_datetime?.split("T")[0] ?? null
  const lastSalePrice = latestDeed?.doc_amount ? parseFloat(latestDeed.doc_amount) || null : null

  // Ownership duration
  let ownershipYears: number | null = null
  if (lastDeedDate) {
    const deedYear = new Date(lastDeedDate).getFullYear()
    ownershipYears = new Date().getFullYear() - deedYear
  }

  // Most recent active mortgage (filter out satisfied ones)
  // Simple heuristic: take most recent mortgage by recorded date
  const latestMortgage = mortgageRows[0] ?? null
  const lastMortgageAmount = latestMortgage?.doc_amount
    ? parseFloat(latestMortgage.doc_amount) || null
    : null
  const mortgageDate = latestMortgage?.recorded_datetime?.split("T")[0] ?? null
  const mortgageDocId = latestMortgage?.document_id ?? null

  // ── Step 4: Get lender + owner names from Parties ────────────────────────
  let lenderName: string | null = null
  let ownerName: string | null = null

  const deedDocId = deedRows[0]?.document_id ?? null

  if (mortgageDocId) {
    const parties = await client.fetchAll(DATASETS.ACRIS_PARTIES, {
      $where: `document_id='${mortgageDocId}' AND party_type='2'`,  // party_type 2 = lender
      $select: "name",
      $limit: 5,
    }) as { name: string }[]
    lenderName = parties[0]?.name ?? null
  }

  if (deedDocId) {
    const parties = await client.fetchAll(DATASETS.ACRIS_PARTIES, {
      $where: `document_id='${deedDocId}' AND party_type='1'`,  // party_type 1 = grantee/owner
      $select: "name",
      $limit: 5,
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
    fetchedAt: now,
  }
}
