-- Add lat/lng to pluto_data for map display
ALTER TABLE pluto_data
  ADD COLUMN IF NOT EXISTS latitude  NUMERIC,
  ADD COLUMN IF NOT EXISTS longitude NUMERIC;

-- Spatial index for map queries
CREATE INDEX IF NOT EXISTS idx_pluto_coords ON pluto_data (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Must drop and recreate view when adding new columns
DROP VIEW IF EXISTS property_pipeline;

CREATE VIEW property_pipeline AS
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
    p.latitude,
    p.longitude,
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
