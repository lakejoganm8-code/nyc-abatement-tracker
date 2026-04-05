import { NextRequest, NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { getACRISData } from "@/lib/nyc/acris"

const ACRIS_CACHE_HOURS = 24

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ bbl: string }> }
) {
  const { bbl } = await params
  const supabase = await createClient()

  const { data: property, error } = await supabase
    .from("property_pipeline")
    .select("*")
    .eq("bbl", bbl)
    .single()

  if (error || !property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 })
  }

  let acris = property.last_deed_date !== null ? {
    last_deed_date: property.last_deed_date,
    last_sale_price: property.last_sale_price,
    last_mortgage_amount: property.last_mortgage_amount,
    mortgage_date: property.mortgage_date,
    lender_name: property.lender_name,
    ownership_years: property.ownership_years,
  } : null

  const { data: cachedACRIS } = await supabase
    .from("acris_records")
    .select("fetched_at")
    .eq("bbl", bbl)
    .single()

  const isStale = !cachedACRIS || (
    Date.now() - new Date(cachedACRIS.fetched_at).getTime() > ACRIS_CACHE_HOURS * 3_600_000
  )

  if (isStale) {
    try {
      const fresh = await getACRISData(bbl)
      if (fresh) {
        const serviceClient = createServiceClient()
        await serviceClient.from("acris_records").upsert({
          bbl: fresh.bbl,
          last_deed_date: fresh.lastDeedDate,
          last_sale_price: fresh.lastSalePrice,
          last_mortgage_amount: fresh.lastMortgageAmount,
          mortgage_date: fresh.mortgageDate,
          lender_name: fresh.lenderName,
          ownership_years: fresh.ownershipYears,
          fetched_at: fresh.fetchedAt,
        }, { onConflict: "bbl" })

        acris = {
          last_deed_date: fresh.lastDeedDate,
          last_sale_price: fresh.lastSalePrice,
          last_mortgage_amount: fresh.lastMortgageAmount,
          mortgage_date: fresh.mortgageDate,
          lender_name: fresh.lenderName,
          ownership_years: fresh.ownershipYears,
        }
      }
    } catch (err) {
      console.warn(`[acris] Failed to fetch for BBL ${bbl}:`, err)
    }
  }

  return NextResponse.json({ ...property, ...acris, acris_fresh: !isStale })
}
