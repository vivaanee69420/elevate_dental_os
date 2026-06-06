-- ============================================================================
-- valuation_inputs + chair_config — per-org persisted CONFIG for the
-- Intelligence OS Value & Growth (valuation) and Chair Efficiency screens.
-- Phase 3 / T12. Until now these inputs lived only in transient frontend state
-- (POSTed to the pure /compute/ endpoints each keystroke) or as code constants
-- (lib/formulas.js CHAIR_CONFIG). These tables let an org SAVE its own drivers.
--
-- One row per organisation (org-level config, UNIQUE organisation_id). Mutations
-- are gated on valuation.edit / finance.edit (rule 5, owner-toggled) and audited
-- by the audit middleware (non-/compute/ PUT). MULTI-TENANT: every row carries
-- organisation_id; repos write via serviceClient with an explicit org filter
-- AND RLS is enabled as defence-in-depth (current_org_id(), reception excluded —
-- finance is owner-toggled). Money is INTEGER PENCE (rule 2).
--
-- Idempotent + additive. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================

-- ── valuation_inputs ────────────────────────────────────────────────────────
-- Columns mirror models/analytics.model.js valuationStateSchema (the compute
-- consumer): reported EBITDA + add-backs + principal salary + the three buyer
-- multiples + region factor + growth rate. Defaults match the schema defaults.
CREATE TABLE IF NOT EXISTS valuation_inputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  reported_ebitda_pence  BIGINT  NOT NULL DEFAULT 0,
  addbacks_pence         BIGINT  NOT NULL DEFAULT 0,
  principal_salary_pence BIGINT  NOT NULL DEFAULT 0,
  principal_multiple     NUMERIC NOT NULL DEFAULT 0,
  associate_multiple     NUMERIC NOT NULL DEFAULT 0,
  dso_multiple           NUMERIC NOT NULL DEFAULT 0,
  region_factor          NUMERIC NOT NULL DEFAULT 1,
  growth_rate_pct        NUMERIC NOT NULL DEFAULT 10,
  -- UI-only: the full Value & Growth screen state (region key, practice
  -- classification, DSO tier, site count, NHS %) so the screen restores
  -- faithfully on reload. The typed columns above stay the canonical,
  -- accountant-readable, compute-ready drivers; ui_state never feeds a formula.
  ui_state JSONB,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id)
);

CREATE TRIGGER valuation_inputs_updated_at BEFORE UPDATE ON valuation_inputs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE valuation_inputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS valuation_inputs_org ON valuation_inputs;
CREATE POLICY valuation_inputs_org ON valuation_inputs
  USING (organisation_id = current_org_id() AND current_user_role() != 'reception')
  WITH CHECK (organisation_id = current_org_id() AND current_user_role() != 'reception');

-- ── chair_config ────────────────────────────────────────────────────────────
-- Columns mirror lib/formulas.js CHAIR_CONFIG (the compute consumer):
-- open hours/day, working weeks/yr, working days/wk, benchmark occupancy %,
-- benchmark revenue per chair-hour (pence). Defaults match the code constant.
CREATE TABLE IF NOT EXISTS chair_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  open_hrs            NUMERIC  NOT NULL DEFAULT 8,
  weeks_yr           INTEGER  NOT NULL DEFAULT 46,
  days_wk            INTEGER  NOT NULL DEFAULT 5,
  bench_occ_pct      NUMERIC  NOT NULL DEFAULT 88,
  bench_rev_hr_pence BIGINT   NOT NULL DEFAULT 30000,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id)
);

CREATE TRIGGER chair_config_updated_at BEFORE UPDATE ON chair_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE chair_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chair_config_org ON chair_config;
CREATE POLICY chair_config_org ON chair_config
  USING (organisation_id = current_org_id() AND current_user_role() != 'reception')
  WITH CHECK (organisation_id = current_org_id() AND current_user_role() != 'reception');

-- Reload PostgREST cache after applying:
--   NOTIFY pgrst, 'reload schema';
