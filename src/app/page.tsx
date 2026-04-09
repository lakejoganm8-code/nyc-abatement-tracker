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
  const expiresTo = parseInt(searchParams.expiresTo ?? String(currentYear + 2)) || currentYear + 2
  const minScore = parseFloat(searchParams.minScore ?? "0")
  const minUnits = parseInt(searchParams.minUnits ?? "0") || 0
  const owner = searchParams.owner ?? null
  const buildingClass = searchParams.buildingClass ?? null
  const search = searchParams.search ?? null
  const motivatedOnly = searchParams.motivatedOnly === "1"

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
  if (buildingClass) {
    query = query.ilike("building_class", `${buildingClass}%`)
  }
  if (search) {
    // Search by address or BBL
    query = query.or(`address.ilike.%${search}%,bbl.eq.${search}`)
  }
  if (motivatedOnly) {
    query = query
      .in("sell_likelihood_label", ["high", "very high"])
      .eq("suppress_from_leads", false)
  }

  const { data, error } = await query

  if (error) {
    return (
      <div className="text-destructive text-sm py-8 px-6">
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
    <div className="min-h-screen flex flex-col">
      {/* Top nav bar */}
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-[1520px] mx-auto px-5 h-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-5 rounded-sm bg-primary/90 flex items-center justify-center">
              <span className="text-primary-foreground text-[10px] font-bold tracking-tighter">AT</span>
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground">NYC Abatement Tracker</span>
            <span className="text-[11px] text-muted-foreground hidden sm:block">— motivated seller pipeline · 421-a &amp; J-51 expirations</span>
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>
      </header>

      {/* Filter bar */}
      <div className="border-b border-border/50 bg-background/95">
        <div className="max-w-[1520px] mx-auto px-5">
          <Suspense>
            <FilterBar />
          </Suspense>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 max-w-[1520px] mx-auto w-full px-5 py-5">
        <Suspense
          fallback={
            <div className="text-sm text-muted-foreground py-16 text-center font-mono">
              Loading pipeline…
            </div>
          }
        >
          <PropertiesList searchParams={params} />
        </Suspense>
      </main>
    </div>
  )
}
