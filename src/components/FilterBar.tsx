"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useCallback, useRef } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Search, X, Flame } from "lucide-react"
import { cn } from "@/lib/utils"
import { LEAD_FILTERS, CHIP_ACTIVE_STYLES } from "@/lib/analysis/lead-filters"

const CURRENT_YEAR = new Date().getFullYear()

const BOROUGHS = [
  { value: "manhattan",    label: "MN" },
  { value: "brooklyn",     label: "BK" },
  { value: "bronx",        label: "BX" },
  { value: "queens",       label: "QN" },
  { value: "staten_island",label: "SI" },
]

export function FilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value && value !== "all" && value !== "0") {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  const clearAll = useCallback(() => {
    router.push(pathname)
  }, [router, pathname])

  // Multi-borough: stored as comma-separated string
  const boroughsParam = searchParams.get("boroughs") ?? ""
  const selectedBoroughs = boroughsParam ? boroughsParam.split(",") : []

  const toggleBorough = useCallback((boro: string) => {
    const next = selectedBoroughs.includes(boro)
      ? selectedBoroughs.filter((b) => b !== boro)
      : [...selectedBoroughs, boro]
    const params = new URLSearchParams(searchParams.toString())
    if (next.length > 0) {
      params.set("boroughs", next.join(","))
    } else {
      params.delete("boroughs")
    }
    router.push(`${pathname}?${params.toString()}`)
  }, [selectedBoroughs, searchParams, router, pathname])

  const expiresFrom   = searchParams.get("expiresFrom") ?? String(CURRENT_YEAR)
  const expiresTo     = searchParams.get("expiresTo")   ?? String(CURRENT_YEAR + 2)
  const minScore      = searchParams.get("minScore")    ?? "0"
  const search        = searchParams.get("search")      ?? ""
  const minUnits      = searchParams.get("minUnits")    ?? ""
  const maxUnits      = searchParams.get("maxUnits")    ?? ""
  const minPrice      = searchParams.get("minPrice")    ?? ""
  const maxPrice      = searchParams.get("maxPrice")    ?? ""
  const maxPortfolio  = searchParams.get("maxPortfolio") ?? ""
  const owner         = searchParams.get("owner")       ?? ""
  const motivatedOnly = searchParams.get("motivatedOnly") === "1"

  // Lead list filters: comma-separated e.g. "tired_landlord,high_refi"
  const leadFiltersParam = searchParams.get("leadFilters") ?? ""
  const selectedLeadFilters = leadFiltersParam ? leadFiltersParam.split(",") : []

  const toggleLeadFilter = useCallback((value: string) => {
    const next = selectedLeadFilters.includes(value)
      ? selectedLeadFilters.filter((f) => f !== value)
      : [...selectedLeadFilters, value]
    const params = new URLSearchParams(searchParams.toString())
    if (next.length > 0) {
      params.set("leadFilters", next.join(","))
    } else {
      params.delete("leadFilters")
    }
    router.push(`${pathname}?${params.toString()}`)
  }, [selectedLeadFilters, searchParams, router, pathname])

  const hasFilters = searchParams.toString().length > 0

  return (
    <div className="flex flex-col gap-1.5 py-2.5">
      {/* Row 1: search, boroughs, expiry, score, motivated toggle */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Address or BBL…"
            className="pl-8 w-48 h-8 text-xs bg-muted/50 border-border/60 focus:bg-card"
            defaultValue={search}
            onBlur={(e) => updateParam("search", e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") updateParam("search", (e.target as HTMLInputElement).value || null)
              if (e.key === "Escape") { (e.target as HTMLInputElement).value = ""; updateParam("search", null) }
            }}
          />
        </div>

        <div className="h-4 w-px bg-border/60" />

        {/* Multi-borough toggles */}
        <div className="flex items-center gap-1">
          {BOROUGHS.map((b) => (
            <button
              key={b.value}
              onClick={() => toggleBorough(b.value)}
              className={cn(
                "h-8 px-2.5 rounded text-[11px] font-mono font-medium border transition-all",
                selectedBoroughs.includes(b.value)
                  ? "bg-primary/20 border-primary/50 text-primary"
                  : "bg-muted/50 border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
              )}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-border/60" />

        {/* Expiration range */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Expires</span>
          <Input
            type="number"
            className="w-20 h-8 text-xs bg-muted/50 border-border/60 font-mono"
            value={expiresFrom}
            min={2020} max={2060}
            onChange={(e) => { if (e.target.value.length === 4) updateParam("expiresFrom", e.target.value) }}
            onBlur={(e) => updateParam("expiresFrom", e.target.value || String(CURRENT_YEAR))}
          />
          <span className="text-[11px] text-muted-foreground">–</span>
          <Input
            type="number"
            className="w-20 h-8 text-xs bg-muted/50 border-border/60 font-mono"
            value={expiresTo}
            min={2020} max={2060}
            onChange={(e) => { if (e.target.value.length === 4) updateParam("expiresTo", e.target.value) }}
            onBlur={(e) => updateParam("expiresTo", e.target.value || String(CURRENT_YEAR + 2))}
          />
        </div>

        <div className="h-4 w-px bg-border/60" />

        {/* Distress score */}
        <Select value={minScore} onValueChange={(v) => updateParam("minScore", v)}>
          <SelectTrigger className="h-8 w-32 text-xs bg-muted/50 border-border/60">
            <SelectValue placeholder="Min score" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">All scores</SelectItem>
            <SelectItem value="40">Score ≥ 40</SelectItem>
            <SelectItem value="60">Score ≥ 60</SelectItem>
            <SelectItem value="75">Score ≥ 75</SelectItem>
          </SelectContent>
        </Select>

        {/* Motivated sellers toggle */}
        <button
          onClick={() => updateParam("motivatedOnly", motivatedOnly ? null : "1")}
          className={cn(
            "flex items-center gap-1.5 h-8 px-3 rounded text-[11px] font-medium border transition-all",
            motivatedOnly
              ? "bg-amber-950/60 border-amber-700/60 text-amber-300"
              : "bg-muted/50 border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
          )}
        >
          <Flame className="size-3" />
          Motivated sellers
        </button>

        {/* Clear all */}
        {hasFilters && (
          <button
            onClick={clearAll}
            className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3" /> Clear
          </button>
        )}
      </div>

      {/* Row 2: units, price, portfolio, owner */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Units range */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Units</span>
          <Input
            type="number"
            placeholder="min"
            className="w-16 h-7 text-xs bg-muted/50 border-border/60 font-mono"
            defaultValue={minUnits}
            min={0}
            onBlur={(e) => updateParam("minUnits", e.target.value || null)}
            onKeyDown={(e) => { if (e.key === "Enter") updateParam("minUnits", (e.target as HTMLInputElement).value || null) }}
          />
          <span className="text-[11px] text-muted-foreground">–</span>
          <Input
            type="number"
            placeholder="max"
            className="w-16 h-7 text-xs bg-muted/50 border-border/60 font-mono"
            defaultValue={maxUnits}
            min={0}
            onBlur={(e) => updateParam("maxUnits", e.target.value || null)}
            onKeyDown={(e) => { if (e.key === "Enter") updateParam("maxUnits", (e.target as HTMLInputElement).value || null) }}
          />
        </div>

        <div className="h-4 w-px bg-border/60" />

        {/* Purchase price range */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Purchased</span>
          <Input
            type="number"
            placeholder="min $"
            className="w-24 h-7 text-xs bg-muted/50 border-border/60 font-mono"
            defaultValue={minPrice}
            min={0}
            onBlur={(e) => updateParam("minPrice", e.target.value || null)}
            onKeyDown={(e) => { if (e.key === "Enter") updateParam("minPrice", (e.target as HTMLInputElement).value || null) }}
          />
          <span className="text-[11px] text-muted-foreground">–</span>
          <Input
            type="number"
            placeholder="max $"
            className="w-24 h-7 text-xs bg-muted/50 border-border/60 font-mono"
            defaultValue={maxPrice}
            min={0}
            onBlur={(e) => updateParam("maxPrice", e.target.value || null)}
            onKeyDown={(e) => { if (e.key === "Enter") updateParam("maxPrice", (e.target as HTMLInputElement).value || null) }}
          />
        </div>

        <div className="h-4 w-px bg-border/60" />

        {/* Max portfolio size */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Portfolio ≤</span>
          <Input
            type="number"
            placeholder="# bldgs"
            className="w-20 h-7 text-xs bg-muted/50 border-border/60 font-mono"
            defaultValue={maxPortfolio}
            min={1}
            onBlur={(e) => updateParam("maxPortfolio", e.target.value || null)}
            onKeyDown={(e) => { if (e.key === "Enter") updateParam("maxPortfolio", (e.target as HTMLInputElement).value || null) }}
          />
        </div>

        <div className="h-4 w-px bg-border/60" />

        {/* Owner search */}
        <Input
          type="text"
          placeholder="Owner name"
          className="w-36 h-7 text-xs bg-muted/50 border-border/60"
          defaultValue={owner}
          onBlur={(e) => updateParam("owner", e.target.value || null)}
          onKeyDown={(e) => { if (e.key === "Enter") updateParam("owner", (e.target as HTMLInputElement).value || null) }}
        />
      </div>

      {/* Row 3: Lead type filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground font-medium shrink-0">Lead type</span>
        <div className="h-4 w-px bg-border/60" />
        {LEAD_FILTERS.map((f) => (
          <button
            key={f.value}
            title={f.description}
            onClick={() => toggleLeadFilter(f.value)}
            className={cn(
              "h-7 px-2.5 rounded text-[11px] font-medium border transition-all",
              selectedLeadFilters.includes(f.value)
                ? CHIP_ACTIVE_STYLES[f.color]
                : "bg-muted/50 border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  )
}
