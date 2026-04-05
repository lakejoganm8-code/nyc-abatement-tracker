"use client"

import { useRouter } from "next/navigation"
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table"
import { useState } from "react"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ScoreBadge } from "@/components/ScoreBadge"
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"

// Shape of rows from property_pipeline view
export interface PropertyRow {
  bbl: string
  address: string
  borough: string
  benefit_type: string | null
  benefit_start_year: number | null
  expiration_year: number | null
  phase_out_start_year: number | null
  expiration_status: string | null
  annual_exempt_amount: number
  building_class: string
  total_units: number | null
  violation_count_12mo: number
  distress_score: number
  edge_case_flags: string[]
  latitude: number | null
  longitude: number | null
}

const col = createColumnHelper<PropertyRow>()

const STATUS_COLORS: Record<string, string> = {
  APPROACHING: "text-destructive",
  IN_PHASE_OUT: "text-amber-600 dark:text-amber-400",
  FUTURE: "text-muted-foreground",
  EXPIRED: "text-muted-foreground line-through",
}

const BOROUGH_LABELS: Record<string, string> = {
  manhattan: "Manhattan",
  brooklyn: "Brooklyn",
  bronx: "Bronx",
  queens: "Queens",
  staten_island: "Staten Island",
}

function fmt$(n: number | null): string {
  if (!n) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

const COLUMNS = [
  col.accessor("distress_score", {
    header: "Score",
    cell: (info) => <ScoreBadge score={info.getValue()} size="sm" />,
    sortDescFirst: true,
  }),
  col.accessor("address", {
    header: "Address",
    cell: (info) => (
      <span className="max-w-[200px] truncate block font-medium text-sm">
        {info.getValue() || info.row.original.bbl}
      </span>
    ),
  }),
  col.accessor("borough", {
    header: "Borough",
    cell: (info) => BOROUGH_LABELS[info.getValue()] ?? info.getValue(),
  }),
  col.accessor("expiration_year", {
    header: "Expires",
    cell: (info) => {
      const year = info.getValue()
      const status = info.row.original.expiration_status
      return (
        <span className={cn("font-medium", status ? STATUS_COLORS[status] : "")}>
          {year ?? "—"}
        </span>
      )
    },
  }),
  col.accessor("expiration_status", {
    header: "Status",
    cell: (info) => {
      const s = info.getValue()
      if (!s) return "—"
      const label = s === "IN_PHASE_OUT" ? "Phase-Out" : s.charAt(0) + s.slice(1).toLowerCase()
      return (
        <span className={cn("text-xs font-medium", STATUS_COLORS[s] ?? "")}>
          {label}
        </span>
      )
    },
  }),
  col.accessor("annual_exempt_amount", {
    header: "Annual Exempt",
    cell: (info) => (
      <span className="tabular-nums">{fmt$(info.getValue())}</span>
    ),
  }),
  col.accessor("total_units", {
    header: "Units",
    cell: (info) => info.getValue() ?? "—",
  }),
  col.accessor("violation_count_12mo", {
    header: "Violations",
    cell: (info) => {
      const v = info.getValue()
      return (
        <span className={v >= 10 ? "text-destructive font-semibold" : ""}>
          {v}
        </span>
      )
    },
  }),
  col.accessor("building_class", {
    header: "Class",
    cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
  }),
  col.accessor("edge_case_flags", {
    header: "Flags",
    enableSorting: false,
    cell: (info) => {
      const flags = info.getValue() ?? []
      if (!flags.length) return null
      return (
        <span className="text-xs text-muted-foreground">
          {flags.join(", ")}
        </span>
      )
    },
  }),
]

interface PropertyTableProps {
  data: PropertyRow[]
}

export function PropertyTable({ data }: PropertyTableProps) {
  const router = useRouter()
  const [sorting, setSorting] = useState<SortingState>([
    { id: "distress_score", desc: true },
  ])

  const table = useReactTable({
    data,
    columns: COLUMNS,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id}>
            {hg.headers.map((header) => (
              <TableHead
                key={header.id}
                className={header.column.getCanSort() ? "cursor-pointer select-none" : ""}
                onClick={header.column.getToggleSortingHandler()}
              >
                <span className="inline-flex items-center gap-1">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getCanSort() && (
                    header.column.getIsSorted() === "asc" ? <ArrowUp className="size-3" /> :
                    header.column.getIsSorted() === "desc" ? <ArrowDown className="size-3" /> :
                    <ArrowUpDown className="size-3 opacity-40" />
                  )}
                </span>
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            className="cursor-pointer"
            onClick={() => router.push(`/property/${row.original.bbl}`)}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
        {!data.length && (
          <TableRow>
            <TableCell colSpan={COLUMNS.length} className="text-center text-muted-foreground py-12">
              No properties found. Run the pipeline to populate data.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
