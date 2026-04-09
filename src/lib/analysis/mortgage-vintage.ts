/**
 * Mortgage vintage rate estimation.
 *
 * NYC multifamily (Class 2) mortgages are mostly 5- or 10-year fixed-rate
 * with balloon maturities, or agency (Fannie/Freddie) 10-year fixed.
 * We use historical 10-year Treasury yields + typical multifamily spread
 * (175–250 bps for bank/CMBS, 150–200 bps for agency) to produce a rate range
 * for the vintage year.
 *
 * Sources used to construct the table:
 *   - Federal Reserve H.15 (10-yr Treasury monthly averages)
 *   - Freddie Mac Apartment Investment Market Index (AIMI)
 *   - CBRE/JLL cap rate + spread surveys 2010–2024
 *
 * IMPORTANT: This is a heuristic estimate for context only. The actual rate
 * depends on loan type, LTV, DSCR, lender, and terms we cannot observe.
 * Never present these as known figures.
 */

export interface VintageBucket {
  label: string          // e.g. "2014–2016"
  rateMin: number        // e.g. 3.5 (percent)
  rateMax: number        // e.g. 4.5
  pressure: "low" | "moderate" | "high" | "very high"
  note: string           // plain-English framing
  typicalTerm: string    // "5-yr" | "10-yr" | "mixed"
  likelyResetYear: number | null  // null = already reset or unknown
}

// Historical 10-yr Treasury midpoints + multifamily spread (bps)
// Spread: ~175–225 bps bank/CMBS; ~150–190 bps agency
const VINTAGE_TABLE: Array<{ from: number; to: number; bucket: VintageBucket }> = [
  {
    from: 2008, to: 2011,
    bucket: {
      label: "2008–2011",
      rateMin: 5.0, rateMax: 6.5,
      pressure: "low",
      note: "Post-GFC era — high spread, above-market rates. Most have refinanced or matured.",
      typicalTerm: "10-yr",
      likelyResetYear: null,
    },
  },
  {
    from: 2012, to: 2013,
    bucket: {
      label: "2012–2013",
      rateMin: 3.5, rateMax: 4.5,
      pressure: "high",
      note: "10-yr Treasuries ~1.7–2.5%. 10-year loans mature 2022–2023 — likely already reset into 6%+ rates. 5-year loans reset 2017–2018 (may have been extended).",
      typicalTerm: "10-yr",
      likelyResetYear: 2023,
    },
  },
  {
    from: 2014, to: 2016,
    bucket: {
      label: "2014–2016",
      rateMin: 3.75, rateMax: 4.75,
      pressure: "very high",
      note: "10-yr Treasuries ~2.0–2.5%. 10-year loans mature 2024–2026 — resetting now or imminently into 6.5–7%+ rates. Maximum refi shock window.",
      typicalTerm: "10-yr",
      likelyResetYear: 2025,
    },
  },
  {
    from: 2017, to: 2019,
    bucket: {
      label: "2017–2019",
      rateMin: 4.0, rateMax: 5.25,
      pressure: "high",
      note: "10-yr Treasuries ~2.3–3.2%. Loans maturing 2027–2029. Rate shock approaching but not yet immediate.",
      typicalTerm: "10-yr",
      likelyResetYear: 2028,
    },
  },
  {
    from: 2020, to: 2021,
    bucket: {
      label: "2020–2021",
      rateMin: 2.75, rateMax: 3.75,
      pressure: "very high",
      note: "COVID-era rate floor — historically low. 5-year loans reset 2025–2026 into 6%+ rates (near-2x debt service). 10-year loans mature 2030–2031.",
      typicalTerm: "mixed",
      likelyResetYear: 2026,
    },
  },
  {
    from: 2022, to: 2023,
    bucket: {
      label: "2022–2023",
      rateMin: 5.5, rateMax: 7.0,
      pressure: "moderate",
      note: "Rates already elevated at origination — less refi shock, but debt service is high relative to NOI. Owner paid market rates.",
      typicalTerm: "5-yr",
      likelyResetYear: 2027,
    },
  },
  {
    from: 2024, to: 2026,
    bucket: {
      label: "2024–2026",
      rateMin: 5.75, rateMax: 6.75,
      pressure: "low",
      note: "Recent vintage — at or near current market rates. No near-term refi pressure.",
      typicalTerm: "5-yr",
      likelyResetYear: 2029,
    },
  },
]

export function getMortgageVintage(mortgageDate: string | null): VintageBucket | null {
  if (!mortgageDate) return null
  const year = new Date(mortgageDate).getFullYear()
  const entry = VINTAGE_TABLE.find((e) => year >= e.from && year <= e.to)
  return entry?.bucket ?? null
}

export const PRESSURE_STYLES: Record<VintageBucket["pressure"], string> = {
  "very high": "text-red-400 bg-red-950/50",
  "high":      "text-amber-400 bg-amber-950/50",
  "moderate":  "text-sky-400 bg-sky-950/40",
  "low":       "text-emerald-400 bg-emerald-950/30",
}
