"use client"

import dynamic from "next/dynamic"
import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { PropertyTable, type PropertyRow } from "@/components/PropertyTable"
import { ExportButton } from "@/components/ExportButton"
import { PropertySlideOver } from "@/components/PropertySlideOver"
import { LayoutList, Map as MapIcon, TrendingDown, Clock, DollarSign, AlertTriangle, BarChart3 } from "lucide-react"

const PropertyMap = dynamic(
  () => import("@/components/PropertyMap").then((m) => m.PropertyMap),
  { ssr: false, loading: () => <div className="h-full flex items-center justify-center text-sm text-muted-foreground font-mono">Initializing map…</div> }
)

function fmt$(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

function fmtBig(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return fmt$(n)
}

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  accent?: "red" | "amber" | "green" | "blue" | "default"
  icon?: React.ReactNode
}

function StatCard({ label, value, sub, accent = "default", icon }: StatCardProps) {
  const accentClass = {
    red:     "text-red-400",
    amber:   "text-amber-400",
    green:   "text-emerald-400",
    blue:    "text-sky-400",
    default: "text-foreground",
  }[accent]

  return (
    <div className="bg-card border border-border/60 rounded-md px-4 py-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">{label}</span>
        {icon && <span className="text-muted-foreground/40">{icon}</span>}
      </div>
      <div className={`text-2xl font-semibold tracking-tight tabular-nums font-mono ${accentClass}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

interface DashboardViewProps {
  data: PropertyRow[]
  searchParams: Record<string, string>
}

type ViewMode = "table" | "map"

export function DashboardView({ data, searchParams }: DashboardViewProps) {
  const router = useRouter()
  const [view, setView] = useState<ViewMode>("table")
  const [selectedBBL, setSelectedBBL] = useState<string | null>(null)

  const currentYear = new Date().getFullYear()

  const avgScore = data.length
    ? Math.round(data.reduce((s, p) => s + p.distress_score, 0) / data.length)
    : 0

  const expiring12mo = data.filter(
    (p) => p.expiration_year != null && p.expiration_year <= currentYear + 1
  ).length

  const totalExempt = data.reduce((s, p) => s + (p.annual_exempt_amount ?? 0), 0)
  const totalUpside = data.reduce((s, p) => s + (p.estimated_annual_rent_upside ?? 0), 0)
  const highRisk = data.filter((p) => p.deregulation_risk === "high").length

  const handleRowClick = useCallback((bbl: string) => {
    setSelectedBBL(bbl)
  }, [])

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <StatCard
          label="Properties"
          value={data.length.toLocaleString()}
          sub={data.length === 500 ? "top 500 shown" : "in window"}
          icon={<BarChart3 className="size-3.5" />}
        />
        <StatCard
          label="Expiring ≤ 12 mo"
          value={expiring12mo.toLocaleString()}
          sub="immediate pipeline"
          accent="red"
          icon={<Clock className="size-3.5" />}
        />
        <StatCard
          label="Avg Distress"
          value={avgScore}
          sub="higher = more urgent"
          accent={avgScore >= 60 ? "red" : avgScore >= 40 ? "amber" : "default"}
          icon={<AlertTriangle className="size-3.5" />}
        />
        <StatCard
          label="Total Exempt/yr"
          value={fmtBig(totalExempt)}
          sub="expiring tax shield"
          accent="amber"
          icon={<TrendingDown className="size-3.5" />}
        />
        <StatCard
          label="Total Rent Upside"
          value={totalUpside > 0 ? fmtBig(totalUpside) + "/yr" : "—"}
          sub={`${highRisk} high dereg risk`}
          accent="green"
          icon={<DollarSign className="size-3.5" />}
        />
      </div>

      {/* View toggle + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-muted/50 border border-border/60 rounded-md p-0.5">
          <button
            onClick={() => setView("table")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
              view === "table"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutList className="size-3.5" /> Table
          </button>
          <button
            onClick={() => setView("map")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
              view === "map"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <MapIcon className="size-3.5" /> Map
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground font-mono">
            {data.length.toLocaleString()} rows
          </span>
          <ExportButton searchParams={searchParams} />
        </div>
      </div>

      {/* Content */}
      {view === "table" ? (
        <PropertyTable data={data} onRowClick={handleRowClick} />
      ) : (
        <div className="h-[600px] rounded-md overflow-hidden border border-border/60">
          <PropertyMap
            data={data}
            onSelect={(bbl) => setSelectedBBL(bbl)}
          />
        </div>
      )}

      {/* Slide-over */}
      {selectedBBL && (
        <PropertySlideOver
          bbl={selectedBBL}
          onClose={() => setSelectedBBL(null)}
        />
      )}
    </div>
  )
}
