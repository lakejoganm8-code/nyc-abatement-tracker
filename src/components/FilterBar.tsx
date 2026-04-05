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
  const maxMonths = searchParams.get("maxMonths") ?? "36"
  const minScore = searchParams.get("minScore") ?? "0"

  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
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

      {/* Expiration window */}
      <Select
        value={maxMonths}
        onValueChange={(v) => updateParam("maxMonths", v)}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Expiration window" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="12">Next 12 months</SelectItem>
          <SelectItem value="24">Next 24 months</SelectItem>
          <SelectItem value="36">Next 36 months</SelectItem>
        </SelectContent>
      </Select>

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
    </div>
  )
}
