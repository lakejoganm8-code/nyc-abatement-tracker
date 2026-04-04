#!/usr/bin/env tsx
/**
 * NYC Abatement Tracker — Data Pipeline
 *
 * Run locally:   npx tsx scripts/pipeline.ts
 * Run in CI:     same command, with env vars injected as GitHub secrets
 *
 * Steps:
 *   1. Fetch 421-a + J-51 exemptions from NYC Open Data
 *   2. Compute expiration dates + classify status
 *   3. Filter to target window (approaching/in-phase-out)
 *   4. Upsert exemptions table in Supabase
 *   5. Fetch HPD data for all target BBLs
 *   6. Upsert hpd_data table
 *   7. Compute distress scores
 *   8. Upsert property_scores table
 *   9. Log run to pipeline_runs
 */

import "dotenv/config"
import { createClient } from "@supabase/supabase-js"
import { fetchExemptions } from "@/lib/nyc/exemptions"
import { processExemptions } from "@/lib/analysis/expiration"
import { getHPDData } from "@/lib/nyc/hpd"
import { scoreAll } from "@/lib/analysis/scoring"
import type { ExemptionRecord, HPDData, PipelineRun } from "@/types"

// ─── Supabase service client ──────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

// ─── Upsert helpers ───────────────────────────────────────────────────────────

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

  const { error, count } = await supabase
    .from("exemptions")
    .upsert(rows, { onConflict: "bbl", count: "exact" })

  if (error) throw new Error(`[exemptions upsert] ${error.message}`)
  return count ?? rows.length
}

async function upsertHPD(hpdMap: Map<string, HPDData>): Promise<number> {
  const rows = Array.from(hpdMap.values()).map((h) => ({
    bbl: h.bbl,
    total_units: h.totalUnits,
    building_class: h.buildingClass,
    registration_status: h.registrationStatus,
    violation_count_12mo: h.violationCount12mo,
    fetched_at: h.fetchedAt,
  }))

  const { error, count } = await supabase
    .from("hpd_data")
    .upsert(rows, { onConflict: "bbl", count: "exact" })

  if (error) throw new Error(`[hpd upsert] ${error.message}`)
  return count ?? rows.length
}

async function upsertScores(
  scores: ReturnType<typeof scoreAll>
): Promise<number> {
  const rows = scores.map((s) => ({
    bbl: s.bbl,
    distress_score: s.distressScore,
    tax_impact_component: s.components.taxImpact,
    time_component: s.components.timeToExpiration,
    debt_component: s.components.debtLoad,
    ownership_component: s.components.ownershipDuration,
    violation_component: s.components.violations,
    scored_at: s.scoredAt,
  }))

  const { error, count } = await supabase
    .from("property_scores")
    .upsert(rows, { onConflict: "bbl", count: "exact" })

  if (error) throw new Error(`[scores upsert] ${error.message}`)
  return count ?? rows.length
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

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function main() {
  console.log("[pipeline] Starting NYC Abatement Tracker data pipeline...")
  const pipelineStart = Date.now()

  // ── Step 1: Fetch exemptions ──────────────────────────────────────────────
  let rawRows: Awaited<ReturnType<typeof fetchExemptions>>
  try {
    rawRows = await fetchExemptions()
  } catch (err) {
    await logRun({ dataset: "exemptions", rowsUpserted: 0, durationMs: Date.now() - pipelineStart, status: "error", error: String(err) })
    throw err
  }

  // ── Step 2: Process + compute expiration ─────────────────────────────────
  console.log("[pipeline] Computing expiration dates...")
  const allProcessed = processExemptions(rawRows)
  console.log(`[pipeline] Processed ${allProcessed.length} unique BBLs`)

  // Include both APPROACHING and IN_PHASE_OUT
  const targetRecords = allProcessed.filter(
    (r) => r.expirationStatus === "APPROACHING" || r.expirationStatus === "IN_PHASE_OUT"
  )
  console.log(`[pipeline] ${targetRecords.length} properties in target window`)

  // Also store FUTURE records (for trending) but mark clearly
  // For v1, only upsert target records to keep data lean
  const t2 = Date.now()
  const exemptCount = await upsertExemptions(targetRecords)
  await logRun({ dataset: "exemptions", rowsUpserted: exemptCount, durationMs: Date.now() - t2, status: "success" })
  console.log(`[pipeline] Upserted ${exemptCount} exemption records`)

  // ── Step 3: HPD data ──────────────────────────────────────────────────────
  const bbls = targetRecords.map((r) => r.bbl)
  console.log(`[pipeline] Fetching HPD data for ${bbls.length} BBLs...`)
  const t3 = Date.now()
  const hpdMap = await getHPDData(bbls)
  const hpdCount = await upsertHPD(hpdMap)
  await logRun({ dataset: "hpd", rowsUpserted: hpdCount, durationMs: Date.now() - t3, status: "success" })
  console.log(`[pipeline] Upserted ${hpdCount} HPD records`)

  // ── Step 4: Scores ────────────────────────────────────────────────────────
  console.log("[pipeline] Computing distress scores...")
  const t4 = Date.now()
  // ACRIS not available at pipeline time (fetched per-property on demand)
  const scores = scoreAll(targetRecords, hpdMap, new Map())
  const scoreCount = await upsertScores(scores)
  await logRun({ dataset: "scores", rowsUpserted: scoreCount, durationMs: Date.now() - t4, status: "success" })
  console.log(`[pipeline] Upserted ${scoreCount} score records`)

  // Top 5 preview
  console.log("\n[pipeline] Top 5 by distress score:")
  scores.slice(0, 5).forEach((s, i) => {
    const e = targetRecords.find((r) => r.bbl === s.bbl)
    console.log(`  ${i + 1}. ${e?.address ?? s.bbl} — score: ${s.distressScore}`)
  })

  const totalMs = Date.now() - pipelineStart
  console.log(`\n[pipeline] Done in ${(totalMs / 1000).toFixed(1)}s`)
}

main().catch((err) => {
  console.error("[pipeline] Fatal error:", err)
  process.exit(1)
})
