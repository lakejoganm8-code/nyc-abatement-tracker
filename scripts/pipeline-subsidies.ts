#!/usr/bin/env tsx
/**
 * NYC Abatement Tracker — Subsidy Programs Pipeline
 *
 * Fetches SCRIE/DRIE, Mitchell-Lama, HPD Affordable, LIHTC, and Section 8 data.
 * Runs monthly (1st of month, 4am UTC) — HUD/DOF files update infrequently.
 * Timeout budget: 60 minutes.
 *
 * Run locally: pnpm pipeline:subsidies
 */

import { config } from "dotenv"
config({ path: ".env.local" })
config()
import { createClient } from "@supabase/supabase-js"
import { fetchScrieDrie } from "@/lib/nyc/scrie-drie"
import { fetchMitchellLama } from "@/lib/nyc/mitchell-lama"
import { fetchHPDAffordable } from "@/lib/nyc/hpd-affordable"
import { fetchLIHTC } from "@/lib/nyc/hud-lihtc"
import { fetchSection8 } from "@/lib/nyc/hud-section8"
import type { PipelineRun } from "@/types"

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
  console.log("[pipeline:subsidies] Starting subsidy programs pipeline...")
  const start = Date.now()

  // Load target BBLs and PLUTO coords/addresses from DB
  const [{ data: exemptionRows }, { data: plutoRows }] = await Promise.all([
    supabase.from("exemptions").select("bbl").in("expiration_status", ["APPROACHING", "IN_PHASE_OUT"]),
    supabase.from("pluto_data").select("bbl, latitude, longitude, address"),
  ])

  const bbls = (exemptionRows ?? []).map((r: { bbl: string }) => r.bbl)
  console.log(`[pipeline:subsidies] ${bbls.length} target BBLs`)

  // Build PLUTO indexes
  const plutoCoords = new Map<string, { latitude: number; longitude: number }>()
  const plutoAddresses = new Map<string, string>()
  for (const row of plutoRows ?? []) {
    if (row.latitude && row.longitude) plutoCoords.set(row.bbl, { latitude: row.latitude, longitude: row.longitude })
    if (row.address) plutoAddresses.set(row.address.toUpperCase().trim(), row.bbl)
  }

  const subsidyRows: Record<string, unknown>[] = []

  // SCRIE + DRIE
  try {
    const scrieDrieMap = await fetchScrieDrie()
    console.log(`[pipeline:subsidies] SCRIE/DRIE: ${scrieDrieMap.size} BBLs`)
    for (const [bbl, r] of scrieDrieMap) {
      if (r.scrie_active_tenants > 0 || r.scrie_total_monthly_credit > 0) {
        subsidyRows.push({
          bbl, program: "SCRIE",
          scrie_active_tenants: r.scrie_active_tenants,
          scrie_total_monthly_credit: r.scrie_total_monthly_credit,
          is_active: r.scrie_active_tenants > 0,
          fetched_at: new Date().toISOString(),
        })
      }
      if (r.drie_active_tenants > 0 || r.drie_total_monthly_credit > 0) {
        subsidyRows.push({
          bbl, program: "DRIE",
          scrie_active_tenants: r.drie_active_tenants,
          scrie_total_monthly_credit: r.drie_total_monthly_credit,
          is_active: r.drie_active_tenants > 0,
          fetched_at: new Date().toISOString(),
        })
      }
    }
  } catch (err) {
    console.warn(`[pipeline:subsidies] SCRIE/DRIE failed (non-fatal): ${err}`)
  }

  // Mitchell-Lama
  try {
    const mlMap = await fetchMitchellLama()
    console.log(`[pipeline:subsidies] Mitchell-Lama: ${mlMap.size} buildings`)
    for (const [bbl, r] of mlMap) {
      subsidyRows.push({
        bbl, program: "MITCHELL_LAMA",
        program_detail: r.program_detail,
        is_active: !r.lifecycle || r.lifecycle.toUpperCase() === "ACTIVE",
        fetched_at: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.warn(`[pipeline:subsidies] Mitchell-Lama failed (non-fatal): ${err}`)
  }

  // HPD Affordable
  try {
    const hpdAffMap = await fetchHPDAffordable(bbls)
    console.log(`[pipeline:subsidies] HPD Affordable: ${hpdAffMap.size} buildings`)
    for (const [bbl, r] of hpdAffMap) {
      subsidyRows.push({
        bbl, program: "HPD_AFFORDABLE",
        hpd_project_id: r.hpd_project_id,
        hpd_extended_affordability: r.hpd_extended_affordability,
        ami_extremely_low: r.ami_extremely_low,
        ami_very_low: r.ami_very_low,
        ami_low: r.ami_low,
        ami_moderate: r.ami_moderate,
        ami_middle: r.ami_middle,
        units_assisted: r.total_affordable_units,
        start_date: r.project_start_date ?? null,
        is_active: true,
        fetched_at: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.warn(`[pipeline:subsidies] HPD Affordable failed (non-fatal): ${err}`)
  }

  // LIHTC
  try {
    const lihtcMap = await fetchLIHTC(plutoCoords)
    console.log(`[pipeline:subsidies] LIHTC: ${lihtcMap.size} buildings matched`)
    for (const [bbl, r] of lihtcMap) {
      subsidyRows.push({
        bbl, program: "LIHTC",
        units_assisted: r.li_units,
        lihtc_credit_year: r.yr_alloc,
        lihtc_compliance_end: r.compliance_end,
        start_date: r.yr_pis ? `${r.yr_pis}-01-01` : null,
        end_date: r.compliance_end ? `${r.compliance_end}-12-31` : null,
        is_active: !r.compliance_end || r.compliance_end >= new Date().getFullYear(),
        fetched_at: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.warn(`[pipeline:subsidies] LIHTC failed (non-fatal): ${err}`)
  }

  // Section 8
  try {
    const section8Map = await fetchSection8(plutoAddresses)
    console.log(`[pipeline:subsidies] Section 8: ${section8Map.size} buildings matched`)
    for (const [bbl, r] of section8Map) {
      subsidyRows.push({
        bbl, program: "SECTION_8",
        program_detail: r.program_type,
        hud_contract_number: r.contract_number,
        hud_contract_expiration: r.contract_expiration ?? null,
        units_assisted: r.assisted_units,
        end_date: r.contract_expiration ?? null,
        is_active: r.contract_status?.toUpperCase() === "ACTIVE",
        fetched_at: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.warn(`[pipeline:subsidies] Section 8 failed (non-fatal): ${err}`)
  }

  // Upsert all
  const tUpsert = Date.now()
  for (let i = 0; i < subsidyRows.length; i += UPSERT_BATCH) {
    const batch = subsidyRows.slice(i, i + UPSERT_BATCH)
    await withRetry(async () => {
      const { error } = await supabase.from("subsidy_programs").upsert(batch, { onConflict: "bbl,program" })
      if (error) throw new Error(`[subsidy_programs upsert] ${error.message}`)
    })
  }

  await logRun({ dataset: "subsidy_programs", rowsUpserted: subsidyRows.length, durationMs: Date.now() - start, status: "success" })
  console.log(`[pipeline:subsidies] ${subsidyRows.length} rows upserted in ${((Date.now() - start) / 1000).toFixed(1)}s`)
}

main().catch((err) => {
  console.error("[pipeline:subsidies] Fatal error:", err)
  process.exit(1)
})
