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
import { Search, X } from "lucide-react"

const CURRENT_YEAR = new Date().getFullYear()

export function FilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const searchRef = useRef<HTMLInputElement>(null)

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

  const borough = searchParams.get("borough") ?? "all"
  const expiresFrom = searchParams.get("expiresFrom") ?? String(CURRENT_YEAR)
  const expiresTo = searchParams.get("expiresTo") ?? String(CURRENT_YEAR + 2)
  const minScore = searchParams.get("minScore") ?? "0"
  const search = searchParams.get("search") ?? ""

  const hasFilters = searchParams.toString().length > 0

  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={searchRef}
          type="text"
          placeholder="Address or BBL…"
          className="pl-8 w-52 h-8 text-xs bg-muted/50 border-border/60 focus:bg-card"
          defaultValue={search}
          onBlur={(e) => updateParam("search", e.target.value || null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") updateParam("search", (e.target as HTMLInputElement).value || null)
            if (e.key === "Escape") { (e.target as HTMLInputElement).value = ""; updateParam("search", null) }
          }}
        />
      </div>

      <div className="h-4 w-px bg-border/60" />

      {/* Borough */}
      <Select value={borough} onValueChange={(v) => updateParam("borough", v)}>
        <SelectTrigger className="h-8 w-36 text-xs bg-muted/50 border-border/60">
          <SelectValue placeholder="All boroughs" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All boroughs</SelectItem>
          <SelectItem value="manhattan">Manhattan</SelectItem>
          <SelectItem value="brooklyn">Brooklyn</SelectItem>
          <SelectItem value="bronx">Bronx</SelectItem>
          <SelectItem value="queens">Queens</SelectItem>
          <SelectItem value="staten_island">Staten Island</SelectItem>
        </SelectContent>
      </Select>

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
        <SelectTrigger className="h-8 w-36 text-xs bg-muted/50 border-border/60">
          <SelectValue placeholder="Min score" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="0">All scores</SelectItem>
          <SelectItem value="40">Score ≥ 40</SelectItem>
          <SelectItem value="60">Score ≥ 60</SelectItem>
          <SelectItem value="75">Score ≥ 75 (High)</SelectItem>
        </SelectContent>
      </Select>

      {/* Min units */}
      <Input
        type="number"
        placeholder="Min units"
        className="w-24 h-8 text-xs bg-muted/50 border-border/60"
        defaultValue={searchParams.get("minUnits") ?? ""}
        onBlur={(e) => updateParam("minUnits", e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") updateParam("minUnits", (e.target as HTMLInputElement).value)
        }}
        min={0}
      />

      {/* Owner search */}
      <Input
        type="text"
        placeholder="Owner"
        className="w-32 h-8 text-xs bg-muted/50 border-border/60"
        defaultValue={searchParams.get("owner") ?? ""}
        onBlur={(e) => updateParam("owner", e.target.value || null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") updateParam("owner", (e.target as HTMLInputElement).value || null)
        }}
      />

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
  )
}
