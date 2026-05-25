-- Dentally sync + CSV manual feed + Xero integration — schema foundation (Lane A).
-- Reviewed in docs/plans/DENTALLY_CSV_INTEGRATION_PLAN.md (eng + design CLEARED).
--
-- Idempotent: re-applies cleanly on `supabase db reset`.
--
-- Adds:
--   1. source/external_id columns + composite-unique indexes so Dentally polling
--      and CSV import upsert idempotently and never collide across sources.
--   2. practices.pms_site_id so external site ids / CSV practice_code map to a practice.
--   3. monthly_financials + xero_account_map for Xero P&L/expense actuals.
--   4. csv_import_batches + csv_import_rows for the staged dual-approval CSV feed.

-- ============================================================================
-- 1. Idempotency: source + external_id, composite-unique upsert keys
-- ============================================================================
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE payments     ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE payments     ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Non-partial unique on (org, source, external_id). Postgres treats NULLs as
-- distinct, so existing rows without an external id (NULL) never collide, while
-- synced/imported rows that DO carry one upsert idempotently. Non-partial is
-- required so Supabase upsert's `ON CONFLICT (cols)` can use it as the arbiter
-- (a partial index needs a WHERE predicate the client doesn't emit).
-- Source namespaces Dentally vs manual vs stripe — no cross-source overwrites.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_src_ext
  ON contacts (organisation_id, source, pms_external_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_src_ext
  ON appointments (organisation_id, source, pms_external_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_src_ext
  ON payments (organisation_id, source, external_id);

-- ============================================================================
-- 2. Practice mapping (Dentally site_id / CSV practice_code -> practices.id)
-- ============================================================================
ALTER TABLE practices ADD COLUMN IF NOT EXISTS pms_site_id TEXT;
CREATE INDEX IF NOT EXISTS idx_practices_pms_site
  ON practices (organisation_id, pms_site_id) WHERE pms_site_id IS NOT NULL;

-- ============================================================================
-- 3. Xero financial actuals
-- ============================================================================
CREATE TABLE IF NOT EXISTS monthly_financials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID REFERENCES practices(id),
  period TEXT NOT NULL,                 -- 'YYYY-MM'
  account_code TEXT NOT NULL,
  dental_bucket TEXT CHECK (dental_bucket IN ('revenue','staff','lab','materials','overhead','tax','other')),
  amount_pence INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'xero',  -- 'xero' | 'quickbooks' | 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_financials
  ON monthly_financials (organisation_id, period, account_code, COALESCE(practice_id, '00000000-0000-0000-0000-000000000000'::uuid), source);
CREATE INDEX IF NOT EXISTS idx_monthly_financials_org_period ON monthly_financials (organisation_id, period);
DROP TRIGGER IF EXISTS monthly_financials_updated_at ON monthly_financials;
CREATE TRIGGER monthly_financials_updated_at BEFORE UPDATE ON monthly_financials FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Account-code -> dental_bucket mapping (per org). Unmapped codes go to an exception list in app.
CREATE TABLE IF NOT EXISTS xero_account_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL,
  dental_bucket TEXT NOT NULL CHECK (dental_bucket IN ('revenue','staff','lab','materials','overhead','tax','other')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_xero_account_map ON xero_account_map (organisation_id, account_code);

-- ============================================================================
-- 4. CSV staged manual feed (dual approval: uploader != approver)
-- ============================================================================
CREATE TABLE IF NOT EXISTS csv_import_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  dataset TEXT NOT NULL CHECK (dataset IN ('payments','appointments','patients')),
  filename TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  uploaded_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  row_count INTEGER DEFAULT 0,
  valid_count INTEGER DEFAULT 0,
  rejected_count INTEGER DEFAULT 0,
  reject_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_csv_batches_org_status ON csv_import_batches (organisation_id, status);

CREATE TABLE IF NOT EXISTS csv_import_rows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES csv_import_batches(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw JSONB NOT NULL,
  valid BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_csv_rows_batch ON csv_import_rows (batch_id);

-- ============================================================================
-- RLS — tenant isolation (matches existing pattern; serviceClient bypasses, but
-- RLS is the hard boundary for any tenantClient/req.db path)
-- ============================================================================
ALTER TABLE monthly_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_account_map   ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_import_rows    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS monthly_financials_org ON monthly_financials;
CREATE POLICY monthly_financials_org ON monthly_financials
  USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());
DROP POLICY IF EXISTS xero_account_map_org ON xero_account_map;
CREATE POLICY xero_account_map_org ON xero_account_map
  USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());
DROP POLICY IF EXISTS csv_import_batches_org ON csv_import_batches;
CREATE POLICY csv_import_batches_org ON csv_import_batches
  USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());
DROP POLICY IF EXISTS csv_import_rows_org ON csv_import_rows;
CREATE POLICY csv_import_rows_org ON csv_import_rows
  USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());

-- After hosted apply: NOTIFY pgrst, 'reload schema';
