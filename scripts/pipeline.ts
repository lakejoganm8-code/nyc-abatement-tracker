#!/usr/bin/env tsx
/**
 * NYC Abatement Tracker — Data Pipeline
 *
 * Run locally:   pnpm pipeline
 * Run in CI:     same command, with env vars injected as GitHub secrets
 *
 * Steps:
 *   1. Fetch 421-a + J-51 exemptions from NYC Open Data
 *   2. Compute expiration dates + classify status
 *   3. Filter to target window (approaching/in-phase-out)
 *   4. Upsert exemptions table
 *   5. Fetch HPD + PLUTO in parallel
 *   6. Fetch ACRIS bulk (deed/mortgage for target BBLs)
 *   7. Fetch HCR rent stabilization registry
 *   8. Fetch eviction counts (via HPD registration IDs)
 *   9. Upsert all enrichment tables
 *  10. Compute distress scores + rent upside + deregulation risk
 *  11. Upsert property_scores
 *  12. Log runs to pipeline_runs
 */

import { config } from "dotenv"
config({ path: ".env.local" })
config() // fallback to .env for CI (GitHub Actions injects env vars directly)
import { createClient } from "@supabase/supabase-js"
import { fetchExemptions } from "@/lib/nyc/exemptions"
import { processExemptions } from "@/lib/analysis/expiration"
import { getHPDData } from "@/lib/nyc/hpd"
import { fetchPLUTOData } from "@/lib/nyc/pluto"
import { fetchACRISBulk } from "@/lib/nyc/acris-bulk"
// HCR dataset (8y9c-t29b) no longer available on NYC Open Data — skipped
import { fetchEvictionCounts } from "@/lib/nyc/evictions"
import { scoreAll } from "@/lib/analysis/scoring"
import { EXEMPTION_CODES_421A, EXEMPTION_CODES_J51 } from "@/lib/analysis/config"
import type { ExemptionRecord, HPDData, PLUTOData, ACRISRecord, PipelineRun } from "@/types"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

// ─── Upsert helpers ───────────────────────────────────────────────────────────

const UPSERT_BATCH = 100  // Small batches to avoid large POST bodies

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === retries - 1) throw err
      const delay = 2000 * (i + 1)
      console.warn(`[retry] Attempt ${i + 1} failed, retrying in ${delay}ms...`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw new Error("unreachable")
}

async function upsertExemptions(records: ExemptionRecord[]): Promise<number> {
  const rows = records.map((r) => ({
    bbl: r.bbl,
    address: r.address,
    borough: r.borough,
    exemption_code: r.exemptionCode,
    tax_year: r.taxYear,
    benefit_start_year: r.benefitStartYear,
    annual_exempt_amount: r.annualExemptAmount,
    assessed_value: r.assessedValue,
    building_class: r.buildingClass,
    benefit_type: r.benefitType?.label ?? null,
    expiration_year: r.expirationYear,
    phase_out_start_year: r.phaseOutStartYear,
    phase_out_end_year: r.phaseOutEndYear,
    expiration_status: r.expirationStatus,
    edge_case_flags: r.edgeCaseFlags,
    updated_at: new Date().toISOString(),
  }))

  let total = 0
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    let batchCount = 0
    await withRetry(async () => {
      const { error, count } = await supabase
        .from("exemptions")
        .upsert(batch, { onConflict: "bbl", count: "exact" })
      if (error) throw new Error(`[exemptions upsert] ${error.message}`)
      batchCount = count ?? batch.length
    })
    total += batchCount
  }
  return total
}

async function upsertHPD(hpdMap: Map<string, HPDData>): Promise<number> {
  const rows = Array.from(hpdMap.values()).map((h) => ({
    bbl: h.bbl,
    total_units: h.totalUnits,
    building_class: h.buildingClass,
    registration_status: h.registrationStatus,
    registration_id: h.registrationId,
    violation_count_12mo: h.violationCount12mo,
    eviction_count_12mo: h.evictionCount12mo,
    fetched_at: h.fetchedAt,
  }))

  let total = 0
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    let batchCount = 0
    await withRetry(async () => {
      const { error, count } = await supabase
        .from("hpd_data")
        .upsert(batch, { onConflict: "bbl", count: "exact" })
      if (error) throw new Error(`[hpd upsert] ${error.message}`)
      batchCount = count ?? batch.length
    })
    total += batchCount
  }
  return total
}

