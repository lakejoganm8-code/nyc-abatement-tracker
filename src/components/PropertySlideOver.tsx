"use client"

import { useEffect, useState } from "react"
import { X, ExternalLink, TrendingDown, TrendingUp, Shield, AlertTriangle, Building2, DollarSign, BarChart3, Phone, Zap, Users } from "lucide-react"
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
  // Phase B: HPD contacts (phone not in dataset)
  hpd_owner_name: string | null
  hpd_owner_address: string | null
  hpd_owner_type: string | null
  hpd_agent_name: string | null
  hpd_agent_address: string | null
  // Phase C: distress signals
  has_tax_lien: boolean
  dob_violation_count: number
  hp_action_count: number
  nonpayment_count: number
  // Phase C: score components
  tax_lien_component: number | null
  housing_court_component: number | null
  // Phase E: DOS entity research
  dos_entity_status: string | null
  dos_agent_name: string | null
  dos_agent_address: string | null
  dos_search_url: string | null
  dos_date_of_formation: string | null
  // Regulatory agreement
  has_affordable_commitment: boolean
  reg_agreement_doc_type: string | null
  reg_agreement_date: string | null
  reg_agreement_url: string | null
  // Valuation
  gross_rent_estimate: number | null
  noi_current: number | null
  noi_post_expiration: number | null
  implied_value_current: number | null
  implied_value_post_expiration: number | null
  value_delta: number | null
  break_even_occupancy: number | null
  estimated_market_value: number | null
  // Owner profile
  owner_type: string | null
  portfolio_size: number | null
  total_portfolio_tax_shock: number | null
  refi_pressure: boolean
  sell_likelihood_score: number | null
  sell_likelihood_label: string | null
  sell_signals: string[] | null
  suppress_from_leads: boolean
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
              {/* Expiration impact — the thesis */}
              <div className="rounded-md border border-amber-500/20 bg-amber-950/15 px-4 py-3 space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-amber-400/80 flex items-center gap-1.5">
                  <Zap className="size-3" /> What happens at expiration
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-muted-foreground">Tax increase</div>
                    <div className="font-mono text-base font-bold text-amber-300">
                      +{fmt$(property.annual_exempt_amount)}<span className="text-[10px] font-normal text-muted-foreground">/yr</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">permanent, annual</div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-muted-foreground">Effective</div>
                    <div className={cn("font-mono text-base font-bold",
                      (property.expiration_year ?? 9999) <= CURRENT_YEAR + 1 ? "text-red-400" :
                      (property.expiration_year ?? 9999) <= CURRENT_YEAR + 2 ? "text-amber-400" :
                      "text-emerald-400"
                    )}>
                      {property.expiration_year ?? "—"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {property.expiration_status === "IN_PHASE_OUT" ? "already phasing out" : "abatement end"}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-muted-foreground">Rent upside</div>
                    <div className="font-mono text-base font-bold text-emerald-400">
                      {fmtUpside(property.estimated_annual_rent_upside)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {property.deregulation_risk ? `${property.deregulation_risk} dereg risk` : "est. annual gain"}
                    </div>
                  </div>
                </div>
                <div className="border-t border-amber-500/10 pt-2.5 grid grid-cols-3 gap-3">
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-muted-foreground">Purchased</div>
                    <div className="font-mono text-sm font-semibold text-foreground/90">{fmt$(property.last_sale_price)}</div>
                    {property.last_deed_date && (
                      <div className="text-[10px] text-muted-foreground">{new Date(property.last_deed_date).getFullYear()}</div>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-muted-foreground">Mortgage</div>
                    <div className="font-mono text-sm font-semibold text-foreground/90">{fmt$(property.last_mortgage_amount)}</div>
                    {property.lender_name && <div className="text-[10px] text-muted-foreground truncate">{property.lender_name}</div>}
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-muted-foreground">Years held</div>
                    <div className={cn("font-mono text-sm font-semibold",
                      (property.ownership_years ?? 0) >= 20 ? "text-amber-400" : "text-foreground/90"
                    )}>
                      {property.ownership_years ? `${property.ownership_years} yrs` : "—"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {(property.ownership_years ?? 0) >= 20 ? "long hold — seller fatigue?" : "since acquisition"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Implied Valuation */}
              {property.implied_value_current != null && (
                <Section title="Implied Valuation (Estimate)" icon={<TrendingUp className="size-3.5" />}>
                  <div className="py-2 grid grid-cols-2 gap-x-4 gap-y-0">
                    <div className="py-1.5 border-b border-border/20">
                      <div className="text-[10px] text-muted-foreground mb-0.5">Gross rent estimate</div>
                      <div className="font-mono text-xs font-semibold">{fmt$(property.gross_rent_estimate)}<span className="text-muted-foreground font-normal">/yr</span></div>
                    </div>
                    <div className="py-1.5 border-b border-border/20">
                      <div className="text-[10px] text-muted-foreground mb-0.5">NOI (w/ abatement)</div>
                      <div className={cn("font-mono text-xs font-semibold", (property.noi_current ?? 0) > 0 ? "" : "text-red-400")}>{fmt$(property.noi_current)}<span className="text-muted-foreground font-normal">/yr</span></div>
                    </div>
                    <div className="py-1.5 border-b border-border/20">
                      <div className="text-[10px] text-muted-foreground mb-0.5">NOI post-expiration</div>
                      <div className={cn("font-mono text-xs font-semibold", (property.noi_post_expiration ?? 0) > 0 ? "text-amber-300" : "text-red-400")}>{fmt$(property.noi_post_expiration)}<span className="text-muted-foreground font-normal">/yr</span></div>
                    </div>
                    <div className="py-1.5 border-b border-border/20">
                      <div className="text-[10px] text-muted-foreground mb-0.5">Break-even occupancy</div>
                      <div className={cn("font-mono text-xs font-semibold", (property.break_even_occupancy ?? 0) > 0.90 ? "text-red-400" : "text-amber-300")}>
                        {property.break_even_occupancy != null ? `${(property.break_even_occupancy * 100).toFixed(0)}%` : "—"}
                      </div>
                    </div>
                    <div className="py-1.5 border-b border-border/20">
                      <div className="text-[10px] text-muted-foreground mb-0.5">Implied value now</div>
                      <div className="font-mono text-xs font-semibold text-emerald-400">{fmt$(property.implied_value_current)}</div>
                    </div>
                    <div className="py-1.5 border-b border-border/20">
                      <div className="text-[10px] text-muted-foreground mb-0.5">Implied value at expiry</div>
                      <div className="font-mono text-xs font-semibold text-red-400">{fmt$(property.implied_value_post_expiration)}</div>
                    </div>
                  </div>
                  <div className="py-2 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Value destroyed at expiration</span>
                    <span className="font-mono text-sm font-bold text-red-400">
                      {property.value_delta != null ? `-${fmt$(property.value_delta)}` : "—"}
                    </span>
                  </div>
                  {property.estimated_market_value != null && (
                    <div className="pb-1.5 flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">DOF market value (reference)</span>
                      <span className="font-mono text-xs text-muted-foreground">{fmt$(property.estimated_market_value)}</span>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground/50 pb-1 leading-relaxed">
                    Estimates use RGB avg stabilized rents × units, 30% expense ratio, NYC Class 2 tax rate. Individual results vary.
                  </p>
                </Section>
              )}

              {/* Owner Profile */}
              {property.sell_likelihood_label && !property.suppress_from_leads && (
                <Section title="Owner Profile" icon={<Users className="size-3.5" />}>
                  <div className="py-2 flex items-center justify-between border-b border-border/20">
                    <span className="text-[10px] text-muted-foreground">Sell likelihood</span>
                    <span className={cn("text-[11px] font-mono font-bold px-2 py-0.5 rounded uppercase",
                      property.sell_likelihood_label === "very high" ? "text-red-400 bg-red-950/50" :
                      property.sell_likelihood_label === "high"      ? "text-amber-400 bg-amber-950/50" :
                      property.sell_likelihood_label === "medium"    ? "text-sky-400 bg-sky-950/50" :
                      "text-muted-foreground bg-muted/30"
                    )}>
                      {property.sell_likelihood_label}
                    </span>
                  </div>
                  {property.owner_type && (
                    <Row label="Owner type" value={<span className="font-mono text-[11px]">{property.owner_type}</span>} />
                  )}
                  {(property.portfolio_size ?? 1) > 1 && (
                    <Row label="Portfolio" value={
                      <span className="font-mono text-[11px]">
                        {property.portfolio_size} buildings · {fmt$(property.total_portfolio_tax_shock)}/yr total shock
                      </span>
                    } />
                  )}
                  {property.refi_pressure && (
                    <Row label="Refi pressure" value={
                      <span className="text-[10px] font-mono text-red-400 bg-red-950/40 px-1.5 py-0.5 rounded">
                        Pre-2020 debt · faces rate shock
                      </span>
                    } />
                  )}
                  {(property.sell_signals ?? []).length > 0 && (
                    <div className="py-2 space-y-1">
                      {(property.sell_signals ?? []).map((sig, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <span className="text-amber-400/60 mt-0.5 shrink-0">›</span>
                          <span className="text-[10px] text-muted-foreground">{sig}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}
              {property.suppress_from_leads && (
                <div className="text-[10px] text-muted-foreground/50 bg-muted/20 rounded px-3 py-2">
                  Owner classified as government or nonprofit — unlikely to sell at market.
                </div>
              )}

              {/* Score breakdown */}
              <Section title="Distress Score" icon={<BarChart3 className="size-3.5" />}>
                <ScoreBar label="Tax Impact"          value={property.tax_impact_component ?? 0}        weight="25%" />
                <ScoreBar label="Time to Expiration"  value={property.time_component ?? 0}              weight="25%" />
                <ScoreBar label="Debt Load"           value={property.debt_component ?? 0}              weight="20%" />
                <ScoreBar label="Ownership Duration"  value={property.ownership_component ?? 0}         weight="10%" />
                <ScoreBar label="Building Condition"  value={property.violation_component ?? 0}         weight="10%" />
                <ScoreBar label="Tax Lien"            value={property.tax_lien_component ?? 0}          weight="5%" />
                <ScoreBar label="Housing Court"       value={property.housing_court_component ?? 0}     weight="5%" />
              </Section>

              {/* Contact — Phase B */}
              {(property.hpd_owner_name || property.hpd_agent_name) && (
                <Section title="Contact" icon={<Phone className="size-3.5" />}>
                  {property.hpd_owner_name && (
                    <Row label="Owner" value={property.hpd_owner_name} />
                  )}
                  {property.hpd_owner_address && (
                    <Row label="Owner address" value={property.hpd_owner_address} />
                  )}
                  {property.hpd_agent_name && (
                    <Row label="Managing agent" value={property.hpd_agent_name} />
                  )}
                  {property.hpd_agent_address && (
                    <Row label="Agent address" value={property.hpd_agent_address} />
                  )}
                </Section>
              )}

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
                {property.has_affordable_commitment && (
                  <Row label="HPD reg. agreement" value={
                    <a href={property.reg_agreement_url ?? "#"} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sky-400 hover:underline text-[11px]">
                      {property.reg_agreement_doc_type ?? "Filed"} {property.reg_agreement_date ? `(${new Date(property.reg_agreement_date).getFullYear()})` : ""}
                      <ExternalLink className="size-2.5" />
                    </a>
                  } />
                )}
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
                {property.has_affordable_commitment && (
                  <Row label="Affordable commitment" value={
                    <span className="text-emerald-400 text-[10px] font-mono">HPD reg. agmt on file — limits deregulation</span>
                  } />
                )}
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

              {/* Entity Research — Phase E */}
              {(property.dos_search_url || property.dos_entity_status) && (
                <Section title="Entity Research" icon={<ExternalLink className="size-3.5" />}>
                  {property.dos_entity_status && (
                    <Row label="DOS status" value={
                      <span className={cn("text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded uppercase",
                        property.dos_entity_status.toUpperCase() === "ACTIVE"
                          ? "text-emerald-400 bg-emerald-950/50"
                          : "text-amber-400 bg-amber-950/50"
                      )}>
                        {property.dos_entity_status}
                      </span>
                    } />
                  )}
                  {property.dos_date_of_formation && (
                    <Row label="Formed" value={fmtDate(property.dos_date_of_formation)} mono />
                  )}
                  {property.dos_agent_name && (
                    <Row label="Registered agent" value={property.dos_agent_name} />
                  )}
                  {property.dos_agent_address && (
                    <Row label="Agent address" value={property.dos_agent_address} />
                  )}
                  {property.dos_search_url && (
                    <div className="py-1.5">
                      <a
                        href={property.dos_search_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] text-sky-400 hover:underline"
                      >
                        Search NY DOS <ExternalLink className="size-2.5" />
                      </a>
                    </div>
                  )}
                </Section>
              )}

              {/* Building */}
              <Section title="Building Profile" icon={<Building2 className="size-3.5" />}>
                <Row label="Total units"    value={property.total_units} mono />
                <Row label="Building class" value={<span className="font-mono">{property.building_class}</span>} />
                <Row label="Zoning"         value={property.zoning} />
                <Row label="Neighborhood"   value={property.neighborhood} />
                <Row label="HPD violations 12mo" value={
                  <span className={property.violation_count_12mo >= 10 ? "text-red-400 font-semibold font-mono" : "font-mono"}>
                    {property.violation_count_12mo}
                  </span>
                } />
                {property.dob_violation_count > 0 && (
                  <Row label="DOB violations (open)" value={
                    <span className={property.dob_violation_count >= 5 ? "text-red-400 font-semibold font-mono" : "font-mono"}>
                      {property.dob_violation_count}
                    </span>
                  } />
                )}
                <Row label="Evictions 12mo" value={
                  <span className={(property.eviction_count_12mo ?? 0) >= 3 ? "text-red-400 font-semibold font-mono" : "font-mono"}>
                    {property.eviction_count_12mo ?? 0}
                  </span>
                } />
                {(property.hp_action_count > 0 || property.nonpayment_count > 0) && (
                  <Row label="Housing court 12mo" value={
                    <span className="font-mono text-amber-400">
                      {property.hp_action_count > 0 ? `${property.hp_action_count} HP` : ""}
                      {property.hp_action_count > 0 && property.nonpayment_count > 0 ? " · " : ""}
                      {property.nonpayment_count > 0 ? `${property.nonpayment_count} NP` : ""}
                    </span>
                  } />
                )}
                {property.has_tax_lien && (
                  <Row label="Tax lien" value={
                    <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-red-950/60 text-red-400 uppercase">
                      On lien sale list
                    </span>
                  } />
                )}
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
