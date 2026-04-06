"use client"

import { useEffect, useState } from "react"
import { X, ExternalLink, TrendingDown, Shield, AlertTriangle, Building2, DollarSign, BarChart3 } from "lucide-react"
import { cn } from "@/lib/utils"

interface PropertyData {
  bbl: string
  address: string
  borough: string
  benefit_type: string | null
  ami_tier: string | null
  benefit_start_year: number | null
  expiration_year: number | null
  phase_out_start_year: number | null
  expiration_status: string | null
  annual_exempt_amount: number
  assessed_value: number | null
  building_class: string
  total_units: number | null
  violation_count_12mo: number
  eviction_count_12mo: number
  distress_score: number
  tax_impact_component: number | null
  time_component: number | null
  debt_component: number | null
  ownership_component: number | null
  violation_component: number | null
  owner_name: string | null
  last_deed_date: string | null
  last_sale_price: number | null
  last_mortgage_amount: number | null
  ownership_years: number | null
  lender_name: string | null
  estimated_annual_rent_upside: number | null
  deregulation_risk: "high" | "medium" | "low" | null
  is_rent_stabilized: boolean | null
  stabilization_source: string | null
  year_built: number | null
  zoning: string | null
  neighborhood: string | null
  registration_status: string | null
  edge_case_flags: string[]
}

interface PropertySlideOverProps {
  bbl: string
  onClose: () => void
}

function fmt$(n: number | null | undefined): string {
  if (!n) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

function fmtUpside(n: number | null | undefined): string {
  if (!n) return "—"
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M/yr`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k/yr`
  return fmt$(n) + "/yr"
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center gap-4 py-1.5 border-b border-border/20 last:border-0">
      <span className="text-[11px] text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-xs text-right", mono ? "font-mono" : "")}>{value ?? "—"}</span>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-muted-foreground/60">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</span>
      </div>
      <div className="bg-muted/20 border border-border/40 rounded-md px-3">
        {children}
      </div>
    </div>
  )
}

