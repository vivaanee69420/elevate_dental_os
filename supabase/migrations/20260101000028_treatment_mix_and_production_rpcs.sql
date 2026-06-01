-- 20260101000028_treatment_mix_and_production_rpcs.sql
-- Aggregation RPCs for the Treatments (volume mix) and Associate Pay (draft)
-- screens. Both are pure read aggregations; the repositories fall back to a
-- paginated JS-side scan when these are absent, so applying this migration is
-- a PERFORMANCE optimisation, not a correctness requirement.
-- Idempotent (CREATE OR REPLACE); re-applies cleanly.

-- Treatment Mix: appointment volume grouped by appointment_type for an org,
-- optional practice, since a cutoff. NULL types collapse to 'Unspecified'.
CREATE OR REPLACE FUNCTION treatment_mix_stats(
  p_org UUID,
  p_practice UUID,
  p_since TIMESTAMPTZ
)
RETURNS TABLE (appointment_type TEXT, volume BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(a.appointment_type, 'Unspecified') AS appointment_type,
         COUNT(*)::BIGINT AS volume
  FROM appointments a
  WHERE a.organisation_id = p_org
    AND a.starts_at >= p_since
    AND (p_practice IS NULL OR a.practice_id = p_practice)
  GROUP BY COALESCE(a.appointment_type, 'Unspecified')
  ORDER BY volume DESC;
$$;

-- Associate production: sum of completed private treatment-plan value (integer
-- pence) per associate within a period. NHS UDA value is excluded (paid in
-- units, no per-UDA rate is stored).
CREATE OR REPLACE FUNCTION associate_production(
  p_org UUID,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS TABLE (associate_id UUID, production_pence BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT tp.associate_id,
         COALESCE(SUM(tp.private_value_pence), 0)::BIGINT AS production_pence
  FROM treatment_plans tp
  WHERE tp.organisation_id = p_org
    AND tp.completed = true
    AND tp.associate_id IS NOT NULL
    AND tp.completed_at >= p_start
    AND tp.completed_at <= p_end
  GROUP BY tp.associate_id;
$$;

GRANT EXECUTE ON FUNCTION treatment_mix_stats(UUID, UUID, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION associate_production(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
