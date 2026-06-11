-- Treatment-mix RPCs: count only appointments WITH a patient.
--
-- The Treatments screen ("Treatment Mix" heat matrix + legacy volume table)
-- counted ALL appointment rows, including patient-less diary blocks (Lunch,
-- holding Exams, Nurse cover, gaps) that Dentally hides under its "With
-- patients" filter. This over-counted the headline Appointments figure and
-- polluted the type rows (e.g. "Lunch" appeared as a treatment), so the
-- Treatments screen disagreed with the Business Hub.
--
-- Business Hub (appointments_rollup_by_practice, migration 000076) already
-- filters `pms_patient_id IS NOT NULL` to match Dentally exactly. This brings
-- both treatment-mix RPCs onto the same convention. Idempotent (CREATE OR
-- REPLACE), no signature change.

CREATE OR REPLACE FUNCTION public.treatment_mix_matrix(
  p_org UUID, p_since TIMESTAMPTZ, p_until TIMESTAMPTZ
)
RETURNS TABLE(practice_id UUID, appointment_type TEXT, volume BIGINT)
LANGUAGE sql STABLE AS $function$
  SELECT a.practice_id,
         COALESCE(a.appointment_type, 'Unspecified') AS appointment_type,
         COUNT(*)::BIGINT AS volume
  FROM appointments a
  WHERE a.organisation_id = p_org
    AND a.starts_at >= p_since
    AND (p_until IS NULL OR a.starts_at < p_until)
    AND a.pms_patient_id IS NOT NULL
  GROUP BY a.practice_id, COALESCE(a.appointment_type, 'Unspecified');
$function$;

CREATE OR REPLACE FUNCTION public.treatment_mix_stats(
  p_org UUID, p_practice UUID, p_since TIMESTAMPTZ, p_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(appointment_type TEXT, volume BIGINT)
LANGUAGE sql STABLE AS $function$
  SELECT COALESCE(a.appointment_type, 'Unspecified') AS appointment_type,
         COUNT(*)::BIGINT AS volume
  FROM public.appointments a
  WHERE a.organisation_id = p_org
    AND a.starts_at >= p_since
    AND (p_until IS NULL OR a.starts_at <= p_until)
    AND (p_practice IS NULL OR a.practice_id = p_practice)
    AND a.pms_patient_id IS NOT NULL
  GROUP BY COALESCE(a.appointment_type, 'Unspecified')
  ORDER BY volume DESC;
$function$;
