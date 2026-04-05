/**
 * Shared BBL parsing utilities.
 * NYC BBLs are 10-digit strings: boro(1) + block(5) + lot(4).
 * Many NYC datasets (HPD, HCR, ACRIS) store boro/block/lot as separate
 * unpadded columns, requiring OR-clause matching rather than string concat.
 */

/** Parse a 10-digit padded BBL into boro/block/lot parts (unpadded, as stored in NYC datasets) */
export function parseBBLParts(bbl: string): { boro: string; block: string; lot: string } {
  const clean = bbl.replace(/\D/g, "").padStart(10, "0")
  return {
    boro: clean[0],
    block: String(parseInt(clean.slice(1, 6), 10)), // strip leading zeros
    lot: String(parseInt(clean.slice(6, 10), 10)),  // strip leading zeros
  }
}

/**
 * Build an OR-clause for HPD/HCR datasets that use `boroid`, `block`, `lot` columns.
 * e.g. (boroid='1' AND block='234' AND lot='5') OR ...
 */
export function buildBBLOrClause(bbls: string[]): string {
  return bbls
    .map((b) => {
      const { boro, block, lot } = parseBBLParts(b)
      return `(boroid='${boro}' AND block='${block}' AND lot='${lot}')`
    })
    .join(" OR ")
}

/**
 * Build an OR-clause for ACRIS datasets that use `borough`, `block`, `lot` columns.
 * e.g. (borough='1' AND block='234' AND lot='5') OR ...
 */
export function buildACRISOrClause(bbls: string[]): string {
  return bbls
    .map((b) => {
      const { boro, block, lot } = parseBBLParts(b)
      return `(borough='${boro}' AND block='${block}' AND lot='${lot}')`
    })
    .join(" OR ")
}

/** Reconstruct 10-digit padded BBL from a dataset row with separate boro/block/lot fields */
export function rowToBBL(
  row: Record<string, string>,
  boroField = "boroid"
): string {
  const boro = row[boroField] ?? "0"
  const block = (row.block ?? "0").padStart(5, "0")
  const lot = (row.lot ?? "0").padStart(4, "0")
  return `${boro}${block}${lot}`
}
