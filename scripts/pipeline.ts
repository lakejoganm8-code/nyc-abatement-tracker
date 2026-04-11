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
import { fetchHPDContacts } from "@/lib/nyc/hpd-contacts"
import { fetchPLUTOData } from "@/lib/nyc/pluto"
import { fetchACRISBatch, fetchACRISBulk, ACRIS_SUPER_WAVE } from "@/lib/nyc/acris-bulk"
// HCR dataset (8y9c-t29b) no longer available on NYC Open Data — skipped
import { fetchEvictionCounts } from "@/lib/nyc/evictions"
import { fetchTaxLienBBLs } from "@/lib/nyc/tax-liens"
import { fetchDOBViolationCounts } from "@/lib/nyc/dob-violations"
import { fetchHousingCourtCounts } from "@/lib/nyc/housing-court"
import { fetchDOFMarketValues } from "@/lib/nyc/dof-assessment"
import { fetchDOSEntityInfo } from "@/lib/nyc/ny-dos"
import { fetchRegAgreements, type RegAgreement } from "@/lib/nyc/hpd-reg-agreements"
import { scoreAll, type ScoringExtra } from "@/lib/analysis/scoring"
import { EXEMPTION_CODES_421A, EXEMPTION_CODES_J51 } from "@/lib/analysis/config"
import type { ExemptionRecord, HPDData, PLUTOData, ACRISRecord, PipelineRun } from "@/types"
import type { HPDContact } from "@/lib/nyc/hpd-contacts"

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
    condo_unit_count: r.condoUnitCount ?? null,
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

async function upsertDOSEntities(dosMap: Map<string, import("@/lib/nyc/ny-dos").DOSEntityInfo>): Promise<number> {
  const rows = Array.from(dosMap.values()).map((d) => ({
    bbl: d.bbl,
    dos_entity_status: d.entityStatus,
    dos_agent_name: d.registeredAgentName,
    dos_agent_address: d.registeredAgentAddress,
    dos_search_url: d.dosSearchUrl,
    dos_date_of_formation: d.dateOfFormation,
    fetched_at: new Date().toISOString(),
  }))

  let total = 0
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    let batchCount = 0
    await withRetry(async () => {
      const { error, count } = await supabase
        .from("acris_records")
        .upsert(batch, { onConflict: "bbl", count: "exact" })
      if (error) throw new Error(`[dos upsert] ${error.message}`)
      batchCount = count ?? batch.length
    })
    total += batchCount
  }
  return total
}

async function upsertHPDContacts(contactMap: Map<string, HPDContact>): Promise<number> {
  const rows = Array.from(contactMap.values()).map((c) => ({
    bbl: c.bbl,
    registration_id: c.registrationId,
    owner_name: c.ownerName,
    owner_type: c.ownerType,
    owner_mailing_address: c.ownerMailingAddress,
    agent_name: c.agentName,
    agent_address: c.agentAddress,
    fetched_at: new Date().toISOString(),
  }))

  let total = 0
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    let batchCount = 0
    await withRetry(async () => {
      const { error, count } = await supabase
        .from("hpd_contacts")
        .upsert(batch, { onConflict: "bbl", count: "exact" })
      if (error) throw new Error(`[hpd_contacts upsert] ${error.message}`)
      batchCount = count ?? batch.length
    })
    total += batchCount
  }
  return total
}

