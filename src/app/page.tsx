import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { PropertyTable } from "@/components/PropertyTable"
import { FilterBar } from "@/components/FilterBar"
import { ExportButton } from "@/components/ExportButton"
import type { PropertyRow } from "@/components/PropertyTable"

interface PageProps {
  searchParams: Promise<Record<string, string>>
}

async function PropertiesList({ searchParams }: { searchParams: Record<string, string> }) {
  const supabase = await createClient()

  const borough = searchParams.borough
  const maxMonths = parseInt(searchParams.maxMonths ?? "36")
  const minScore = parseFloat(searchParams.minScore ?? "0")
  const minUnits = parseInt(searchParams.minUnits ?? "0") || 0
  const maxYear = Math.ceil(new Date().getFullYear() + maxMonths / 12)

  let query = supabase
    .from("property_pipeline")
    .select("*")
    .gte("distress_score", minScore)
    .lte("expiration_year", maxYear)
    .order("distress_score", { ascending: false })
    .limit(500)

  if (borough && borough !== "all") {
    query = query.eq("borough", borough)
  }
  if (minUnits > 0) {
    query = query.gte("total_units", minUnits)
  }

  const { data, error } = await query

  if (error) {
    return (
      <div className="text-destructive text-sm py-8">
        Error loading properties: {error.message}
      </div>
    )
  }

  const properties = (data ?? []) as PropertyRow[]

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {properties.length} properties
          {properties.length === 500 ? " (showing top 500)" : ""}
        </p>
        <ExportButton searchParams={searchParams} />
      </div>
      <PropertyTable data={properties} />
    </div>
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
            Loading properties...
          </div>
        }
      >
        <PropertiesList searchParams={params} />
      </Suspense>
    </main>
  )
}
