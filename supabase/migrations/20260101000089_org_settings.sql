-- ============================================================================
-- org_settings — one config row per org for cross-cutting owner toggles that
-- don't belong to a single domain. First field: turnover_source — how the
-- board report (and any future group turnover surface) counts group turnover:
--   dentally   — Dentally invoice_items clinical production (default; today's behaviour)
--   quickbooks — QuickBooks P&L revenue (monthly_financials, source=quickbooks)
--   both       — sum of the two (owner accepts the double-count risk when an org
--                runs Dentally AND QuickBooks over the same revenue)
-- Default 'dentally' preserves existing numbers; QBO-only orgs opt in to fix the
-- £0-turnover gap. MULTI-TENANT: PK is organisation_id; repos write via
-- serviceClient with an explicit organisation_id filter.
-- Idempotent. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================
CREATE TABLE IF NOT EXISTS org_settings (
  organisation_id UUID PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  turnover_source TEXT NOT NULL DEFAULT 'dentally'
    CHECK (turnover_source IN ('dentally', 'quickbooks', 'both')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID
);

DROP TRIGGER IF EXISTS org_settings_updated_at ON org_settings;
CREATE TRIGGER org_settings_updated_at BEFORE UPDATE ON org_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

NOTIFY pgrst, 'reload schema';
