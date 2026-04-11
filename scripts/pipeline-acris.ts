#!/usr/bin/env tsx
/**
 * NYC Abatement Tracker — ACRIS Pipeline
 *
 * Fetches deed/mortgage records from ACRIS for all target-window BBLs.
 * Runs weekly (Mon 3am UTC), independently of the core pipeline.
 * Timeout budget: 120 minutes.
 *
 * Run locally: pnpm pipeline:acris
 */

import { config } from "dotenv"
config({ path: ".env.local" })
config()
import { createClient } from "@supabase/supabase-js"
import { fetchExemptions } from "@/lib/nyc/exemptions"
import { processExemptions } from "@/lib/analysis/expiration"
import { fetchACRISBatch, ACRIS_SUPER_WAVE } from "@/lib/nyc/acris-bulk"
import type { ACRISRecord, PipelineRun } from "@/types"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const UPSERT_BATCH = 100

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
    mortgage_portfolio_count: a.mortgagePortfolioCount ?? null,
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

async function main() {
  console.log("[pipeline:acris] Starting ACRIS fetch...")
  const start = Date.now()

  // Get current target BBLs from exemptions (already in DB from last core run)
  // Fall back to re-fetching exemptions if needed
  const { data: exemptionRows, error } = await supabase
    .from("exemptions")
    .select("bbl")
    .in("expiration_status", ["APPROACHING", "IN_PHASE_OUT"])
  if (error) throw new Error(`[acris] Failed to load BBLs from exemptions: ${error.message}`)

  const bbls = (exemptionRows ?? []).map((r: { bbl: string }) => r.bbl)
  console.log(`[pipeline:acris] Fetching ACRIS for ${bbls.length} BBLs...`)

  const acrisMap = new Map<string, ACRISRecord>()
  let acrisTotal = 0
  const t = Date.now()

  for (let i = 0; i < bbls.length; i += ACRIS_SUPER_WAVE) {
    const batch = bbls.slice(i, i + ACRIS_SUPER_WAVE)
    const batchMap = await fetchACRISBatch(batch)
    const batchCount = await upsertACRIS(batchMap)
    acrisTotal += batchCount
    for (const [bbl, rec] of batchMap) acrisMap.set(bbl, rec)
    if ((i / ACRIS_SUPER_WAVE) % 5 === 0) {
      console.log(`[pipeline:acris] Batch ${Math.floor(i / ACRIS_SUPER_WAVE) + 1}/${Math.ceil(bbls.length / ACRIS_SUPER_WAVE)}: ${acrisMap.size} matched`)
    }
  }

  await logRun({ dataset: "acris", rowsUpserted: acrisTotal, durationMs: Date.now() - t, status: "success" })
  console.log(`[pipeline:acris] Done: ${acrisTotal} records upserted in ${((Date.now() - start) / 1000).toFixed(1)}s`)
}

main().catch((err) => {
  console.error("[pipeline:acris] Fatal error:", err)
  process.exit(1)
})
