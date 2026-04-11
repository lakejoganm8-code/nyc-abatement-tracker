export interface LeadFilter {
  value: string       // URL param value, e.g. "tired_landlord"
  dbColumn: string    // view column, e.g. "is_tired_landlord"
  label: string       // "Tired Landlord"
  shortLabel: string  // for table micro-badges
  description: string // native tooltip copy
  color: "amber" | "red" | "emerald" | "violet" | "orange" | "sky"
}

export const LEAD_FILTERS: LeadFilter[] = [
  {
    value: "tired_landlord",
    dbColumn: "is_tired_landlord",
    label: "Tired Landlord",
    shortLabel: "Tired",
    description: "Owned 15+ years, non-institutional. Long basis, seller fatigue likely.",
    color: "amber",
  },
  {
    value: "free_clear",
    dbColumn: "is_free_and_clear",
    label: "Free & Clear",
    shortLabel: "F&C",
    description: "No recorded mortgage. High equity, flexible pricing.",
    color: "emerald",
  },
  {
    value: "high_refi",
    dbColumn: "is_high_refi_pressure",
    label: "Refi Pressure",
    shortLabel: "Refi",
    description: "Pre-2020 mortgage expiring ≤2 years. Faces 7%+ refi into compressed NOI.",
    color: "red",
  },
  {
    value: "tax_distress",
    dbColumn: "is_tax_distress",
    label: "Tax Distress",
    shortLabel: "Tax",
    description: "On tax lien sale list or has nonpayment proceedings.",
    color: "red",
  },
  {
    value: "upside_down",
    dbColumn: "is_upside_down",
    label: "Upside Down",
    shortLabel: "↓Equity",
    description: "Mortgage exceeds implied current value. Negative equity.",
    color: "orange",
  },
  {
    value: "value_drop",
    dbColumn: "is_large_value_drop",
    label: "Value Drop",
    shortLabel: "ValDrop",
    description: "Implied value drops >$500k post-abatement expiration.",
    color: "violet",
  },
]

// Active chip styles (dark theme)
export const CHIP_ACTIVE_STYLES: Record<LeadFilter["color"], string> = {
  amber:   "bg-amber-950/60 border-amber-700/60 text-amber-300",
  emerald: "bg-emerald-950/60 border-emerald-700/60 text-emerald-300",
  red:     "bg-red-950/60 border-red-700/60 text-red-300",
  orange:  "bg-orange-950/60 border-orange-700/60 text-orange-300",
  violet:  "bg-violet-950/60 border-violet-700/60 text-violet-300",
  sky:     "bg-sky-950/60 border-sky-700/60 text-sky-300",
}

// Table micro-badge styles
export const BADGE_STYLES: Record<LeadFilter["color"], string> = {
  amber:   "bg-amber-950/70 text-amber-400",
  emerald: "bg-emerald-950/70 text-emerald-400",
  red:     "bg-red-950/70 text-red-400",
  orange:  "bg-orange-950/70 text-orange-400",
  violet:  "bg-violet-950/70 text-violet-400",
  sky:     "bg-sky-950/70 text-sky-400",
}
