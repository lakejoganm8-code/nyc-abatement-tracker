import { config } from "dotenv"
config({ path: ".env.local" })
import { fetchACRISBatch } from "@/lib/nyc/acris-bulk"

const TEST_BBLS = [
  "3017690078", "1019140042", "1019170054", "1019170056",
  "1019270010", "1018280157", "2025620070", "1020800140", "1020830063"
]

async function run() {
  console.log(`Testing ${TEST_BBLS.length} BBLs from actual target window...`)
  const result = await fetchACRISBatch(TEST_BBLS)
  console.log(`Got ${result.size} ACRIS records back`)
  for (const [bbl, r] of result) {
    console.log(`  ${bbl}: deed=${r.lastDeedDate} price=${r.lastSalePrice} owner=${r.ownerName}`)
  }
  if (result.size === 0) {
    console.log('ZERO results — checking Legals directly...')
    // Test raw legals query for first BBL
    const bbl = TEST_BBLS[0]
    const boro = bbl[0]
    const block = String(parseInt(bbl.slice(1, 6)))
    const lot = String(parseInt(bbl.slice(6)))
    const url = `https://data.cityofnewyork.us/resource/8h5j-fqxa.json?$where=borough='${boro}' AND block='${block}' AND lot='${lot}'&$select=document_id&$limit=5`
    console.log('URL:', url)
    const res = await fetch(url)
    console.log('Status:', res.status)
    const data = await res.json()
    console.log('Legals result:', JSON.stringify(data).slice(0, 200))
  }
}
run().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
