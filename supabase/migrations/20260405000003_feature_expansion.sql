-- Feature expansion: owner name, evictions, HCR stabilization, rent upside, deregulation risk
-- Applied 2026-04-05

-- acris_records: owner name (deed grantee)
ALTER TABLE acris_records ADD COLUMN IF NOT EXISTS owner_name TEXT;

-- hpd_data: HPD registration ID (for eviction matching) + eviction counts
ALTER TABLE hpd_data
  ADD COLUMN IF NOT EXISTS registration_id TEXT,
  ADD COLUMN IF NOT EXISTS eviction_count_12mo INT DEFAULT 0;

-- exemptions: HCR rent stabilization status
ALTER TABLE exemptions
  ADD COLUMN IF NOT EXISTS is_rent_stabilized BOOLEAN,
  ADD COLUMN IF NOT EXISTS stabilization_source TEXT;
-- stabilization_source values: 'hcr_registered' | '421a_active' | 'j51_active' | 'deregulated_risk'

-- property_scores: computed enrichment fields
ALTER TABLE property_scores
  ADD COLUMN IF NOT EXISTS estimated_annual_rent_upside NUMERIC,
  ADD COLUMN IF NOT EXISTS deregulation_risk TEXT,   -- 'high' | 'medium' | 'low'
  ADD COLUMN IF NOT EXISTS ami_tier TEXT;            -- '60%' | '80%' | 'market' | 'none'

-- Rebuild property_pipeline view to expose all new columns
DROP VIEW IF EXISTS property_pipeline;

CREATE VIEW property_pipeline AS
  SELECT
    e.bbl,
    COALESCE(p.address, 'BBL ' || e.bbl)     AS address,
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
    e.is_rent_stabilized,
    e.stabilization_source,
    COALESCE(p.total_units, h.total_units)    AS total_units,
    h.violation_count_12mo,
    h.registration_status,
    COALESCE(h.eviction_count_12mo, 0)        AS eviction_count_12mo,
    p.zoning,
    p.far,
    p.year_built,
    p.neighborhood,
    p.latitude,
    p.longitude,
    a.last_deed_date,
    a.last_sale_price,
    a.last_mortgage_amount,
    a.mortgage_date,
    a.lender_name,
    a.owner_name,
    a.ownership_years,
    COALESCE(s.distress_score, 0)             AS distress_score,
    s.tax_impact_component,
    s.time_component,
    s.debt_component,
    s.ownership_component,
    s.violation_component,
    s.estimated_annual_rent_upside,
    s.deregulation_risk,
    s.ami_tier
  FROM exemptions e
  LEFT JOIN hpd_data        h ON h.bbl = e.bbl
  LEFT JOIN pluto_data      p ON p.bbl = e.bbl
  LEFT JOIN acris_records   a ON a.bbl = e.bbl
  LEFT JOIN property_scores s ON s.bbl = e.bbl
  WHERE e.expiration_status IN ('APPROACHING', 'IN_PHASE_OUT');
