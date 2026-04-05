"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useCallback } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const CURRENT_YEAR = new Date().getFullYear()

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

  const borough = searchParams.get("borough") ?? "all"
  const expiresFrom = searchParams.get("expiresFrom") ?? String(CURRENT_YEAR)
  const expiresTo = searchParams.get("expiresTo") ?? String(CURRENT_YEAR)
  const minScore = searchParams.get("minScore") ?? "0"
  const hideCondo = searchParams.get("hideCondo") === "1"

  return (
    <div className="flex flex-wrap items-end gap-3 py-3">
      {/* Borough */}
      <Select
        value={borough}
        onValueChange={(v) => updateParam("borough", v)}
      >
        <SelectTrigger className="w-40">
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

      {/* Expiration year range */}
      <div className="flex items-end gap-1.5">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Expires from</Label>
          <Input
            type="number"
            className="w-24"
            value={expiresFrom}
            min={2020}
            max={2060}
            onChange={(e) => {
              const v = e.target.value
              if (v.length === 4) updateParam("expiresFrom", v)
            }}
            onBlur={(e) => updateParam("expiresFrom", e.target.value || String(CURRENT_YEAR))}
          />
        </div>
        <span className="pb-2 text-muted-foreground text-sm">–</span>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">to</Label>
          <Input
            type="number"
            className="w-24"
            value={expiresTo}
            min={2020}
            max={2060}
            onChange={(e) => {
              const v = e.target.value
              if (v.length === 4) updateParam("expiresTo", v)
            }}
            onBlur={(e) => updateParam("expiresTo", e.target.value || String(CURRENT_YEAR))}
          />
        </div>
      </div>

      {/* Min distress score */}
      <Select
        value={minScore}
        onValueChange={(v) => updateParam("minScore", v)}
      >
        <SelectTrigger className="w-40">
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
        className="w-28"
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
        placeholder="Owner search"
        className="w-40"
        defaultValue={searchParams.get("owner") ?? ""}
        onBlur={(e) => updateParam("owner", e.target.value || null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") updateParam("owner", (e.target as HTMLInputElement).value || null)
        }}
      />

      {/* Hide condos */}
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none pb-0.5">
        <input
          type="checkbox"
          checked={hideCondo}
          onChange={(e) => updateParam("hideCondo", e.target.checked ? "1" : null)}
          className="h-4 w-4 rounded border-input accent-primary"
        />
        Hide condos
      </label>
    </div>
  )
}