async function upsertPLUTO(plutoMap: Map<string, PLUTOData>): Promise<number> {
  const rows = Array.from(plutoMap.values()).map((p) => ({
    bbl: p.bbl,
    zoning: p.zoning,
    far: p.far,
    lot_area: p.lotArea,
    year_built: p.yearBuilt,
    neighborhood: p.neighborhood,
    latitude: p.latitude,
    longitude: p.longitude,
    address: p.address,
    total_units: p.totalUnits,
    fetched_at: p.fetchedAt,
  }))

  let total = 0
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    let batchCount = 0
    await withRetry(async () => {
      const { error, count } = await supabase
        .from("pluto_data")
        .upsert(batch, { onConflict: "bbl", count: "exact" })
      if (error) throw new Error(`[pluto upsert] ${error.message}`)
      batchCount = count ?? batch.length
    })
    total += batchCount
  }
  return total
}

async function upsertACRIS(acrisMap: Map<string, ACRISRecord>): Promise<number> {
  const rows = Array.from(acrisMap.values()).map((a) => ({
    bbl: a.bbl,
    last_deed_date: a.lastDeedDate,
    last_sale_price: a.lastSalePrice,
    last_mortgage_amount: a.lastMortgageAmount,
    mortgage_date: a.mortgageDate,
    lender_name: a.lenderName,
    owner_name: a.ownerName,
    ownership_years: a.ownershipYears,
    fetched_at: a.fetchedAt,
  }))

  let total = 0
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    let batchCount = 0
    await withRetry(async () => {
      const { error, count } = await supabase
        .from("acris_records")
        .upsert(batch, { onConflict: "bbl", count: "exact" })
      if (error) throw new Error(`[acris upsert] ${error.message}`)
      batchCount = count ?? batch.length
    })
    total += batchCount
  }
  return total
}

async function upsertStabilization(
  hcrMap: Map<string, boolean>,
  records: ExemptionRecord[]
): Promise<number> {
  const rows = records.map((r) => {
    const isInHCR = hcrMap.get(r.bbl) === true
    const is421a = EXEMPTION_CODES_421A.has(r.exemptionCode)
    const isJ51 = EXEMPTION_CODES_J51.has(r.exemptionCode)

    let stabilizationSource: string
    if (isInHCR) {
      stabilizationSource = "hcr_registered"
    } else if (is421a) {
      stabilizationSource = "421a_active"
    } else if (isJ51) {
      stabilizationSource = "j51_active"
    } else {
      stabilizationSource = "deregulated_risk"
    }

    return {
      bbl: r.bbl,
      is_rent_stabilized: stabilizationSource !== "deregulated_risk",
      stabilization_source: stabilizationSource,
    }
  })

  let total = 0
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    let batchCount = 0
    await withRetry(async () => {
      const { error, count } = await supabase
        .from("exemptions")
        .upsert(batch, { onConflict: "bbl", count: "exact" })
      if (error) throw new Error(`[stabilization upsert] ${error.message}`)
      batchCount = count ?? batch.length
    })
    total += batchCount
  }
  return total
}

async function upsertScores(scores: ReturnType<typeof scoreAll>): Promise<number> {
  const rows = scores.map((s) => ({
    bbl: s.bbl,
    distress_score: s.distressScore,
    tax_impact_component: s.components.taxImpact,
    time_component: s.components.timeToExpiration,
    debt_component: s.components.debtLoad,
    ownership_component: s.components.ownershipDuration,
    violation_component: s.components.violations,
    estimated_annual_rent_upside: s.estimatedAnnualRentUpside,
    deregulation_risk: s.deregulationRisk,
    ami_tier: s.amiTier,
    scored_at: s.scoredAt,
  }))

  let total = 0
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    let batchCount = 0
    await withRetry(async () => {
      const { error, count } = await supabase
        .from("property_scores")
        .upsert(batch, { onConflict: "bbl", count: "exact" })
      if (error) throw new Error(`[scores upsert] ${error.message}`)
      batchCount = count ?? batch.length
    })
    total += batchCount
  }
  return total
}

