-- 20260101000027_invoices.sql
-- Patient invoices synced from Dentally /v1/invoices. Distinct from lab_invoices
-- (lab-supplier bills). Powers the Debt Recovery page: unpaid invoices
-- (amount_outstanding_pence > 0) are the debtors, aged by due_on/dated_on.
-- Idempotent.

CREATE TABLE IF NOT EXISTS invoices (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id               uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  contact_id                uuid REFERENCES contacts(id) ON DELETE SET NULL,
  source                    text NOT NULL DEFAULT 'dentally',
  external_id               text,
  amount_pence              integer NOT NULL DEFAULT 0,
  amount_outstanding_pence  integer NOT NULL DEFAULT 0,
  dated_on                  date,
  due_on                    date,
  paid                      boolean NOT NULL DEFAULT false,
  treatment                 text,
  patient_name              text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Idempotent upsert arbiter (mirrors uq_payments_src_ext).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_src_ext
  ON invoices(organisation_id, source, external_id);

CREATE INDEX IF NOT EXISTS idx_invoices_org_practice
  ON invoices(organisation_id, practice_id);

-- Keep updated_at fresh on upsert, like every other table.
DROP TRIGGER IF EXISTS invoices_updated_at ON invoices;
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_read" ON invoices;
CREATE POLICY "invoices_read" ON invoices
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() != 'reception');

DROP POLICY IF EXISTS "invoices_write" ON invoices;
CREATE POLICY "invoices_write" ON invoices
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() != 'reception');
