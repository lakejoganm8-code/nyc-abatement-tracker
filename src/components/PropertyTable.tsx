"use client"

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table"
import { useState } from "react"
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export interface PropertyRow {
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
  building_class: string
  total_units: number | null
  violation_count_12mo: number
  eviction_count_12mo: number
  distress_score: number
  edge_case_flags: string[]
  latitude: number | null
  longitude: number | null
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
}

const col = createColumnHelper<PropertyRow>()

const CURRENT_YEAR = new Date().getFullYear()

const BOROUGH_SHORT: Record<string, string> = {
  manhattan:    "MN",
  brooklyn:     "BK",
  bronx:        "BX",
  queens:       "QN",
  staten_island:"SI",
}

function urgencyClass(row: PropertyRow): string {
  const yr = row.expiration_year
  if (!yr) return "urgency-none"
  if (yr <= CURRENT_YEAR + 1) return "urgency-critical"
  if (yr <= CURRENT_YEAR + 2) return "urgency-high"
  return "urgency-medium"
}

function fmt$(n: number | null): string {
  if (!n) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

function fmtUpside(n: number | null): string {
  if (n === null || n === 0) return "—"
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`
  return fmt$(n)
}

function ScorePill({ score }: { score: number }) {
  const color =
    score >= 75 ? "text-red-400" :
    score >= 50 ? "text-amber-400" :
    "text-muted-foreground"

  const barColor =
    score >= 75 ? "bg-red-500/70" :
    score >= 50 ? "bg-amber-500/70" :
    "bg-muted-foreground/30"

  return (
    <div className="flex items-center gap-2 w-16">
      <span className={cn("font-mono text-xs font-semibold tabular-nums w-7 text-right", color)}>
        {score.toFixed(0)}
      </span>
      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", barColor)} style={{ width: `${score}%` }} />
      </div>
    </div>
  )
}

const COLUMNS = [
  col.accessor("distress_score", {
    header: "Score",
    sortDescFirst: true,
    cell: (info) => <ScorePill score={info.getValue()} />,
  }),
  col.accessor("address", {
    header: "Address",
    cell: (info) => {
      const row = info.row.original
      const tier = row.ami_tier
      return (
        <div className="min-w-[200px] max-w-[260px]">
          <div className="truncate text-xs font-medium text-foreground">{info.getValue() || row.bbl}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {row.benefit_type && (
              <span className="text-[10px] text-muted-foreground truncate">{row.benefit_type}</span>
            )}
            {tier && tier !== "none" && (
              <span className="text-[10px] px-1 rounded bg-sky-950/60 text-sky-400 font-mono">
                {tier === "market" ? "MKT" : tier}
              </span>
            )}
          </div>
        </div>
      )
    },
  }),
  col.accessor("borough", {
    header: "Boro",
    cell: (info) => (
      <span className="font-mono text-[11px] text-muted-foreground">
        {BOROUGH_SHORT[info.getValue()] ?? info.getValue()}
      </span>
    ),
  }),
  col.accessor("expiration_year", {
    header: "Expires",
    cell: (info) => {
      const yr = info.getValue()
      const status = info.row.original.expiration_status
      const urgent = yr && yr <= CURRENT_YEAR + 1
      const soon = yr && yr <= CURRENT_YEAR + 2
      return (
        <span className={cn(
          "font-mono text-xs font-semibold tabular-nums",
          urgent ? "text-red-400" : soon ? "text-amber-400" : "text-emerald-400"
        )}>
          {yr ?? "—"}
        </span>
      )
    },
  }),
  col.accessor("expiration_status", {
    header: "Status",
    enableSorting: false,
    cell: (info) => {
      const s = info.getValue()
      if (!s) return <span className="text-muted-foreground text-[10px]">—</span>
      const label = s === "IN_PHASE_OUT" ? "Phase-Out" : s.charAt(0) + s.slice(1).toLowerCase()
      const cls =
        s === "APPROACHING" ? "text-red-400 bg-red-950/40" :
        s === "IN_PHASE_OUT" ? "text-amber-400 bg-amber-950/40" :
        "text-muted-foreground bg-muted/40"
      return (
        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", cls)}>
          {label}
        </span>
      )
    },
  }),
  col.accessor("annual_exempt_amount", {
    header: "Exempt/yr",
    sortDescFirst: true,
    cell: (info) => (
      <span className="font-mono text-xs tabular-nums text-foreground/80">
        {fmt$(info.getValue())}
      </span>
    ),
  }),
  col.accessor("estimated_annual_rent_upside", {
    header: "Upside/yr",
    sortDescFirst: true,
    cell: (info) => {
      const v = info.getValue()
      return (
        <span className={cn("font-mono text-xs tabular-nums", v ? "text-emerald-400 font-semibold" : "text-muted-foreground")}>
          {fmtUpside(v)}
        </span>
      )
    },
  }),
  col.accessor("deregulation_risk", {
    header: "Dereg",
    enableSorting: false,
    cell: (info) => {
      const r = info.getValue()
      if (!r) return <span className="text-muted-foreground text-[10px]">—</span>
      const cls =
        r === "high"   ? "text-red-400 bg-red-950/50" :
        r === "medium" ? "text-amber-400 bg-amber-950/50" :
        "text-emerald-400 bg-emerald-950/50"
      return (
        <span className={cn("text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded uppercase", cls)}>
          {r}
        </span>
      )
    },
  }),
  col.accessor("total_units", {
    header: "Units",
    cell: (info) => (
      <span className="font-mono text-xs tabular-nums text-foreground/70">
        {info.getValue() ?? "—"}
      </span>
    ),
  }),
  col.accessor("violation_count_12mo", {
    header: "Viol.",
    sortDescFirst: true,
    cell: (info) => {
      const v = info.getValue()
      return (
        <span className={cn("font-mono text-xs tabular-nums", v >= 10 ? "text-red-400 font-semibold" : v > 0 ? "text-amber-400/80" : "text-muted-foreground")}>
          {v}
        </span>
      )
    },
  }),
  col.accessor("owner_name", {
    header: "Owner",
    enableSorting: false,
    cell: (info) => {
      const name = info.getValue()
      return (
        <span className="text-[11px] text-muted-foreground truncate max-w-[140px] block">
          {name ?? "—"}
        </span>
      )
    },
  }),
]

interface PropertyTableProps {
  data: PropertyRow[]
  onRowClick: (bbl: string) => void
}

const PAGE_SIZE = 50

export function PropertyTable({ data, onRowClick }: PropertyTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "distress_score", desc: true },
  ])
  const [pageIndex, setPageIndex] = useState(0)

  const table = useReactTable({
    data,
    columns: COLUMNS,
    state: { sorting, pagination: { pageIndex, pageSize: PAGE_SIZE } },
    onSortingChange: (updater) => { setSorting(updater); setPageIndex(0) },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: false,
  })

  const pageCount = table.getPageCount()
  const rows = table.getRowModel().rows

  return (
    <div className="flex flex-col gap-0 rounded-md border border-border/60 overflow-hidden">
      {/* Scrollable table area */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border/60 bg-muted/30">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className={cn(
                      "px-3 py-2.5 text-left font-medium text-[11px] text-muted-foreground uppercase tracking-wider whitespace-nowrap sticky top-0 bg-muted/60 backdrop-blur-sm z-10",
                      header.column.getCanSort() ? "cursor-pointer select-none hover:text-foreground transition-colors" : ""
                    )}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        header.column.getIsSorted() === "asc"  ? <ArrowUp className="size-2.5 text-foreground" /> :
                        header.column.getIsSorted() === "desc" ? <ArrowDown className="size-2.5 text-foreground" /> :
                        <ArrowUpDown className="size-2.5 opacity-30" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.id}
                onClick={() => onRowClick(row.original.bbl)}
                className={cn(
                  "border-b border-border/30 cursor-pointer transition-colors",
                  urgencyClass(row.original),
                  i % 2 === 0 ? "bg-background" : "bg-card/40",
                  "hover:bg-accent/30"
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={COLUMNS.length} className="text-center text-muted-foreground py-16 font-mono text-xs">
                  No properties found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/60 bg-muted/20">
          <span className="text-[11px] text-muted-foreground font-mono">
            {pageIndex * PAGE_SIZE + 1}–{Math.min((pageIndex + 1) * PAGE_SIZE, data.length)} of {data.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPageIndex(0)}
              disabled={pageIndex === 0}
              className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              «
            </button>
            <button
              onClick={() => setPageIndex(p => Math.max(0, p - 1))}
              disabled={pageIndex === 0}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            {/* Page number pills */}
            {Array.from({ length: Math.min(7, pageCount) }, (_, i) => {
              const start = Math.max(0, Math.min(pageIndex - 3, pageCount - 7))
              const pg = start + i
              return (
                <button
                  key={pg}
                  onClick={() => setPageIndex(pg)}
                  className={cn(
                    "w-7 h-6 text-[11px] rounded font-mono transition-colors",
                    pg === pageIndex
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {pg + 1}
                </button>
              )
            })}
            <button
              onClick={() => setPageIndex(p => Math.min(pageCount - 1, p + 1))}
              disabled={pageIndex >= pageCount - 1}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="size-3.5" />
            </button>
            <button
              onClick={() => setPageIndex(pageCount - 1)}
              disabled={pageIndex >= pageCount - 1}
              className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              »
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
