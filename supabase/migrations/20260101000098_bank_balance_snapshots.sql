-- 20260101000098_bank_balance_snapshots.sql
-- Month-end cash-at-bank history so the Finance > QuickBooks dashboard can show
-- cash AS OF the end of the selected period (previously a single live snapshot in
-- bank_accounts that never moved with the month filter). The QB sync pulls a
-- Balance Sheet as-of each month-end and stores one row per (account, period).
-- bank_accounts keeps the live "current" balance; this table holds the history.
-- Idempotent.

CREATE TABLE IF NOT EXISTS bank_balance_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  integration_account_id UUID REFERENCES integration_accounts(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'quickbooks',
  period TEXT NOT NULL,                 -- 'YYYY-MM' the balance is as-of (month end)
  as_of DATE,                           -- the actual as-of date pulled
  external_id TEXT NOT NULL,            -- '<realmId>:<AccountId>' (matches bank_accounts)
  display_name TEXT,
  balance_pence BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GBP',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One balance per account per month per company. Delete-then-insert per period
-- keeps re-syncs idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_bal_snap
  ON bank_balance_snapshots(organisation_id, integration_account_id, period, external_id);

CREATE INDEX IF NOT EXISTS idx_bank_bal_snap_org_period
  ON bank_balance_snapshots(organisation_id, source, period);

ALTER TABLE bank_balance_snapshots ENABLE ROW LEVEL SECURITY;

-- Mirror bank_accounts: owner-only, org-scoped (serviceClient bypasses for sync).
CREATE POLICY "bank_bal_snap_read_owner" ON bank_balance_snapshots
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

CREATE POLICY "bank_bal_snap_write_owner" ON bank_balance_snapshots
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

NOTIFY pgrst, 'reload schema';
