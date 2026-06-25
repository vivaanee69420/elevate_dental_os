-- 20260101000109_treatments_completed_lines.sql
-- Drill-down behind the "Treatments Completed" card (Business Hub), shown on the
-- Clinicians page: every completed treatment item in the window with the patient
-- name, the clinician who did it, the treatment, and the revenue it generated.
--
-- SAME filter as treatments_completed_by_practice (the card's count + value):
-- completed IS TRUE, base_chart IS FALSE, by completed_at — so the row count and
-- SUM(value_pence) reconcile to the card. One row per dentally_treatment_items
-- line. Clinician = associates.full_name via associate_id (100% populated);
-- patient = contacts via contact_id (LEFT JOIN — ~18% of items have no linked
-- contact, shown as no patient). Optional p_practice scopes to one practice.
--
-- PAGINATED: p_limit / p_offset page the (ordered) result so the Clinicians page
-- loads the first 100 instantly then back-fills the rest. p_limit NULL = all.
-- Totals (count + value) come from treatments_completed_by_practice, not this
-- function, so they stay correct independent of the page.
-- Idempotent. After applying on hosted: NOTIFY pgrst,'reload schema';

-- Drop the pre-pagination 4-arg signature if it exists (keeps a single function,
-- no overload) — harmless on a fresh DB.
DROP FUNCTION IF EXISTS treatments_completed_lines(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID);

CREATE OR REPLACE FUNCTION treatments_completed_lines(
  p_org      UUID,
  p_since    TIMESTAMPTZ,
  p_until    TIMESTAMPTZ DEFAULT NULL,
  p_practice UUID DEFAULT NULL,
  p_limit    INTEGER DEFAULT NULL,
  p_offset   INTEGER DEFAULT 0
)
RETURNS TABLE (
  item_id        UUID,
  completed_at   TIMESTAMPTZ,
  practice_id    UUID,
  practice_name  TEXT,
  patient_name   TEXT,
  clinician_name TEXT,
  treatment_name TEXT,
  value_pence    BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    ti.id,
    ti.completed_at,
    ti.practice_id,
    pr.name,
    NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
    a.full_name,
    ti.treatment_name,
    COALESCE(ti.price_pence, 0)::BIGINT
  FROM dentally_treatment_items ti
  LEFT JOIN practices  pr ON pr.id = ti.practice_id
  LEFT JOIN contacts   c  ON c.id  = ti.contact_id
  LEFT JOIN associates a  ON a.id  = ti.associate_id
  WHERE ti.organisation_id = p_org
    AND ti.completed   IS TRUE
    AND ti.base_chart  IS FALSE
    AND ti.completed_at >= p_since
    AND (p_until    IS NULL OR ti.completed_at < p_until)
    AND (p_practice IS NULL OR ti.practice_id = p_practice)
  ORDER BY ti.completed_at DESC, ti.price_pence DESC
  LIMIT p_limit OFFSET COALESCE(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION treatments_completed_lines(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INTEGER, INTEGER) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
