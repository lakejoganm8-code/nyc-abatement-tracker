import { notFound } from "next/navigation"
import Link from "next/link"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { getACRISData } from "@/lib/nyc/acris"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScoreBadge } from "@/components/ScoreBadge"
import { ArrowLeft, ExternalLink } from "lucide-react"

interface PageProps {
  params: Promise<{ bbl: string }>
}

function fmt$(n: number | null | undefined): string {
  if (!n) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

const STATUS_BADGE: Record<string, "destructive" | "secondary" | "outline"> = {
  APPROACHING: "destructive",
  IN_PHASE_OUT: "secondary",
  FUTURE: "outline",
  EXPIRED: "outline",
}

export default async function PropertyDetailPage({ params }: PageProps) {
  const { bbl } = await params
  const supabase = await createClient()

  const { data: property, error } = await supabase
    .from("property_pipeline")
    .select("*")
    .eq("bbl", bbl)
    .single()

  if (error || !property) notFound()

  const ACRIS_TTL_HOURS = 24
  const { data: cachedACRIS } = await supabase
    .from("acris_records")
    .select("*")
    .eq("bbl", bbl)
    .single()

  const isStale = !cachedACRIS || (
    Date.now() - new Date(cachedACRIS.fetched_at).getTime() > ACRIS_TTL_HOURS * 3_600_000
  )

  let acris = cachedACRIS
  if (isStale) {
    const fresh = await getACRISData(bbl).catch(() => null)
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
      acris = fresh as typeof cachedACRIS
    }
  }

  const acrisUrl = `https://acris.nyc.gov/DS/DocumentSearch/BBL?BBL=${bbl}&BBLRequestType=1`
  const dofUrl = `https://portal.311.nyc.gov/article/?kanumber=KA-01245`

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to pipeline
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{property.address || bbl}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-muted-foreground">BBL {bbl}</span>
            {(property.edge_case_flags ?? []).map((f: string) => (
              <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
            ))}
          </div>
        </div>
        <ScoreBadge score={property.distress_score ?? 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Abatement Profile</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Exemption type" value={property.benefit_type ?? property.exemption_code} />
            <Row label="Start year" value={property.benefit_start_year} />
            <Row label="Expiration year" value={<span className="font-medium">{property.expiration_year ?? "—"}</span>} />
            <Row label="Phase-out starts" value={property.phase_out_start_year ?? "—"} />
            <Row label="Status" value={
              <Badge variant={STATUS_BADGE[property.expiration_status ?? ""] ?? "outline"}>
                {property.expiration_status?.replace("_", " ") ?? "—"}
              </Badge>
            } />
            <Row label="Annual exempt amount" value={fmt$(property.annual_exempt_amount)} />
            <Row label="Assessed value" value={fmt$(property.assessed_value)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Financial Signal</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Last sale price" value={fmt$(acris?.last_sale_price)} />
            <Row label="Last deed date" value={fmtDate(acris?.last_deed_date)} />
            <Row label="Ownership (yrs)" value={acris?.ownership_years ? `${acris.ownership_years} yrs` : "—"} />
            <Row label="Mortgage amount" value={fmt$(acris?.last_mortgage_amount)} />
            <Row label="Mortgage date" value={fmtDate(acris?.mortgage_date)} />
            <Row label="Lender" value={acris?.lender_name ?? "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Building Profile</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Total units" value={property.total_units ?? "—"} />
            <Row label="Building class" value={<span className="font-mono">{property.building_class}</span>} />
            <Row label="Year built" value={property.year_built ?? "—"} />
            <Row label="Zoning" value={property.zoning ?? "—"} />
            <Row label="FAR" value={property.far ?? "—"} />
            <Row label="Neighborhood" value={property.neighborhood ?? "—"} />
            <Row label="Violations (12mo)" value={
              <span className={property.violation_count_12mo >= 10 ? "text-destructive font-semibold" : ""}>
                {property.violation_count_12mo}
              </span>
            } />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Distress Score Breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ScoreBar label="Tax Impact (30%)" value={property.tax_impact_component ?? 0} />
            <ScoreBar label="Time to Expiry (25%)" value={property.time_component ?? 0} />
            <ScoreBar label="Debt Load (20%)" value={property.debt_component ?? 0} />
            <ScoreBar label="Ownership Duration (15%)" value={property.ownership_component ?? 0} />
            <ScoreBar label="HPD Violations (10%)" value={property.violation_component ?? 0} />
            <div className="pt-2 border-t flex justify-between font-medium">
              <span>Total</span>
              <span>{(property.distress_score ?? 0).toFixed(1)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3 text-sm">
        <a href={acrisUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          NYC ACRIS <ExternalLink className="size-3" />
        </a>
        <a href={dofUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          DOF Property <ExternalLink className="size-3" />
        </a>
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right">{value ?? "—"}</span>
    </div>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{value.toFixed(0)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  )
}
