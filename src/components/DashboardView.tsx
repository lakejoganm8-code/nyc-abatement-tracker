"use client"

import dynamic from "next/dynamic"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { PropertyTable, type PropertyRow } from "@/components/PropertyTable"
import { ExportButton } from "@/components/ExportButton"
import { LayoutList, Map } from "lucide-react"

const PropertyMap = dynamic(
  () => import("@/components/PropertyMap").then((m) => m.PropertyMap),
  { ssr: false, loading: () => <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading map…</div> }
)

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-semibold tabular-nums mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function fmt$(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

interface DashboardViewProps {
  data: PropertyRow[]
  searchParams: Record<string, string>
}

export function DashboardView({ data, searchParams }: DashboardViewProps) {
  const avgScore = data.length
    ? Math.round(data.reduce((s, p) => s + p.distress_score, 0) / data.length)
    : 0

  const currentYear = new Date().getFullYear()
  const expiring12mo = data.filter(
    (p) => p.expiration_year != null && p.expiration_year <= currentYear + 1
  ).length

  const totalExempt = data.reduce((s, p) => s + (p.annual_exempt_amount ?? 0), 0)

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Properties"
          value={data.length.toLocaleString()}
          sub={data.length === 500 ? "top 500 shown" : "in window"}
        />
        <StatCard
          label="Avg Distress Score"
          value={avgScore}
          sub="higher = more urgent"
        />
        <StatCard
          label="Expiring ≤ 12 mo"
          value={expiring12mo.toLocaleString()}
          sub="approaching full expiration"
        />
        <StatCard
          label="Total Annual Exempt"
          value={fmt$(totalExempt)}
          sub="across all properties"
        />
      </div>

      {/* Table / Map toggle */}
      <Tabs defaultValue="table">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="table" className="gap-1.5">
              <LayoutList className="size-3.5" /> Table
            </TabsTrigger>
            <TabsTrigger value="map" className="gap-1.5">
              <Map className="size-3.5" /> Map
            </TabsTrigger>
          </TabsList>
          <ExportButton searchParams={searchParams} />
        </div>

        <TabsContent value="table" className="mt-3">
          <PropertyTable data={data} />
        </TabsContent>

        <TabsContent value="map" className="mt-3">
          <div className="h-[600px] rounded-lg overflow-hidden border">
            <PropertyMap
              data={data}
              onSelect={(bbl) => window.open(`/property/${bbl}`, "_blank")}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
