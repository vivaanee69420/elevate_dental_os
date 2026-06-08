-- ============================================================================
-- ad_accounts — per-org dimension of the ad accounts each marketing connector
-- (Google Ads / Meta Ads) can reach, with a per-account selection flag. The
-- syncs discover ALL accessible accounts and write one row per account here;
-- the marketing read paths filter ad_metrics to the SELECTED accounts (default
-- all selected). MULTI-TENANT: every row carries organisation_id; connectors
-- write via serviceClient with an explicit organisation_id filter.
--
--   customer_id = Google Ads customer id / Meta ad-account id (the same value
--   stored on ad_metrics.customer_id — the join key the read filter uses).
--
-- "Pull all, filter on read": deselecting an account never deletes its synced
-- history; it just drops out of the default marketing view. Idempotent +
-- additive. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================
CREATE TABLE IF NOT EXISTS ad_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,              -- 'google_ads' | 'meta_ads'
  customer_id TEXT NOT NULL,           -- Google customer id / Meta ad-account id
  name TEXT,                           -- human-readable account name (selector label)
  currency TEXT,                       -- account currency code (e.g. 'GBP')
  status TEXT,                         -- provider account status (active/disabled/…)
  is_selected BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, provider, customer_id)
);

CREATE TRIGGER ad_accounts_updated_at BEFORE UPDATE ON ad_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_ad_accounts_org_provider
  ON ad_accounts(organisation_id, provider);
-- The read filter needs the selected customer_ids for an org+provider fast.
CREATE INDEX IF NOT EXISTS idx_ad_accounts_selected
  ON ad_accounts(organisation_id, provider) WHERE is_selected;

-- ---------------------------------------------------------------------------
-- ad_metrics: richer per-campaign metrics. CTR/CPC/CPM/conversion-rate stay
-- DERIVED on read (from spend/impressions/clicks/conversions). reach & frequency
-- are NOT derivable (unique-people reach), so they are stored. campaign_status
-- and objective are campaign-level dimensions carried per row for filtering.
-- All additive + nullable; existing (org, provider, customer, campaign, day)
-- unique constraint is unchanged. Meta supplies reach/frequency/objective;
-- Google leaves reach/frequency null and maps objective from channel type.
-- ---------------------------------------------------------------------------
ALTER TABLE ad_metrics ADD COLUMN IF NOT EXISTS reach BIGINT;
ALTER TABLE ad_metrics ADD COLUMN IF NOT EXISTS frequency NUMERIC;
ALTER TABLE ad_metrics ADD COLUMN IF NOT EXISTS campaign_status TEXT;
ALTER TABLE ad_metrics ADD COLUMN IF NOT EXISTS objective TEXT;

-- Reload PostgREST cache after applying:
--   NOTIFY pgrst, 'reload schema';
