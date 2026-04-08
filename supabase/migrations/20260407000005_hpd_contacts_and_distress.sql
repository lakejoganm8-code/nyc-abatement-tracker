-- property_scores: new score components for Phase C
ALTER TABLE property_scores
  ADD COLUMN IF NOT EXISTS tax_lien_component NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS housing_court_component NUMERIC DEFAULT 0;

-- Phase B: HPD Registration Contacts table
CREATE TABLE IF NOT EXISTS hpd_contacts (
  bbl                   TEXT PRIMARY KEY,
  registration_id       TEXT,
  owner_name            TEXT,
  owner_type            TEXT,
  owner_phone           TEXT,
  owner_mailing_address TEXT,
  agent_name            TEXT,
  agent_phone           TEXT,
  agent_address         TEXT,
  fetched_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Phase C: Distress enrichment columns on exemptions + new tables
-- Tax lien flag (from DOF tax lien sale list 9rz4-mjek)
ALTER TABLE exemptions ADD COLUMN IF NOT EXISTS has_tax_lien BOOLEAN DEFAULT FALSE;

-- DOB violation count
ALTER TABLE exemptions ADD COLUMN IF NOT EXISTS dob_violation_count INT DEFAULT 0;

-- Housing court HP actions + nonpayment proceedings (last 12mo)
ALTER TABLE exemptions ADD COLUMN IF NOT EXISTS hp_action_count INT DEFAULT 0;
ALTER TABLE exemptions ADD COLUMN IF NOT EXISTS nonpayment_count INT DEFAULT 0;

-- Phase D: DOF market value (from 8y4t-faws)
ALTER TABLE acris_records ADD COLUMN IF NOT EXISTS dof_market_value BIGINT;

-- Rebuild property_pipeline view with new columns
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
    e.condo_unit_count,
    -- Phase C distress fields
    COALESCE(e.has_tax_lien,          FALSE)  AS has_tax_lien,
    COALESCE(e.dob_violation_count,   0)      AS dob_violation_count,
    COALESCE(e.hp_action_count,       0)      AS hp_action_count,
    COALESCE(e.nonpayment_count,      0)      AS nonpayment_count,
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
    -- Phase D: use DOF market value when available, fallback to assessed/0.45
    COALESCE(a.dof_market_value, NULLIF(e.assessed_value, 0) / 0.45::numeric) AS estimated_market_value,
    -- Phase B: HPD contacts
    c.owner_name           AS hpd_owner_name,
    c.owner_phone          AS hpd_owner_phone,
    c.owner_mailing_address AS hpd_owner_address,
    c.owner_type           AS hpd_owner_type,
    c.agent_name           AS hpd_agent_name,
    c.agent_phone          AS hpd_agent_phone,
    c.agent_address        AS hpd_agent_address,
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
  LEFT JOIN hpd_contacts    c ON c.bbl = e.bbl
  LEFT JOIN property_scores s ON s.bbl = e.bbl
  WHERE e.expiration_status IN ('APPROACHING', 'IN_PHASE_OUT');
