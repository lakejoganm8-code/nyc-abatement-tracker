-- NYC Abatement Tracker — Initial Schema
-- Run via: npx supabase db push
--          OR paste into Supabase Studio SQL editor

-- ─── Core exemption + expiration data ────────────────────────────────────────
-- Refreshed weekly by GitHub Actions pipeline from NYC Open Data muvi-b6kx + y7az-s7wc

CREATE TABLE IF NOT EXISTS exemptions (
  bbl                   TEXT PRIMARY KEY,
  address               TEXT,
  borough               TEXT,
  exemption_code        TEXT,
  tax_year              INT,
  benefit_start_year    INT,
  annual_exempt_amount  NUMERIC,
  assessed_value        NUMERIC,
  building_class        TEXT,
  -- computed by pipeline
  benefit_type          TEXT,         -- e.g. "421-a(16) Affordable New York 35yr"
  expiration_year       INT,
  phase_out_start_year  INT,
  phase_out_end_year    INT,
  expiration_status     TEXT,         -- APPROACHING | IN_PHASE_OUT | FUTURE | EXPIRED
  edge_case_flags       TEXT[],       -- UNKNOWN_CODE | MULTI_EXEMPTION | CONDO_BBL | MISSING_START_YEAR
  fetched_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exemptions_borough ON exemptions (borough);
CREATE INDEX IF NOT EXISTS idx_exemptions_status  ON exemptions (expiration_status);
CREATE INDEX IF NOT EXISTS idx_exemptions_exp_year ON exemptions (expiration_year);

-- ─── HPD building data ────────────────────────────────────────────────────────
-- Refreshed weekly: unit counts, violations

CREATE TABLE IF NOT EXISTS hpd_data (
  bbl                   TEXT PRIMARY KEY,
  total_units           INT,
  building_class        TEXT,
  registration_status   TEXT,
  violation_count_12mo  INT          NOT NULL DEFAULT 0,
  fetched_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── ACRIS deed + mortgage data ───────────────────────────────────────────────
-- Fetched per-property on-demand, cached with 24hr TTL

CREATE TABLE IF NOT EXISTS acris_records (
  bbl                   TEXT PRIMARY KEY,
  last_deed_date        DATE,
  last_sale_price       NUMERIC,
  last_mortgage_amount  NUMERIC,
  mortgage_date         DATE,
  lender_name           TEXT,
  ownership_years       NUMERIC,
  fetched_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── PLUTO enrichment ────────────────────────────────────────────────────────
-- Zoning, FAR, year built — refreshed weekly

CREATE TABLE IF NOT EXISTS pluto_data (
  bbl                   TEXT PRIMARY KEY,
  zoning                TEXT,
  far                   NUMERIC,
  lot_area              INT,
  year_built            INT,
  neighborhood          TEXT,
  fetched_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Distress scores ─────────────────────────────────────────────────────────
-- Rebuilt at the end of each pipeline run

CREATE TABLE IF NOT EXISTS property_scores (
  bbl                        TEXT PRIMARY KEY,
  distress_score             NUMERIC  NOT NULL,
  tax_impact_component       NUMERIC  NOT NULL DEFAULT 0,
  time_component             NUMERIC  NOT NULL DEFAULT 0,
  debt_component             NUMERIC  NOT NULL DEFAULT 0,
  ownership_component        NUMERIC  NOT NULL DEFAULT 0,
  violation_component        NUMERIC  NOT NULL DEFAULT 0,
  scored_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scores_distress ON property_scores (distress_score DESC);

-- ─── Pipeline run log ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id              SERIAL        PRIMARY KEY,
  dataset         TEXT          NOT NULL,
  rows_upserted   INT,
  duration_ms     INT,
  status          TEXT          NOT NULL,  -- success | error
  error           TEXT,
  ran_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Convenience view: properties ready for dashboard ────────────────────────

CREATE OR REPLACE VIEW property_pipeline AS
  SELECT
    e.bbl,
    e.address,
    e.borough,
    e.exemption_code,
    e.benefit_type,
    e.benefit_start_year,
    e.expiration_year,
    e.phase_out_start_year,
    e.expiration_status,
    e.annual_exempt_amount,
    e.assessed_value,
    e.building_class,
    e.edge_case_flags,
    -- HPD
    h.total_units,
    h.violation_count_12mo,
    h.registration_status,
    -- PLUTO
    p.zoning,
    p.far,
    p.year_built,
    p.neighborhood,
    -- ACRIS
    a.last_deed_date,
    a.last_sale_price,
    a.last_mortgage_amount,
    a.mortgage_date,
    a.lender_name,
    a.ownership_years,
    -- Score
    COALESCE(s.distress_score, 0)  AS distress_score,
    s.tax_impact_component,
    s.time_component,
    s.debt_component,
    s.ownership_component,
    s.violation_component
  FROM exemptions e
  LEFT JOIN hpd_data        h ON h.bbl = e.bbl
  LEFT JOIN pluto_data      p ON p.bbl = e.bbl
  LEFT JOIN acris_records   a ON a.bbl = e.bbl
  LEFT JOIN property_scores s ON s.bbl = e.bbl
  WHERE e.expiration_status IN ('APPROACHING', 'IN_PHASE_OUT');

-- ─── RLS: public read-only (no auth required for read) ───────────────────────

ALTER TABLE exemptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hpd_data         ENABLE ROW LEVEL SECURITY;
ALTER TABLE acris_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pluto_data       ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_scores  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs    ENABLE ROW LEVEL SECURITY;

-- Public anon can read all data (single-user app, no auth needed)
CREATE POLICY "anon_read_exemptions"      ON exemptions       FOR SELECT USING (true);
CREATE POLICY "anon_read_hpd"             ON hpd_data         FOR SELECT USING (true);
CREATE POLICY "anon_read_acris"           ON acris_records    FOR SELECT USING (true);
CREATE POLICY "anon_read_pluto"           ON pluto_data       FOR SELECT USING (true);
CREATE POLICY "anon_read_scores"          ON property_scores  FOR SELECT USING (true);
CREATE POLICY "anon_read_pipeline_runs"   ON pipeline_runs    FOR SELECT USING (true);

-- Service role (pipeline) can write all tables (enforced by using service_role key)
