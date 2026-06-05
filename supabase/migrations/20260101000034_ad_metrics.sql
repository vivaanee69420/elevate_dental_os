-- ============================================================================
-- ad_metrics — per-org, per-campaign, per-day ad spend & performance from
-- marketing connectors (Google Ads now; Meta Ads next). MULTI-TENANT: every
-- row carries organisation_id; the connectors write via serviceClient with an
-- explicit organisation_id filter (same isolation model as monthly_financials
-- / integrations). One row per (org, provider, customer/account, campaign, day).
--
-- Money is INTEGER PENCE (rule 2): spend_pence. Drives Growth -> Marketing
-- (spend, CPL, ROAS, CAC per channel) and feeds calculateMarketingROI.
-- Idempotent + additive. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================
CREATE TABLE IF NOT EXISTS ad_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID REFERENCES practices(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,              -- 'google_ads' | 'meta_ads'
  source TEXT NOT NULL,                -- mirrors provider; kept for parity with monthly_financials
  customer_id TEXT,                    -- Google Ads customer id / Meta ad-account id
  campaign_id TEXT,
  campaign_name TEXT,
  metric_date DATE NOT NULL,
  spend_pence BIGINT NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, provider, customer_id, campaign_id, metric_date)
);

CREATE TRIGGER ad_metrics_updated_at BEFORE UPDATE ON ad_metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_ad_metrics_org_date  ON ad_metrics(organisation_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_metrics_provider  ON ad_metrics(organisation_id, provider, metric_date DESC);

-- Reload PostgREST cache after applying:
--   NOTIFY pgrst, 'reload schema';
