-- ============================================================================
-- wealth_inputs — per-org persisted PERSONAL-WEALTH inputs for the Exit Plan /
-- FIRE screens (DentaCFO gap Phase 4). Until now the Wealth section ran on
-- frontend mock data (features/wealth/data.ts) and the wealth.routes.js stub
-- overloaded business_health.baseline jsonb. This table gives an org one saved
-- personal balance sheet + FIRE/sale assumptions, so the FIRE plan and the
-- sale-proceeds waterfall compute from real, persisted figures.
--
-- One row per organisation (UNIQUE organisation_id). The Wealth section is
-- OWNER-ONLY (rule 5 / nav ownerOnly); writes are gated requireRole('owner')
-- and audited by the audit middleware. Money is INTEGER PENCE (rule 2).
--
-- Line-items (assets/liabilities/pensions/properties) are JSONB arrays because
-- they are variable-length, user-authored lists, not compute-canonical scalar
-- drivers. The `fire` and `sale` JSONB blobs hold the assumption knobs the
-- formulas consume (calculateFirePlan / calculateSaleWaterfall). Shapes:
--   assets[]      {name, valuePence, type, growthPct, liquid}
--   liabilities[] {name, valuePence, ratePct}
--   pensions[]    {name, balancePence, contributionsYtdPence, type}
--   properties[]  {name, address, valuePence, mortgagePence, monthlyIncomePence,
--                  monthlyCostPence, yieldPct, type}
--   fire          {targetAnnualSpendPence, withdrawalRatePct, growthRatePct,
--                  annualSavingsPence, horizonYears}
--   sale          {ownerSharePct, businessDebtPence, freeholdEquityPence,
--                  acquisitionCostPence, badrLifetimeUsedPence,
--                  useLiveValuation}  -- useLiveValuation: seed EV from the live
--                                        valuation midpoint vs a manual override
--
-- MULTI-TENANT: every row carries organisation_id; repos write via serviceClient
-- with an explicit org filter AND RLS is enabled as defence-in-depth
-- (current_org_id(), reception excluded — wealth is owner-only finance-class).
--
-- Idempotent + additive. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================

CREATE TABLE IF NOT EXISTS wealth_inputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  assets       JSONB NOT NULL DEFAULT '[]'::jsonb,
  liabilities  JSONB NOT NULL DEFAULT '[]'::jsonb,
  pensions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties   JSONB NOT NULL DEFAULT '[]'::jsonb,
  fire         JSONB NOT NULL DEFAULT '{}'::jsonb,
  sale         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id)
);

CREATE TRIGGER wealth_inputs_updated_at BEFORE UPDATE ON wealth_inputs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE wealth_inputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wealth_inputs_org ON wealth_inputs;
CREATE POLICY wealth_inputs_org ON wealth_inputs
  USING (organisation_id = current_org_id() AND current_user_role() != 'reception')
  WITH CHECK (organisation_id = current_org_id() AND current_user_role() != 'reception');

-- Reload PostgREST cache after applying:
--   NOTIFY pgrst, 'reload schema';
