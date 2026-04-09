import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { PropertyFilters } from "@/types"

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const supabase = await createClient()

  const currentYear = new Date().getFullYear()

  const filters: PropertyFilters = {
    borough: (searchParams.get("borough") ?? "all") as PropertyFilters["borough"],
    expiresFrom: parseInt(searchParams.get("expiresFrom") ?? String(currentYear)) || currentYear,
    expiresTo: parseInt(searchParams.get("expiresTo") ?? String(currentYear)) || currentYear,
    minScore: parseFloat(searchParams.get("minScore") ?? "0"),
    buildingClass: searchParams.get("buildingClass") ?? undefined,
    minUnits: parseInt(searchParams.get("minUnits") ?? "0") || undefined,
    owner: searchParams.get("owner") ?? undefined,
    motivatedOnly: searchParams.get("motivatedOnly") === "1",
    limit: parseInt(searchParams.get("limit") ?? "100"),
    offset: parseInt(searchParams.get("offset") ?? "0"),
  }

  let query = supabase
    .from("property_pipeline")
    .select("*")
    .gte("distress_score", filters.minScore ?? 0)
    .order("distress_score", { ascending: false })
    .range(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 100) - 1)

  if (filters.borough && filters.borough !== "all") {
    query = query.eq("borough", filters.borough)
  }

  if (filters.buildingClass) {
    query = query.ilike("building_class", `${filters.buildingClass}%`)
  }

  if (filters.minUnits) {
    query = query.gte("total_units", filters.minUnits)
  }

  if (filters.owner) {
    query = query.ilike("owner_name", `%${filters.owner}%`)
  }

  if (filters.expiresFrom !== undefined) {
    query = query.gte("expiration_year", filters.expiresFrom)
  }

  if (filters.expiresTo !== undefined) {
    query = query.lte("expiration_year", filters.expiresTo)
  }

  if (filters.motivatedOnly) {
    query = query
      .in("sell_likelihood_label", ["high", "very high"])
      .eq("suppress_from_leads", false)
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, count, filters })
}
