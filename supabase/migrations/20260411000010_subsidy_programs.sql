-- Subsidy programs table + view rebuild
-- Programs: SCRIE, DRIE, MITCHELL_LAMA, HPD_AFFORDABLE, LIHTC, SECTION_8

CREATE TABLE IF NOT EXISTS subsidy_programs (
  bbl                   text        NOT NULL,
  program               text        NOT NULL,
  program_detail        text,
  units_assisted        integer,
  start_date            date,
  end_date              date,
  is_active             boolean     DEFAULT true,
  -- SCRIE / DRIE
  scrie_active_tenants  integer,
  scrie_total_monthly_credit numeric(10,2),
  -- LIHTC
  lihtc_credit_year     integer,
  lihtc_compliance_end  integer,
  -- Section 8
  hud_contract_number   text,
  hud_contract_expiration date,
  -- HPD Affordable
  hpd_project_id        text,
  hpd_extended_affordability boolean,
  ami_extremely_low     integer,
  ami_very_low          integer,
  ami_low               integer,
  ami_moderate          integer,
  ami_middle            integer,
  -- Metadata
  fetched_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bbl, program)
);

CREATE INDEX IF NOT EXISTS subsidy_programs_bbl_idx      ON subsidy_programs (bbl);
CREATE INDEX IF NOT EXISTS subsidy_programs_program_idx  ON subsidy_programs (program);
CREATE INDEX IF NOT EXISTS subsidy_programs_end_date_idx ON subsidy_programs (end_date) WHERE end_date IS NOT NULL;

ALTER TABLE subsidy_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subsidy_programs_public_read" ON subsidy_programs FOR SELECT USING (true);

-- Rebuild view with subsidy columns
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
    a.mortgage_portfolio_count,
    a.lender_name,
    a.owner_name,
    a.ownership_years,
    COALESCE(a.dof_market_value, NULLIF(e.assessed_value, 0) / 0.45::numeric) AS estimated_market_value,
    a.dos_entity_status,
    a.dos_agent_name,
    a.dos_agent_address,
    a.dos_search_url,
    a.dos_date_of_formation,
    c.owner_name            AS hpd_owner_name,
    NULL::text              AS hpd_owner_phone,
    c.owner_mailing_address AS hpd_owner_address,
    c.owner_type            AS hpd_owner_type,
    c.agent_name            AS hpd_agent_name,
    NULL::text              AS hpd_agent_phone,
    c.agent_address         AS hpd_agent_address,
    a.has_affordable_commitment,
    a.reg_agreement_doc_type,
    a.reg_agreement_date,
    a.reg_agreement_url,
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
    s.ami_tier,
    s.gross_rent_estimate,
    s.noi_current,
    s.noi_post_expiration,
    s.implied_value_current,
    s.implied_value_post_expiration,
    s.value_delta,
    s.break_even_occupancy,
    s.owner_type,
    COALESCE(s.portfolio_size, 1)             AS portfolio_size,
    s.total_portfolio_tax_shock,
    COALESCE(s.refi_pressure, FALSE)          AS refi_pressure,
    COALESCE(s.sell_likelihood_score, 0)      AS sell_likelihood_score,
    s.sell_likelihood_label,
    s.sell_signals,
    COALESCE(s.suppress_from_leads, FALSE)    AS suppress_from_leads,
    COALESCE(sp_scrie.scrie_active_tenants, 0)            AS scrie_active_tenants,
    sp_scrie.scrie_total_monthly_credit,
    COALESCE(sp_drie.scrie_active_tenants, 0)             AS drie_active_tenants,
    sp_drie.scrie_total_monthly_credit                    AS drie_total_monthly_credit,
    (sp_ml.bbl IS NOT NULL)                               AS is_mitchell_lama,
    sp_ml.program_detail                                  AS mitchell_lama_program,
    (sp_hpd.bbl IS NOT NULL)                              AS has_hpd_affordable,
    sp_hpd.hpd_extended_affordability,
    sp_hpd.ami_extremely_low,
    sp_hpd.ami_very_low,
    sp_hpd.ami_low,
    sp_hpd.ami_moderate,
    sp_hpd.ami_middle,
    sp_hpd.units_assisted                                 AS hpd_affordable_units,
    (sp_lihtc.bbl IS NOT NULL)                            AS has_lihtc,
    sp_lihtc.lihtc_credit_year,
    sp_lihtc.lihtc_compliance_end,
    sp_lihtc.units_assisted                               AS lihtc_units,
    (sp_s8.bbl IS NOT NULL)                               AS has_section8,
    sp_s8.hud_contract_number,
    sp_s8.hud_contract_expiration,
    sp_s8.units_assisted                                  AS section8_units,
    sp_s8.program_detail                                  AS section8_program,
    (a.ownership_years >= 15 AND COALESCE(s.suppress_from_leads, FALSE) = FALSE) AS is_tired_landlord,
    (a.last_mortgage_amount IS NULL)                      AS is_free_and_clear,
    COALESCE(s.refi_pressure, FALSE)                      AS is_high_refi_pressure,
    (COALESCE(e.has_tax_lien, FALSE) = TRUE OR COALESCE(e.nonpayment_count, 0) > 0) AS is_tax_distress,
    (a.last_mortgage_amount IS NOT NULL AND s.implied_value_current IS NOT NULL AND a.last_mortgage_amount > s.implied_value_current) AS is_upside_down,
    (s.value_delta IS NOT NULL AND s.value_delta > 500000) AS is_large_value_drop
  FROM exemptions e
  LEFT JOIN hpd_data        h         ON h.bbl  = e.bbl
  LEFT JOIN pluto_data      p         ON p.bbl  = e.bbl
  LEFT JOIN acris_records   a         ON a.bbl  = e.bbl
  LEFT JOIN hpd_contacts    c         ON c.bbl  = e.bbl
  LEFT JOIN property_scores s         ON s.bbl  = e.bbl
  LEFT JOIN subsidy_programs sp_scrie ON sp_scrie.bbl = e.bbl AND sp_scrie.program = 'SCRIE'
  LEFT JOIN subsidy_programs sp_drie  ON sp_drie.bbl  = e.bbl AND sp_drie.program  = 'DRIE'
  LEFT JOIN subsidy_programs sp_ml    ON sp_ml.bbl    = e.bbl AND sp_ml.program    = 'MITCHELL_LAMA'
  LEFT JOIN subsidy_programs sp_hpd   ON sp_hpd.bbl   = e.bbl AND sp_hpd.program  = 'HPD_AFFORDABLE'
  LEFT JOIN subsidy_programs sp_lihtc ON sp_lihtc.bbl = e.bbl AND sp_lihtc.program = 'LIHTC'
  LEFT JOIN subsidy_programs sp_s8    ON sp_s8.bbl    = e.bbl AND sp_s8.program    = 'SECTION_8'
  WHERE e.expiration_status IN ('APPROACHING', 'IN_PHASE_OUT');
