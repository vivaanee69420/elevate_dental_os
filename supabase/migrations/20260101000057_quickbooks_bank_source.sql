-- 20260101000057_quickbooks_bank_source.sql
-- QuickBooks Online writes its Balance Sheet cash/bank balances into
-- bank_accounts so the Cashflow page has a real opening balance
-- (opening = Sigma bank_accounts.balance_pence). Add source + external_id so
-- QBO-origin rows are identifiable and idempotently upsertable side-by-side with
-- TrueLayer rows (which keep source='truelayer', external_id NULL). Idempotent.

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'truelayer';
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Upsert arbiter for QBO rows. Existing TrueLayer rows have external_id NULL;
-- Postgres treats NULLs as distinct in a UNIQUE index, so they never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accts_src_ext
  ON bank_accounts(organisation_id, source, external_id);

NOTIFY pgrst, 'reload schema';