async function logRun(run: PipelineRun): Promise<void> {
  const { error } = await supabase.from("pipeline_runs").insert({
    dataset: run.dataset,
    rows_upserted: run.rowsUpserted,
    duration_ms: run.durationMs,
    status: run.status,
    error: run.error ?? null,
  })
  if (error) console.warn(`[pipeline_runs] Failed to log run: ${error.message}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[pipeline] Starting NYC Abatement Tracker data pipeline...")
  const pipelineStart = Date.now()

  // Step 1: Fetch exemptions
  let rawRows: Awaited<ReturnType<typeof fetchExemptions>>
  try {
    rawRows = await fetchExemptions()
  } catch (err) {
    await logRun({ dataset: "exemptions", rowsUpserted: 0, durationMs: Date.now() - pipelineStart, status: "error", error: String(err) })
    throw err
  }

  // Step 2: Compute expiration
  console.log("[pipeline] Computing expiration dates...")
  const allProcessed = processExemptions(rawRows)
  console.log(`[pipeline] Processed ${allProcessed.length} unique BBLs`)

  const targetRecords = allProcessed.filter(
    (r) => r.expirationStatus === "APPROACHING" || r.expirationStatus === "IN_PHASE_OUT"
  )
  console.log(`[pipeline] ${targetRecords.length} properties in target window`)

  const t2 = Date.now()
  const exemptCount = await upsertExemptions(targetRecords)
  await logRun({ dataset: "exemptions", rowsUpserted: exemptCount, durationMs: Date.now() - t2, status: "success" })
  console.log(`[pipeline] Upserted ${exemptCount} exemption records`)

  const bbls = targetRecords.map((r) => r.bbl)

  // Step 3: HPD + PLUTO in parallel
  console.log(`[pipeline] Fetching HPD + PLUTO for ${bbls.length} BBLs...`)
  const t3 = Date.now()
  const [hpdMap, plutoMap] = await Promise.all([
    getHPDData(bbls),
    fetchPLUTOData(bbls),
  ])
  console.log(`[pipeline] HPD: ${hpdMap.size} records, PLUTO: ${plutoMap.size} records`)

  // Step 3.5: ACRIS bulk — prioritize properties expiring soonest (next 24 months)
  // ACRIS data changes rarely; cap at 5000 BBLs per run to stay within time budget
  const ACRIS_MAX_BBLS = 5000
  const currentYear = new Date().getFullYear()
  const acrisPriorityBBLs = targetRecords
    .filter((r) => r.expirationYear != null && r.expirationYear <= currentYear + 2)
    .map((r) => r.bbl)
  const bblsNeedingACRIS = acrisPriorityBBLs.slice(0, ACRIS_MAX_BBLS)
  console.log(`[pipeline] Fetching ACRIS bulk for ${bblsNeedingACRIS.length} BBLs (priority: expiring ≤ ${currentYear + 2})...`)
  const t35 = Date.now()
  const acrisMap = await fetchACRISBulk(bblsNeedingACRIS)
  const acrisCount = await upsertACRIS(acrisMap)
  await logRun({ dataset: "acris", rowsUpserted: acrisCount, durationMs: Date.now() - t35, status: "success" })
  console.log(`[pipeline] Upserted ${acrisCount} ACRIS records (${acrisMap.size} BBLs matched)`)

  // Step 3.6: Stabilization classification (no HCR registry — classify by exemption type)
  const t36s = Date.now()
  const stabCount = await upsertStabilization(new Map(), targetRecords)
  console.log(`[pipeline] Stabilization: ${stabCount} records classified (${Date.now() - t36s}ms)`)

  // Step 3.7: Eviction counts (matched by BBL directly)
  console.log(`[pipeline] Fetching eviction counts for ${bbls.length} BBLs...`)
  const t36 = Date.now()
  const evictionMap = await fetchEvictionCounts(bbls)
  for (const [bbl, hpd] of hpdMap) {
    if (evictionMap.has(bbl)) {
      hpdMap.set(bbl, { ...hpd, evictionCount12mo: evictionMap.get(bbl) ?? 0 })
    }
  }
  console.log(`[pipeline] Evictions: ${evictionMap.size} buildings with filings in last 12mo (${Date.now() - t36}ms)`)

  // Upsert HPD + PLUTO (after eviction counts merged in)
  const [hpdCount, plutoCount] = await Promise.all([
    upsertHPD(hpdMap),
    upsertPLUTO(plutoMap),
  ])
  await logRun({ dataset: "hpd+pluto", rowsUpserted: hpdCount + plutoCount, durationMs: Date.now() - t3, status: "success" })
  console.log(`[pipeline] Upserted ${hpdCount} HPD + ${plutoCount} PLUTO records`)

  // Step 4: Scores (now with ACRIS + PLUTO data — fixes the empty-map bug)
  console.log("[pipeline] Computing distress scores...")
  const t4 = Date.now()
  const scores = scoreAll(targetRecords, hpdMap, acrisMap, plutoMap)
  const scoreCount = await upsertScores(scores)
  await logRun({ dataset: "scores", rowsUpserted: scoreCount, durationMs: Date.now() - t4, status: "success" })
  console.log(`[pipeline] Upserted ${scoreCount} score records`)

  console.log("\n[pipeline] Top 5 by distress score:")
  scores.slice(0, 5).forEach((s, i) => {
    const e = targetRecords.find((r) => r.bbl === s.bbl)
    console.log(
      `  ${i + 1}. ${e?.address ?? s.bbl} — score: ${s.distressScore}` +
      ` | upside: ${s.estimatedAnnualRentUpside ? `$${(s.estimatedAnnualRentUpside / 1000).toFixed(0)}k/yr` : "N/A"}` +
      ` | dereg: ${s.deregulationRisk ?? "?"}`
    )
  })

  console.log(`\n[pipeline] Done in ${((Date.now() - pipelineStart) / 1000).toFixed(1)}s`)
}

main().catch((err) => {
  console.error("[pipeline] Fatal error:", err)
  process.exit(1)
})
