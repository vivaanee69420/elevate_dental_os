-- 20260101000099_dentally_treatment_items.sql
-- Dentally TREATMENT PLAN ITEMS = the individual completed-treatment feed that
-- backs Dentally's "Practitioner Activity" report. Confirmed against the live
-- API: GET /v1/treatment_plan_items returns one row per treatment line with
-- { completed, completed_at, base_chart, price, practitioner_id, patient_id,
--   treatment_plan_id, treatment_appointment_id, invoice_id, nomenclature }.
--
-- WHY a new table (we already have treatment_plans + invoice_items):
--   - treatment_plans (000027) = plan HEADERS (one per plan); counting completed
--     plans gave 193 for a window the Practitioner Activity report shows as 421
--     completed treatments — wrong unit, and the rollup value used the PLANNED
--     private estimate (private_value_pence, ~22% coverage), not real fees.
--   - invoice_items (000040) only carries CHARGED lines; the Practitioner Activity
--     report includes GBP0 treatments (exams, x-rays, notes) that never invoice.
-- This feed is the one Dentally itself reports on. Validated to the penny against
-- the live report: completed=true AND base_chart=false, by completed_at, attributed
-- to a practice via the practitioner's site -> 421 items / GBP79,757.72 (exact).
--
-- base_chart=true rows are tooth/surface charting entries Dentally EXCLUDES from
-- the activity report (all GBP0; they doubled a naive item count). We store the flag
-- and filter in the RPC so both report semantics stay available.
--
-- SENSITIVE clinical detail (teeth, surfaces, notes, custom_fields) is NOT synced
-- (matches the connector's existing policy + the AI-snapshot data-minimisation rule).
-- Practice attribution is denormalised at sync time (practitioner.site_id ->
-- practices.pms_site_id) so the RPC is a plain group-by. Money is integer pence.
-- Idempotent; re-applies cleanly.

CREATE TABLE IF NOT EXISTS dentally_treatment_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'dentally',
  pms_external_id TEXT NOT NULL,            -- treatment_plan_item id
  pms_practitioner_id TEXT,
  pms_patient_id TEXT,
  practice_id UUID REFERENCES practices(id),   -- via practitioner.site_id
  contact_id UUID REFERENCES contacts(id),     -- via patient_id
  associate_id UUID REFERENCES associates(id), -- via practitioner
  treatment_plan_id TEXT,                   -- parent plan id (relink)
  treatment_appointment_id TEXT,            -- linked appointment id (relink)
  pms_invoice_id TEXT,                      -- invoice_id when invoiced (nullable)
  treatment_name TEXT,                      -- nomenclature / patient_nomenclature
  price_pence INTEGER NOT NULL DEFAULT 0,   -- price (money string) -> pence
  duration INTEGER NOT NULL DEFAULT 0,      -- minutes (Practitioner Activity hours)
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,                  -- Practitioner Activity "Completed On"
  base_chart BOOLEAN NOT NULL DEFAULT false,-- true = charting noise, report excludes
  charged BOOLEAN NOT NULL DEFAULT false,
  appear_on_invoice BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS dentally_treatment_items_updated_at ON dentally_treatment_items;
CREATE TRIGGER dentally_treatment_items_updated_at BEFORE UPDATE ON dentally_treatment_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ON CONFLICT arbiter for the idempotent sync upsert + read index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dentally_treatment_items_src_ext
  ON dentally_treatment_items(organisation_id, source, pms_external_id);
CREATE INDEX IF NOT EXISTS idx_dentally_treatment_items_org ON dentally_treatment_items(organisation_id);
-- The Practitioner Activity read path: org + practice + completed_at, completed rows.
CREATE INDEX IF NOT EXISTS idx_dentally_treatment_items_completed
  ON dentally_treatment_items(organisation_id, practice_id, completed_at)
  WHERE completed IS TRUE AND base_chart IS FALSE;

-- RLS: clinical/finance data — same boundary as invoice_items (org-scoped,
-- reception excluded).
ALTER TABLE dentally_treatment_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dentally_treatment_items_read" ON dentally_treatment_items;
CREATE POLICY "dentally_treatment_items_read" ON dentally_treatment_items
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() != 'reception');
DROP POLICY IF EXISTS "dentally_treatment_items_write" ON dentally_treatment_items;
CREATE POLICY "dentally_treatment_items_write" ON dentally_treatment_items
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() != 'reception');

-- Practitioner Activity rollup PER PRACTICE: completed treatments in [since, until)
-- by completed_at, excluding base_chart charting rows. Mirrors Dentally's report:
--   completed_count = treatment rows (421 in the validated Ashford window)
--   value_pence     = SUM(price) — the report's "total amount invoiced" (GBP79,757.72)
--   patient_count   = distinct patients seen (Dentally "Patients")
--   duration_minutes= chair time (Dentally "hours")
-- practice_id is denormalised on the row, so this is a plain group-by (no join).
-- Idempotent.
DROP FUNCTION IF EXISTS treatments_completed_by_practice(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION treatments_completed_by_practice(
  p_org   UUID,
  p_since TIMESTAMPTZ,
  p_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  practice_id UUID,
  completed_count BIGINT,
  value_pence BIGINT,
  patient_count BIGINT,
  duration_minutes BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ti.practice_id,
         COUNT(*)::BIGINT AS completed_count,
         COALESCE(SUM(ti.price_pence), 0)::BIGINT AS value_pence,
         COUNT(DISTINCT ti.pms_patient_id)::BIGINT AS patient_count,
         COALESCE(SUM(ti.duration), 0)::BIGINT AS duration_minutes
  FROM dentally_treatment_items ti
  WHERE ti.organisation_id = p_org
    AND ti.completed IS TRUE
    AND ti.base_chart IS FALSE
    AND ti.completed_at >= p_since
    AND (p_until IS NULL OR ti.completed_at < p_until)
  GROUP BY ti.practice_id;
$$;

GRANT EXECUTE ON FUNCTION treatments_completed_by_practice(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
