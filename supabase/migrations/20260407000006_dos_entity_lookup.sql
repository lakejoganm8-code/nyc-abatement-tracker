-- Phase E: NY DOS LLC entity lookup fields on acris_records
ALTER TABLE acris_records
  ADD COLUMN IF NOT EXISTS dos_entity_status TEXT,
  ADD COLUMN IF NOT EXISTS dos_agent_name TEXT,
  ADD COLUMN IF NOT EXISTS dos_agent_address TEXT,
  ADD COLUMN IF NOT EXISTS dos_search_url TEXT,
  ADD COLUMN IF NOT EXISTS dos_date_of_formation TEXT;

-- Rebuild property_pipeline view to include DOS fields
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
    COALESCE(a.dof_market_value, NULLIF(e.assessed_value, 0) / 0.45::numeric) AS estimated_market_value,
    a.dos_entity_status,
    a.dos_agent_name,
    a.dos_agent_address,
    a.dos_search_url,
    a.dos_date_of_formation,
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
    COALESCE(s.tax_lien_component, 0)         AS tax_lien_component,
    COALESCE(s.housing_court_component, 0)    AS housing_court_component,
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
