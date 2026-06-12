-- 000089: dual accounting basis on monthly_financials.
-- QuickBooks' ProfitAndLoss report can be run on a Cash or Accrual basis; we now
-- store BOTH so the P&L page can toggle. Existing rows (Xero/manual/old QB) are
-- accrual. Cash rows are written only by the QB sync (accounting_method=Cash pull).
-- The unique index folds accounting_method into the conflict key so a period's
-- cash and accrual lines coexist instead of overwriting each other.

ALTER TABLE monthly_financials
  ADD COLUMN IF NOT EXISTS accounting_method TEXT NOT NULL DEFAULT 'accrual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'monthly_financials_accounting_method_chk'
  ) THEN
    ALTER TABLE monthly_financials
      ADD CONSTRAINT monthly_financials_accounting_method_chk
      CHECK (accounting_method IN ('accrual', 'cash'));
  END IF;
END $$;

-- Rebuild the conflict key to include accounting_method (was: org, period,
-- account_code, COALESCE(integration_account_id), COALESCE(practice_id), source).
DROP INDEX IF EXISTS uq_monthly_financials;
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_financials
  ON monthly_financials (
    organisation_id,
    period,
    account_code,
    COALESCE(integration_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(practice_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source,
    accounting_method
  );

CREATE INDEX IF NOT EXISTS idx_monthly_financials_method
  ON monthly_financials (organisation_id, accounting_method);

NOTIFY pgrst, 'reload schema';
