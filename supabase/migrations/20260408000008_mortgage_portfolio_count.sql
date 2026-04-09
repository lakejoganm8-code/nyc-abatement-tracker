-- Portfolio loan detection: track how many BBLs share an ACRIS mortgage document.
-- When a single mortgage is recorded against N buildings, the document_amt is the
-- total facility. We divide by N in the pipeline to get per-building allocation.
-- Applied 2026-04-08

ALTER TABLE acris_records
  ADD COLUMN IF NOT EXISTS mortgage_portfolio_count INT;

-- View rebuilt to expose mortgage_portfolio_count
-- (full view DDL applied via MCP apply_migration)