function ScoreBar({ label, value, weight }: { label: string; value: number; weight: string }) {
  const pct = Math.min(value, 100)
  const color =
    pct >= 70 ? "bg-red-500/70" :
    pct >= 40 ? "bg-amber-500/70" :
    "bg-emerald-600/60"

  return (
    <div className="py-1.5 border-b border-border/20 last:border-0">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[11px] text-muted-foreground">{label} <span className="text-muted-foreground/50">({weight})</span></span>
        <span className="text-xs font-mono font-semibold">{value.toFixed(0)}</span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

const DEREG_STYLES: Record<string, string> = {
  high:   "text-red-400 bg-red-950/50",
  medium: "text-amber-400 bg-amber-950/50",
  low:    "text-emerald-400 bg-emerald-950/50",
}

const STATUS_STYLES: Record<string, string> = {
  APPROACHING: "text-red-400 bg-red-950/40",
  IN_PHASE_OUT: "text-amber-400 bg-amber-950/40",
  FUTURE: "text-muted-foreground bg-muted/40",
  EXPIRED: "text-muted-foreground bg-muted/40",
}

export function PropertySlideOver({ bbl, onClose }: PropertySlideOverProps) {
  const [property, setProperty] = useState<PropertyData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/properties/${bbl}`)
      .then(r => r.json())
      .then((data) => { setProperty(data.error ? null : data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [bbl])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = "" }
  }, [])

  const CURRENT_YEAR = new Date().getFullYear()

  const acrisUrl = `https://acris.nyc.gov/DS/DocumentSearch/BBL?BBL=${bbl}&BBLRequestType=1`
  const hpdUrl = `https://hpdonline.nyc.gov/hpdonline/building/bbl/${bbl}`

  return (
    <>
      {/* Backdrop */}
      <div className="slideover-backdrop" onClick={onClose} />

      {/* Panel */}
      <div className="slideover-panel">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-card border-b border-border/60 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {loading ? (
                <div className="h-5 w-48 bg-muted/50 rounded animate-pulse" />
              ) : (
                <h2 className="text-sm font-semibold truncate">{property?.address || bbl}</h2>
              )}
              <div className="flex items-center gap-2 mt-1">
                <span className="font-mono text-[11px] text-muted-foreground">{bbl}</span>
                {property?.expiration_status && (
                  <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", STATUS_STYLES[property.expiration_status] ?? "")}>
                    {property.expiration_status.replace("_", " ")}
                  </span>
                )}
                {(property?.edge_case_flags ?? []).map((f) => (
                  <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">{f}</span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {property && (
                <div className="text-right">
                  <div className={cn("font-mono text-lg font-bold",
                    property.distress_score >= 75 ? "text-red-400" :
                    property.distress_score >= 50 ? "text-amber-400" :
                    "text-muted-foreground"
                  )}>
                    {property.distress_score.toFixed(0)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">distress</div>
                </div>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-5">
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 rounded-md bg-muted/30 animate-pulse" />
              ))}
            </div>
          ) : !property ? (
            <p className="text-sm text-muted-foreground text-center py-8">Property not found.</p>
          ) : (
            <>
              {/* Score breakdown */}
              <Section title="Distress Score" icon={<BarChart3 className="size-3.5" />}>
                <ScoreBar label="Tax Impact"          value={property.tax_impact_component ?? 0}   weight="30%" />
                <ScoreBar label="Time to Expiration"  value={property.time_component ?? 0}          weight="25%" />
                <ScoreBar label="Debt Load"           value={property.debt_component ?? 0}          weight="20%" />
                <ScoreBar label="Ownership Duration"  value={property.ownership_component ?? 0}     weight="15%" />
                <ScoreBar label="HPD Violations"      value={property.violation_component ?? 0}     weight="10%" />
              </Section>

              {/* Abatement */}
              <Section title="Abatement Profile" icon={<TrendingDown className="size-3.5" />}>
                <Row label="Type"             value={property.benefit_type ?? property.building_class} />
                <Row label="Start year"       value={property.benefit_start_year}  mono />
                <Row label="Expiration"       value={
                  <span className={cn("font-mono font-semibold",
                    (property.expiration_year ?? 9999) <= CURRENT_YEAR + 1 ? "text-red-400" :
                    (property.expiration_year ?? 9999) <= CURRENT_YEAR + 2 ? "text-amber-400" :
                    "text-emerald-400"
                  )}>
                    {property.expiration_year ?? "—"}
                  </span>
                } />
                <Row label="Phase-out starts" value={property.phase_out_start_year} mono />
                <Row label="Annual exempt"    value={fmt$(property.annual_exempt_amount)} mono />
                <Row label="Assessed value"   value={fmt$(property.assessed_value)}    mono />
              </Section>

              {/* Rent & Dereg */}
              <Section title="Rent & Deregulation Signal" icon={<Shield className="size-3.5" />}>
                <Row label="AMI tier"        value={property.ami_tier ?? "—"} />
                <Row label="Est. rent upside" value={
                  <span className="text-emerald-400 font-semibold font-mono">
                    {fmtUpside(property.estimated_annual_rent_upside)}
                  </span>
                } />
                <Row label="Dereg risk" value={
                  property.deregulation_risk ? (
                    <span className={cn("text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded uppercase", DEREG_STYLES[property.deregulation_risk])}>
                      {property.deregulation_risk}
                    </span>
                  ) : "—"
                } />
                <Row label="Rent stabilized" value={
                  property.is_rent_stabilized === true ? "Yes" :
                  property.is_rent_stabilized === false ? "At risk" : "—"
                } />
                <Row label="Year built" value={property.year_built} mono />
              </Section>

              {/* Financial */}
              <Section title="Financial Signal" icon={<DollarSign className="size-3.5" />}>
                <Row label="Owner"          value={property.owner_name} />
                <Row label="Last sale"      value={fmt$(property.last_sale_price)}       mono />
                <Row label="Deed date"      value={fmtDate(property.last_deed_date)}     mono />
                <Row label="Ownership"      value={property.ownership_years ? `${property.ownership_years} yrs` : "—"} mono />
                <Row label="Mortgage"       value={fmt$(property.last_mortgage_amount)}  mono />
                <Row label="Mortgage date"  value={fmtDate(property.lender_name ? undefined : undefined)} mono />
                <Row label="Lender"         value={property.lender_name} />
              </Section>

              {/* Building */}
              <Section title="Building Profile" icon={<Building2 className="size-3.5" />}>
                <Row label="Total units"    value={property.total_units} mono />
                <Row label="Building class" value={<span className="font-mono">{property.building_class}</span>} />
                <Row label="Zoning"         value={property.zoning} />
                <Row label="Neighborhood"   value={property.neighborhood} />
                <Row label="Violations 12mo" value={
                  <span className={property.violation_count_12mo >= 10 ? "text-red-400 font-semibold font-mono" : "font-mono"}>
                    {property.violation_count_12mo}
                  </span>
                } />
                <Row label="Evictions 12mo" value={
                  <span className={(property.eviction_count_12mo ?? 0) >= 3 ? "text-red-400 font-semibold font-mono" : "font-mono"}>
                    {property.eviction_count_12mo ?? 0}
                  </span>
                } />
              </Section>

              {/* External links + disclaimer */}
              <div className="flex gap-4 pt-1">
                <a href={acrisUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                  ACRIS <ExternalLink className="size-2.5" />
                </a>
                <a href={hpdUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                  HPD Online <ExternalLink className="size-2.5" />
                </a>
                <a href={`/property/${bbl}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                  Full detail <ExternalLink className="size-2.5" />
                </a>
              </div>

              <p className="text-[10px] text-muted-foreground/60 leading-relaxed pb-2">
                Rent upside assumes blended unit mix (20% studio / 50% 1BR / 25% 2BR / 5% 3BR) and 2025 market rates. Verify against unit rent rolls.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  )
}
