-- Period-deduplicated reach/frequency snapshot on ad_accounts.
--
-- Reach is the count of UNIQUE people who saw an ad over a window; frequency is
-- impressions / unique-reach over that window. Neither is additive across days,
-- so they cannot be rebuilt by summing the per-day ad_metrics rows (doing so
-- triple-counts a person seen on three days and collapses frequency toward 1).
-- Meta only returns the true figures when the account is queried for the window
-- WITHOUT a daily breakdown (level=account, no time_increment). meta-ads-sync.js
-- runs that one extra query per account each sync and writes the result here.
--
-- One row per ad account (the dimension table). period_window_start/end record
-- the window these figures cover so a reader can tell whether they match the
-- range being displayed (and fall back to "approximate" when they don't).
-- Meta-only today: Google Ads does not report reach/frequency (left null).

ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS period_reach        BIGINT,
  ADD COLUMN IF NOT EXISTS period_frequency    NUMERIC,
  ADD COLUMN IF NOT EXISTS period_impressions  BIGINT,
  ADD COLUMN IF NOT EXISTS period_clicks       BIGINT,
  ADD COLUMN IF NOT EXISTS period_spend_pence  BIGINT,
  ADD COLUMN IF NOT EXISTS period_conversions  INTEGER,
  ADD COLUMN IF NOT EXISTS period_window_start DATE,
  ADD COLUMN IF NOT EXISTS period_window_end   DATE,
  ADD COLUMN IF NOT EXISTS period_synced_at    TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
