"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"

interface ExportButtonProps {
  searchParams: Record<string, string>
}

export function ExportButton({ searchParams }: ExportButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleExport() {
    setLoading(true)
    try {
      // Fetch all matching records (no limit)
      const params = new URLSearchParams({ ...searchParams, limit: "10000", offset: "0" })
      const res = await fetch(`/api/properties?${params}`)
      const { data } = await res.json()

      if (!data?.length) return

      // Build CSV
      const headers = [
        "BBL", "Address", "Borough", "Benefit Type", "Start Year", "Expiration Year",
        "Phase-Out Start", "Status", "Annual Exempt ($)", "Assessed Value ($)",
        "Building Class", "Total Units", "Violations (12mo)",
        "Last Sale Price ($)", "Last Deed Date", "Mortgage Amount ($)", "Lender",
        "Ownership (yrs)", "Zoning", "Year Built", "Distress Score", "Flags",
      ]

      const rows = data.map((p: Record<string, unknown>) => [
        p.bbl,
        `"${String(p.address ?? "").replace(/"/g, '""')}"`,
        p.borough,
        `"${String(p.benefit_type ?? "").replace(/"/g, '""')}"`,
        p.benefit_start_year,
        p.expiration_year,
        p.phase_out_start_year,
        p.expiration_status,
        p.annual_exempt_amount,
        p.assessed_value,
        p.building_class,
        p.total_units,
        p.violation_count_12mo,
        p.last_sale_price,
        p.last_deed_date,
        p.last_mortgage_amount,
        `"${String(p.lender_name ?? "").replace(/"/g, '""')}"`,
        p.ownership_years,
        p.zoning,
        p.year_built,
        p.distress_score,
        `"${((p.edge_case_flags as string[]) ?? []).join("|")}"`,
      ])

      const csv = [headers.join(","), ...rows.map((r: unknown[]) => r.join(","))].join("\n")
      const blob = new Blob([csv], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `nyc-abatement-pipeline-${new Date().toISOString().split("T")[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={loading}>
      <Download className="size-4 mr-1.5" />
      {loading ? "Exporting..." : "Export CSV"}
    </Button>
  )
}
