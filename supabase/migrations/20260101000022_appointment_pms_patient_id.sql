-- ============================================================================
-- Appointments: store the raw Dentally patient id so contact_id can always be
-- (re)linked, even when the patient was pulled in a different sync run.
--
-- Background: appointments.contact_id is resolved at sync time from a patient-id
-- -> contacts map. If the patient was not yet pulled (dormant patient with a
-- future recall, or a cross-run ordering gap), the link was lost permanently —
-- the screen showed "Unknown patient". Persisting pms_patient_id makes the link
-- recoverable: relink_dentally_appointment_contacts() backfills contact_id in a
-- single set-based UPDATE after patients sync. Idempotent; re-applies cleanly.
-- ============================================================================

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pms_patient_id TEXT;

-- Speeds up the relink join (org + null contact + patient id) and is harmless
-- for the common case.
CREATE INDEX IF NOT EXISTS idx_appts_pms_patient_id
  ON appointments(organisation_id, pms_patient_id)
  WHERE pms_patient_id IS NOT NULL;

-- Backfill contact_id for an org's Dentally appointments that have a known
-- Dentally patient id but no linked contact yet. Returns the number relinked.
-- SECURITY DEFINER + explicit org scope: callers (the sync worker via the
-- service client) pass the org; the function never crosses tenants.
CREATE OR REPLACE FUNCTION public.relink_dentally_appointment_contacts(p_org UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH upd AS (
    UPDATE appointments a
    SET contact_id = c.id
    FROM contacts c
    WHERE a.organisation_id = p_org
      AND a.contact_id IS NULL
      AND a.pms_patient_id IS NOT NULL
      AND c.organisation_id = p_org
      AND c.source = 'dentally'
      AND c.pms_external_id = a.pms_patient_id
    RETURNING a.id
  )
  SELECT COUNT(*)::INT FROM upd;
$$;

GRANT EXECUTE ON FUNCTION public.relink_dentally_appointment_contacts(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
