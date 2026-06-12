-- QuickBooks multi-account: N companies per org via integration_accounts
-- (provider='quickbooks', external_account_id=realmId, NO practice mapping —
-- a QB company is an independent entity, same treatment as Dentally/GHL).
--
-- Adds per-company attribution (integration_account_id) to the four QB data
-- tables so the Finance QB dashboard can filter by company and so one company's
-- delete-then-insert sync never wipes another's rows. Idempotent.

-- ============================================================================
-- 1. Per-company attribution columns
-- ============================================================================
ALTER TABLE monthly_financials ADD COLUMN IF NOT EXISTS integration_account_id UUID REFERENCES integration_accounts(id) ON DELETE CASCADE;
ALTER TABLE bank_accounts      ADD COLUMN IF NOT EXISTS integration_account_id UUID REFERENCES integration_accounts(id) ON DELETE CASCADE;
ALTER TABLE invoices           ADD COLUMN IF NOT EXISTS integration_account_id UUID REFERENCES integration_accounts(id) ON DELETE CASCADE;
ALTER TABLE payments           ADD COLUMN IF NOT EXISTS integration_account_id UUID REFERENCES integration_accounts(id) ON DELETE CASCADE;

-- ============================================================================
-- 2. monthly_financials uniqueness: fold account id into the conflict key so two
--    QB companies with the same period + account_code do not collide. Replaces
--    the old index (non-QB rows keep integration_account_id NULL -> COALESCE to
--    the zero uuid, behaviour unchanged for xero/manual).
-- ============================================================================
DROP INDEX IF EXISTS uq_monthly_financials;
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_financials
  ON monthly_financials (
    organisation_id, period, account_code,
    COALESCE(practice_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(integration_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source
  );

-- bank_accounts / invoices / payments keep their existing
-- (organisation_id, source, external_id) unique indexes. The QB sync writes
-- external_id as '<realmId>:<entityId>', which is already per-company-unique, so
-- no unique-index change is needed there.

-- ============================================================================
-- 3. Filter indexes for the per-company dashboard reads
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_monthly_financials_org_account ON monthly_financials (organisation_id, integration_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_org_account      ON bank_accounts (organisation_id, integration_account_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org_account           ON invoices (organisation_id, integration_account_id);
CREATE INDEX IF NOT EXISTS idx_payments_org_account           ON payments (organisation_id, integration_account_id);

NOTIFY pgrst, 'reload schema';
