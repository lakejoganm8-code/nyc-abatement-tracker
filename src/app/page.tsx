import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { DashboardView } from "@/components/DashboardView"
import { FilterBar } from "@/components/FilterBar"
import type { PropertyRow } from "@/components/PropertyTable"

interface PageProps {
  searchParams: Promise<Record<string, string>>
}

async function PropertiesList({ searchParams }: { searchParams: Record<string, string> }) {
  const supabase = await createClient()

  const currentYear = new Date().getFullYear()
  const borough = searchParams.borough
  const expiresFrom = parseInt(searchParams.expiresFrom ?? String(currentYear)) || currentYear
  const expiresTo = parseInt(searchParams.expiresTo ?? String(currentYear)) || currentYear
  const minScore = parseFloat(searchParams.minScore ?? "0")
  const minUnits = parseInt(searchParams.minUnits ?? "0") || 0
  const owner = searchParams.owner ?? null
  const hideCondo = searchParams.hideCondo === "1"

  let query = supabase
    .from("property_pipeline")
    .select("*")
    .gte("distress_score", minScore)
    .gte("expiration_year", expiresFrom)
    .lte("expiration_year", expiresTo)
    .order("distress_score", { ascending: false })
    .limit(500)

  if (borough && borough !== "all") {
    query = query.eq("borough", borough)
  }
  if (minUnits > 0) {
    query = query.gte("total_units", minUnits)
  }
  if (owner) {
    query = query.ilike("owner_name", `%${owner}%`)
  }
  if (hideCondo) {
    query = query.not("edge_case_flags", "cs", '["CONDO_BBL"]')
  }

  const { data, error } = await query

  if (error) {
    return (
      <div className="text-destructive text-sm py-8">
        Error loading properties: {error.message}
      </div>
    )
  }

  return (
    <DashboardView
      data={(data ?? []) as PropertyRow[]}
      searchParams={searchParams}
    />
  )
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          NYC Abatement Expiration Tracker
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Properties where 421-a or J-51 tax abatements are expiring — acquisition pipeline intelligence.
        </p>
      </div>

      <Suspense>
        <FilterBar />
      </Suspense>

      <Suspense
        fallback={
          <div className="text-sm text-muted-foreground py-12 text-center">
            Loading properties…
          </div>
        }
      >
        <PropertiesList searchParams={params} />
      </Suspense>
    </main>
  )
}
