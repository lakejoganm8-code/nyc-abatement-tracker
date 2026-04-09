-- Valuation + owner profile columns on property_scores
-- Applied 2026-04-08

ALTER TABLE property_scores
  ADD COLUMN IF NOT EXISTS gross_rent_estimate BIGINT,
  ADD COLUMN IF NOT EXISTS noi_current BIGINT,
  ADD COLUMN IF NOT EXISTS noi_post_expiration BIGINT,
  ADD COLUMN IF NOT EXISTS implied_value_current BIGINT,
  ADD COLUMN IF NOT EXISTS implied_value_post_expiration BIGINT,
  ADD COLUMN IF NOT EXISTS value_delta BIGINT,
  ADD COLUMN IF NOT EXISTS break_even_occupancy NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS owner_type TEXT,
  ADD COLUMN IF NOT EXISTS portfolio_size INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_portfolio_tax_shock BIGINT,
  ADD COLUMN IF NOT EXISTS refi_pressure BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sell_likelihood_score INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sell_likelihood_label TEXT,
  ADD COLUMN IF NOT EXISTS sell_signals TEXT[],
  ADD COLUMN IF NOT EXISTS suppress_from_leads BOOLEAN DEFAULT FALSE;

-- property_pipeline view rebuilt in apply_migration call (see migration script)