async function upsertDistressEnrichment(
  records: ExemptionRecord[],
  taxLienSet: Set<string>,
  dobMap: Map<string, number>,
  courtMap: Map<string, { hpActions: number; nonpaymentCases: number }>,
  dofMap: Map<string, number>
): Promise<void> {
  // Update exemptions table with distress fields; also update acris_records with dof_market_value
  const exemptionRows = records
    .filter((r) => taxLienSet.has(r.bbl) || dobMap.has(r.bbl) || courtMap.has(r.bbl))
    .map((r) => ({
      bbl: r.bbl,
      has_tax_lien: taxLienSet.has(r.bbl),
      dob_violation_count: dobMap.get(r.bbl) ?? 0,
      hp_action_count: courtMap.get(r.bbl)?.hpActions ?? 0,
      nonpayment_count: courtMap.get(r.bbl)?.nonpaymentCases ?? 0,
    }))

  for (let i = 0; i < exemptionRows.length; i += UPSERT_BATCH) {
    const batch = exemptionRows.slice(i, i + UPSERT_BATCH)
    await withRetry(async () => {
      const { error } = await supabase
        .from("exemptions")
        .upsert(batch, { onConflict: "bbl" })
      if (error) throw new Error(`[distress enrichment upsert] ${error.message}`)
    })
  }

  // Update acris_records with DOF market value
  const dofRows = Array.from(dofMap.entries()).map(([bbl, val]) => ({
    bbl,
    dof_market_value: val,
    fetched_at: new Date().toISOString(),
  }))
  for (let i = 0; i < dofRows.length; i += UPSERT_BATCH) {
    const batch = dofRows.slice(i, i + UPSERT_BATCH)
    await withRetry(async () => {
      const { error } = await supabase
        .from("acris_records")
        .upsert(batch, { onConflict: "bbl" })
      if (error) throw new Error(`[dof_market_value upsert] ${error.message}`)
    })
  }
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
    tax_lien_component: s.components.taxLien,
    housing_court_component: s.components.housingCourt,
    estimated_annual_rent_upside: s.estimatedAnnualRentUpside,
    deregulation_risk: s.deregulationRisk,
    ami_tier: s.amiTier,
    scored_at: s.scoredAt,
    // Valuation
    gross_rent_estimate: s.grossRentEstimate,
    noi_current: s.noiCurrent,
    noi_post_expiration: s.noiPostExpiration,
    implied_value_current: s.impliedValueCurrent,
    implied_value_post_expiration: s.impliedValuePostExpiration,
    value_delta: s.valueDelta,
    break_even_occupancy: s.breakEvenOccupancy,
    // Owner profile
    owner_type: s.ownerType,
    portfolio_size: s.portfolioSize,
    total_portfolio_tax_shock: s.totalPortfolioTaxShock,
    refi_pressure: s.refiPressure,
    sell_likelihood_score: s.sellLikelihoodScore,
    sell_likelihood_label: s.sellLikelihoodLabel,
    sell_signals: s.sellSignals,
    suppress_from_leads: s.suppressFromLeads,
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
  const condoParents = targetRecords.filter((r) => r.condoUnitCount !== null).length
  const totalCondoUnits = targetRecords.reduce((s, r) => s + (r.condoUnitCount ?? 0), 0)
  console.log(`[pipeline] ${targetRecords.length} properties in target window (${condoParents} condo buildings, ${totalCondoUnits} units collapsed)`)

  const t2 = Date.now()
  const exemptCount = await upsertExemptions(targetRecords)
  await logRun({ dataset: "exemptions", rowsUpserted: exemptCount, durationMs: Date.now() - t2, status: "success" })
  console.log(`[pipeline] Upserted ${exemptCount} exemption records`)

  const bbls = targetRecords.map((r) => r.bbl)
  const currentYear = new Date().getFullYear()

  // Priority BBLs: expiring soonest — used for evictions, DOB, tax liens, housing court, DOS
  const PRIORITY_MAX = 5000
  const priorityBBLs = targetRecords
    .filter((r) => r.expirationYear != null && r.expirationYear <= currentYear + 2)
    .map((r) => r.bbl)
    .slice(0, PRIORITY_MAX)

  // Step 3: ACRIS bulk — fetch ALL target BBLs for full DB coverage
  // Incremental per-batch upserts so progress is saved even if pipeline is interrupted
  console.log(`[pipeline] Fetching ACRIS for all ${bbls.length} target BBLs...`)
  const t35 = Date.now()
  const acrisMap = new Map<string, import("@/types").ACRISRecord>()
  let acrisTotal = 0
  for (let i = 0; i < bbls.length; i += ACRIS_SUPER_WAVE) {
    const batch = bbls.slice(i, i + ACRIS_SUPER_WAVE)
    const batchMap = await fetchACRISBatch(batch)
    const batchCount = await upsertACRIS(batchMap)
    acrisTotal += batchCount
    for (const [bbl, rec] of batchMap) acrisMap.set(bbl, rec)
    if ((i / ACRIS_SUPER_WAVE) % 10 === 0) {
      console.log(`[pipeline] ACRIS batch ${Math.floor(i / ACRIS_SUPER_WAVE) + 1}/${Math.ceil(bbls.length / ACRIS_SUPER_WAVE)}: ${acrisMap.size} matched so far`)
    }
  }
  await logRun({ dataset: "acris", rowsUpserted: acrisTotal, durationMs: Date.now() - t35, status: "success" })
  console.log(`[pipeline] ACRIS complete: ${acrisTotal} records upserted (${Date.now() - t35}ms)`)

  // Step 3.5: HPD + PLUTO in parallel (all target BBLs)
  console.log(`[pipeline] Fetching HPD + PLUTO for ${bbls.length} BBLs...`)
  const t3 = Date.now()
  const [hpdMap, plutoMap] = await Promise.all([
    getHPDData(bbls),
    fetchPLUTOData(bbls),
  ])
  console.log(`[pipeline] HPD: ${hpdMap.size} records, PLUTO: ${plutoMap.size} records`)

  // Step 3.6: Stabilization classification
  const t36s = Date.now()
  const stabCount = await upsertStabilization(new Map(), targetRecords)
  console.log(`[pipeline] Stabilization: ${stabCount} records classified (${Date.now() - t36s}ms)`)

  // Step 3.7: Eviction counts (priority BBLs only)
  console.log(`[pipeline] Fetching eviction counts for ${priorityBBLs.length} priority BBLs...`)
  const t36 = Date.now()
  const evictionMap = await fetchEvictionCounts(priorityBBLs)
  for (const bbl of priorityBBLs) {
    const hpd = hpdMap.get(bbl)
    if (hpd && evictionMap.has(bbl)) {
      hpdMap.set(bbl, { ...hpd, evictionCount12mo: evictionMap.get(bbl) ?? 0 })
    }
  }
  console.log(`[pipeline] Evictions: ${evictionMap.size} buildings with filings (${Date.now() - t36}ms)`)

  // Upsert HPD + PLUTO (after eviction counts merged in)
  const [hpdCount, plutoCount] = await Promise.all([
    upsertHPD(hpdMap),
    upsertPLUTO(plutoMap),
  ])
  await logRun({ dataset: "hpd+pluto", rowsUpserted: hpdCount + plutoCount, durationMs: Date.now() - t3, status: "success" })
  console.log(`[pipeline] Upserted ${hpdCount} HPD + ${plutoCount} PLUTO records`)

  // Step 4: Phase B — HPD Registration Contacts (owner/agent phone + address)
  console.log("[pipeline] Fetching HPD Registration Contacts...")
  const tContacts = Date.now()
  const regIdToBBL = new Map<string, string>()
  for (const [bbl, hpd] of hpdMap) {
    if (hpd.registrationId) regIdToBBL.set(hpd.registrationId, bbl)
  }
  const contactMap = await fetchHPDContacts(regIdToBBL)
  const contactCount = await upsertHPDContacts(contactMap)
  await logRun({ dataset: "hpd_contacts", rowsUpserted: contactCount, durationMs: Date.now() - tContacts, status: "success" })
  console.log(`[pipeline] HPD Contacts: ${contactCount} records (${Date.now() - tContacts}ms)`)

  // Step 5: Phase C — Tax liens, DOB violations, Housing court (priority BBLs, non-fatal)
  let taxLienSet = new Set<string>()
  let dobMap = new Map<string, number>()
  let courtMap = new Map<string, { hpActions: number; nonpaymentCases: number }>()
  const tPhaseC = Date.now()
  try {
    console.log("[pipeline] Fetching Phase C distress signals (tax liens, DOB, housing court)...")
    const results = await Promise.allSettled([
      fetchTaxLienBBLs(priorityBBLs),
      fetchDOBViolationCounts(priorityBBLs),
      fetchHousingCourtCounts(priorityBBLs),
    ])
    if (results[0].status === "fulfilled") taxLienSet = results[0].value
    else console.warn(`[pipeline] Tax liens failed: ${results[0].reason}`)
    if (results[1].status === "fulfilled") dobMap = results[1].value
    else console.warn(`[pipeline] DOB violations failed: ${results[1].reason}`)
    if (results[2].status === "fulfilled") courtMap = results[2].value
    else console.warn(`[pipeline] Housing court failed: ${results[2].reason}`)
    console.log(`[pipeline] Tax liens: ${taxLienSet.size}, DOB: ${dobMap.size} BBLs, Court: ${courtMap.size} BBLs (${Date.now() - tPhaseC}ms)`)
  } catch (err) {
    console.warn(`[pipeline] Phase C distress signals failed (non-fatal): ${err}`)
  }

  // Step 6: Phase D — DOF market values (priority BBLs, non-fatal)
  let dofMap = new Map<string, number>()
  try {
    console.log("[pipeline] Fetching DOF market values...")
    const tDOF = Date.now()
    dofMap = await fetchDOFMarketValues(priorityBBLs)
    console.log(`[pipeline] DOF market values: ${dofMap.size} records (${Date.now() - tDOF}ms)`)
  } catch (err) {
    console.warn(`[pipeline] DOF market values failed (non-fatal): ${err}`)
  }

  // Step 6.4: Regulatory agreements (421-a affordable buildings, non-fatal)
  let regMap = new Map<string, RegAgreement>()
  try {
    console.log("[pipeline] Fetching HPD regulatory agreements from ACRIS...")
    const tReg = Date.now()
    regMap = await fetchRegAgreements(priorityBBLs)
    if (regMap.size > 0) {
      const regRows = Array.from(regMap.values()).map((r) => ({
        bbl: r.bbl,
        reg_agreement_doc_id: r.docId,
        reg_agreement_doc_type: r.docType,
        reg_agreement_date: r.documentDate,
        reg_agreement_url: r.acrisUrl,
        has_affordable_commitment: true,
        fetched_at: new Date().toISOString(),
      }))
      for (let i = 0; i < regRows.length; i += UPSERT_BATCH) {
        const batch = regRows.slice(i, i + UPSERT_BATCH)
        await withRetry(async () => {
          const { error } = await supabase.from("acris_records").upsert(batch, { onConflict: "bbl" })
          if (error) throw new Error(`[reg_agreements upsert] ${error.message}`)
        })
      }
    }
    console.log(`[pipeline] Regulatory agreements: ${regMap.size} found (${Date.now() - tReg}ms)`)
  } catch (err) {
    console.warn(`[pipeline] Regulatory agreements failed (non-fatal): ${err}`)
  }

  // Step 6.5: Phase E — NY DOS LLC entity lookup (non-fatal)
  try {
    console.log("[pipeline] Fetching NY DOS entity info for LLC-owned properties...")
    const tDOS = Date.now()
    const ownersByBBL = new Map<string, string>()
    for (const [bbl, acris] of acrisMap) {
      if (acris.ownerName) ownersByBBL.set(bbl, acris.ownerName)
    }
    const dosMap = await fetchDOSEntityInfo(ownersByBBL)
    if (dosMap.size > 0) await upsertDOSEntities(dosMap)
    console.log(`[pipeline] DOS entity lookup: ${dosMap.size} records (${Date.now() - tDOS}ms)`)
  } catch (err) {
    console.warn(`[pipeline] DOS entity lookup failed (non-fatal): ${err}`)
  }

  // Upsert distress enrichment (exemptions + acris_records updates)
  await upsertDistressEnrichment(targetRecords, taxLienSet, dobMap, courtMap, dofMap)
  await logRun({ dataset: "distress_enrichment", rowsUpserted: taxLienSet.size + dobMap.size + courtMap.size, durationMs: Date.now() - tPhaseC, status: "success" })

  // Build extraMap for scoring
  const extraMap = new Map<string, ScoringExtra>()
  for (const bbl of priorityBBLs) {
    const court = courtMap.get(bbl)
    extraMap.set(bbl, {
      hasLien: taxLienSet.has(bbl),
      dobViolationCount: dobMap.get(bbl) ?? 0,
      hpActionCount: court?.hpActions ?? 0,
      nonpaymentCount: court?.nonpaymentCases ?? 0,
      dofMarketValue: dofMap.get(bbl) ?? null,
    })
  }

  // Step 7: Scores (now with all enrichment data)
  console.log("[pipeline] Computing distress scores...")
  const t4 = Date.now()
  const scores = scoreAll(targetRecords, hpdMap, acrisMap, plutoMap, extraMap)
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
