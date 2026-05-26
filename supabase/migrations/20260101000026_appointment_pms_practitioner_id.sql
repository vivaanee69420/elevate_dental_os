-- ============================================================================
-- Appointments: store the raw Dentally practitioner id so associate_id can always
-- be (re)linked, even when the practitioner was pulled/mapped in a later sync run.
--
-- Background: appointments.associate_id is resolved at sync time from a
-- practitioner-id -> associates map. If practitioners had not been pulled yet
-- (or the /practitioners pull failed), the link was lost — every appointment
-- got associate_id = NULL and per-associate stats (Associates, Pay) read zero.
-- Unlike contacts, the practitioner id was NOT persisted, so the only recovery
-- was a full appointment re-pull. Persisting pms_practitioner_id makes the link
-- recoverable: relink_dentally_appointment_associates() backfills associate_id in
-- a single set-based UPDATE after practitioners sync. Idempotent; re-applies
-- cleanly. Mirrors 000022 (pms_patient_id / relink_dentally_appointment_contacts).
-- ============================================================================

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pms_practitioner_id TEXT;

-- Speeds up the relink join (org + null associate + practitioner id) and is
-- harmless for the common case.
CREATE INDEX IF NOT EXISTS idx_appts_pms_practitioner_id
  ON appointments(organisation_id, pms_practitioner_id)
  WHERE pms_practitioner_id IS NOT NULL;

-- Backfill associate_id for an org's Dentally appointments that have a known
-- Dentally practitioner id but no linked associate yet. Returns the number
-- relinked. SECURITY DEFINER + explicit org scope: callers (the sync worker via
-- the service client) pass the org; the function never crosses tenants.
CREATE OR REPLACE FUNCTION public.relink_dentally_appointment_associates(p_org UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH upd AS (
    UPDATE appointments a
    SET associate_id = s.id
    FROM associates s
    WHERE a.organisation_id = p_org
      AND a.associate_id IS NULL
      AND a.pms_practitioner_id IS NOT NULL
      AND s.organisation_id = p_org
      AND s.pms_external_id = a.pms_practitioner_id
    RETURNING a.id
  )
  SELECT COUNT(*)::INT FROM upd;
$$;

GRANT EXECUTE ON FUNCTION public.relink_dentally_appointment_associates(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
