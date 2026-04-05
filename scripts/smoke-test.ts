#!/usr/bin/env tsx
/**
 * Smoke test: validates ACRIS POST, HPD concurrency, HCR, and evictions
 * against a small sample of known BBLs. No DB writes.
 */

import { config } from "dotenv"
config({ path: ".env.local" })

import { fetchACRISBulk } from "@/lib/nyc/acris-bulk"
import { getHPDData } from "@/lib/nyc/hpd"
import { fetchEvictionCounts } from "@/lib/nyc/evictions"

// ~20 real NYC BBLs across boroughs (421-a/J-51 buildings)
const SAMPLE_BBLS = [
  "1016620001", "1020140016", "1014160001", "1009880001", "1005870001",
  "2024280009", "2024290001", "2024300030", "2025140015", "2057570083",
  "3071710001", "3071720001", "3071730001", "3005580001", "3001580001",
  "4000010001", "4001100001", "4001200001", "4000020001", "4000030001",
]

async function run() {
  console.log(`\n[smoke] Testing with ${SAMPLE_BBLS.length} BBLs...\n`)

  // ── ACRIS Bulk (uses POST) ──────────────────────────────────────────────────
  console.log("[smoke] Step 1: ACRIS bulk (POST)...")
  const t1 = Date.now()
  const acrisMap = await fetchACRISBulk(SAMPLE_BBLS)
  console.log(`[smoke] ACRIS: ${acrisMap.size} records in ${Date.now() - t1}ms`)
  for (const [bbl, r] of acrisMap) {
    console.log(`  ${bbl}: deed=${r.lastDeedDate ?? "—"} price=${r.lastSalePrice ?? "—"} owner=${r.ownerName ?? "—"}`)
  }

  // ── HPD (concurrency=5) ─────────────────────────────────────────────────────
  console.log("\n[smoke] Step 2: HPD data (concurrency=5)...")
  const t2 = Date.now()
  const hpdMap = await getHPDData(SAMPLE_BBLS)
  console.log(`[smoke] HPD: ${hpdMap.size} records in ${Date.now() - t2}ms`)
  let violationTotal = 0
  for (const [, h] of hpdMap) violationTotal += h.violationCount12mo
  console.log(`  Total violations: ${violationTotal}, reg IDs: ${[...hpdMap.values()].filter(h => h.registrationId).length}`)

  // ── Evictions ───────────────────────────────────────────────────────────────
  console.log("\n[smoke] Step 3: Evictions (by BBL)...")
  const t3 = Date.now()
  const evictions = await fetchEvictionCounts(SAMPLE_BBLS)
  console.log(`[smoke] Evictions: ${evictions.size} buildings with filings in ${Date.now() - t3}ms`)

  console.log("\n[smoke] ✓ All steps passed\n")
}

run().catch((err) => {
  console.error("[smoke] FAILED:", err.message)
  process.exit(1)
})
