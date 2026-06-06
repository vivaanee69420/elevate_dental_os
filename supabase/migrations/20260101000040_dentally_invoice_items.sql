-- 20260101000040_dentally_invoice_items.sql
-- Dentally invoice items = the REAL per-treatment FEE feed (treatment name +
-- price), confirmed against the live API. Neither /payments (amount only, no
-- treatment) nor /treatment_plans (plan total, no item breakdown) carry this.
-- This is what lets us show real revenue-by-treatment and seed the Treatment
-- Economics Workbench with real case fees.
--
-- Denormalised: practice_id / contact_id / invoiced_on / invoice_paid are
-- resolved from the parent invoice at sync time (the invoice carries site_id +
-- patient_id + dated_on; the item itself does not), so the revenue RPC is a
-- plain group-by with no cross-table join. Money is integer pence (rule 2).
-- NOTE: this is the patient FEE (retail), NOT the practice's lab/material COST
-- — Dentally never carries supplier cost; those stay owner-entered.
-- Idempotent; re-applies cleanly.

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'dentally',
  pms_external_id TEXT NOT NULL,         -- the invoice_item id
  pms_invoice_id TEXT,                   -- parent invoice id (for relink)
  pms_practitioner_id TEXT,
  practice_id UUID REFERENCES practices(id),   -- via invoice.site_id
  contact_id UUID REFERENCES contacts(id),     -- via invoice.patient_id
  associate_id UUID REFERENCES associates(id), -- via practitioner
  treatment_plan_id TEXT,                -- Dentally treatment_plan id (nullable)
  treatment_name TEXT,                   -- Dentally invoice_item.name
  unit_price_pence INTEGER NOT NULL DEFAULT 0, -- item_price
  fee_pence INTEGER NOT NULL DEFAULT 0,        -- total_price (qty-inclusive)
  quantity INTEGER NOT NULL DEFAULT 1,
  nhs_charge BOOLEAN DEFAULT false,
  invoiced_on DATE,                      -- parent invoice dated_on
  invoice_paid BOOLEAN,                  -- parent invoice paid
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS invoice_items_updated_at ON invoice_items;
CREATE TRIGGER invoice_items_updated_at BEFORE UPDATE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ON CONFLICT arbiter for the idempotent sync upsert + read indexes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_items_src_ext
  ON invoice_items(organisation_id, source, pms_external_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_org ON invoice_items(organisation_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_name ON invoice_items(organisation_id, treatment_name);
CREATE INDEX IF NOT EXISTS idx_invoice_items_practice_date
  ON invoice_items(organisation_id, practice_id, invoiced_on);

-- RLS: finance data — same boundary as payments/treatment_plans (org-scoped,
-- reception excluded).
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoice_items_read" ON invoice_items;
CREATE POLICY "invoice_items_read" ON invoice_items
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() != 'reception');
DROP POLICY IF EXISTS "invoice_items_write" ON invoice_items;
CREATE POLICY "invoice_items_write" ON invoice_items
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() != 'reception');

NOTIFY pgrst, 'reload schema';
