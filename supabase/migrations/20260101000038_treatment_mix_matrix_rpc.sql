-- 20260101000038_treatment_mix_matrix_rpc.sql
-- Treatment Mix heat matrix (GM Intelligence OS, Phase 2). Appointment VOLUME
-- grouped by BOTH practice_id and appointment_type within a window, so the
-- frontend can render a practice x treatment heat matrix in one round trip.
--
-- VOLUME ONLY: Dentally appointments carry no price (documented data wall), so
-- this measures clinical ACTIVITY, not revenue. NULL types collapse to
-- 'Unspecified'. The repository falls back to a paginated JS scan when this RPC
-- is absent, so applying this migration is a PERFORMANCE optimisation, not a
-- correctness requirement. Idempotent (CREATE OR REPLACE); re-applies cleanly.

CREATE OR REPLACE FUNCTION treatment_mix_matrix(
  p_org   UUID,
  p_since TIMESTAMPTZ,
  p_until TIMESTAMPTZ
)
RETURNS TABLE (practice_id UUID, appointment_type TEXT, volume BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT a.practice_id,
         COALESCE(a.appointment_type, 'Unspecified') AS appointment_type,
         COUNT(*)::BIGINT AS volume
  FROM appointments a
  WHERE a.organisation_id = p_org
    AND a.starts_at >= p_since
    AND (p_until IS NULL OR a.starts_at < p_until)
  GROUP BY a.practice_id, COALESCE(a.appointment_type, 'Unspecified');
$$;

GRANT EXECUTE ON FUNCTION treatment_mix_matrix(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
