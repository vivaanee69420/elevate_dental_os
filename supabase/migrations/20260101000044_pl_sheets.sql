-- ============================================================================
-- pl_sheets — per-org EDITABLE P&L scenario/budget spreadsheets. Phase 3 / T13.
--
-- PRECEDENCE DECISION (TODO1, resolved 2026-06-06): SCENARIO OVERLAY ONLY.
-- pl_sheets are standalone planning artifacts. They DO NOT override the real
-- actuals P&L (Xero > monthly_financials-manual stays the single source on the
-- finance screens) and they DO NOT feed EBITDA / valuation. A finance screen
-- never shows a hand-typed number as if it were real. Sheets are an editable
-- what-if / budget grid beside the real P&L, with CSV export. This keeps the
-- "FINANCE screen → real actuals or zero, never fabricate" guarantee intact.
--
-- Storage is a free-form grid: `cols` (column defs), `lines` (row defs), `cells`
-- ({ "<lineId>:<colId>": pence }) — all JSONB, all money in INTEGER PENCE (rule
-- 2). MULTI-TENANT: every row carries organisation_id; repos write via
-- serviceClient with an explicit org filter AND RLS is enabled (current_org_id(),
-- reception excluded — finance is owner-toggled). Mutations gated on finance.edit
-- and audited by the audit middleware.
--
-- Idempotent + additive. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================
CREATE TABLE IF NOT EXISTS pl_sheets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'scenario',  -- 'scenario' | 'budget' | 'forecast'
  cols  JSONB NOT NULL DEFAULT '[]'::jsonb,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  cells JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER pl_sheets_updated_at BEFORE UPDATE ON pl_sheets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_pl_sheets_org ON pl_sheets(organisation_id, updated_at DESC);

ALTER TABLE pl_sheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pl_sheets_org ON pl_sheets;
CREATE POLICY pl_sheets_org ON pl_sheets
  USING (organisation_id = current_org_id() AND current_user_role() != 'reception')
  WITH CHECK (organisation_id = current_org_id() AND current_user_role() != 'reception');

-- Reload PostgREST cache after applying:
--   NOTIFY pgrst, 'reload schema';
