import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { PropertyFilters } from "@/types"

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const supabase = await createClient()

  const filters: PropertyFilters = {
    borough: (searchParams.get("borough") ?? "all") as PropertyFilters["borough"],
    minMonths: parseInt(searchParams.get("minMonths") ?? "0"),
    maxMonths: parseInt(searchParams.get("maxMonths") ?? "36"),
    minScore: parseFloat(searchParams.get("minScore") ?? "0"),
    buildingClass: searchParams.get("buildingClass") ?? undefined,
    minUnits: parseInt(searchParams.get("minUnits") ?? "0") || undefined,
    owner: searchParams.get("owner") ?? undefined,
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

  if (filters.maxMonths !== undefined) {
    const maxYear = new Date().getFullYear() + (filters.maxMonths / 12)
    query = query.lte("expiration_year", Math.ceil(maxYear))
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, count, filters })
}
