-- 20260101000027_dentally_treatment_plans.sql
-- Dentally treatment plans = per-practitioner PRODUCTION (private treatment
-- value in money + NHS UDA units). This is the source the Associate Pay Run
-- needs and which the appointment/payment feeds do NOT carry.
--
-- Plumbing only: this migration captures the data. Wiring it into
-- calculateAssociatePay + the Pay Run screen is a separate step.
-- Idempotent; re-applies cleanly.

CREATE TABLE IF NOT EXISTS treatment_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'dentally',
  pms_external_id TEXT NOT NULL,
  -- Raw Dentally ids, persisted so associate_id / contact_id can be relinked on
  -- a later run (mirrors the appointments pattern).
  pms_practitioner_id TEXT,
  pms_patient_id TEXT,
  associate_id UUID REFERENCES associates(id),
  contact_id UUID REFERENCES contacts(id),
  practice_id UUID REFERENCES practices(id),
  -- Private production: money, stored in integer pence (project rule 2).
  private_value_pence INTEGER NOT NULL DEFAULT 0,
  -- NHS production is measured in UDA units (not money) — keep as numeric.
  nhs_uda_value NUMERIC,
  nhs_completed_uda_value NUMERIC,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS treatment_plans_updated_at ON treatment_plans;
CREATE TRIGGER treatment_plans_updated_at BEFORE UPDATE ON treatment_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ON CONFLICT arbiter for the idempotent sync upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_treatment_plans_src_ext
  ON treatment_plans(organisation_id, source, pms_external_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_org ON treatment_plans(organisation_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_assoc ON treatment_plans(organisation_id, associate_id);

-- RLS: finance data — same boundary as payments (org-scoped, reception excluded).
ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "treatment_plans_read" ON treatment_plans;
CREATE POLICY "treatment_plans_read" ON treatment_plans
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() != 'reception');
DROP POLICY IF EXISTS "treatment_plans_write" ON treatment_plans;
CREATE POLICY "treatment_plans_write" ON treatment_plans
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() != 'reception');

NOTIFY pgrst, 'reload schema';
