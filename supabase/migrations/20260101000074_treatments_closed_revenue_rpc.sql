-- 20260101000074_treatments_closed_revenue_rpc.sql
-- Treatment-plan revenue, REAL feed, PER PRACTICE — BILLED and PAID. The Business
-- Hub funnel card previously summed treatment_plans.private_value_pence (Dentally's
-- PLANNED private estimate — only populated on ~22% of completed plans, and not
-- comparable to turnover which is real invoiced fees). It was also forced org-wide
-- because the Dentally treatment_plans feed carries no practice_id. This RPC sums
-- the REAL per-treatment invoiced fee (invoice_items, migration 000040) for lines
-- that belong to a treatment plan (treatment_plan_id NOT NULL) within the window,
-- GROUPED BY practice_id — which invoice_items DO carry (100% populated) — so the
-- cards can be scoped to a single practice like turnover. Returns TWO figures:
--   closed_value_pence = ALL plan-linked invoiced fees (billed = sold; matches
--                        turnover's basis, which also excludes no paid filter)
--   paid_value_pence   = the subset on a PAID invoice (invoice_paid IS TRUE) —
--                        treatment money actually COLLECTED; matches Dentally's
--                        "Paid" invoice filter. The gap (closed - paid) is debtors.
-- invoiced_on is a DATE; the timestamptz window bounds are cast to date (000041).
-- Idempotent. DROP first because the earlier form returned a single column.

DROP FUNCTION IF EXISTS treatments_closed_revenue_by_org(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS treatments_closed_revenue_by_practice(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION treatments_closed_revenue_by_practice(
  p_org   UUID,
  p_since TIMESTAMPTZ,
  p_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (practice_id UUID, closed_value_pence BIGINT, paid_value_pence BIGINT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ii.practice_id,
         COALESCE(SUM(ii.fee_pence), 0)::BIGINT AS closed_value_pence,
         COALESCE(SUM(ii.fee_pence) FILTER (WHERE ii.invoice_paid IS TRUE), 0)::BIGINT AS paid_value_pence
  FROM invoice_items ii
  WHERE ii.organisation_id = p_org
    AND ii.treatment_plan_id IS NOT NULL
    AND ii.invoiced_on >= p_since::date
    AND (p_until IS NULL OR ii.invoiced_on < p_until::date)
  GROUP BY ii.practice_id;
$$;

GRANT EXECUTE ON FUNCTION treatments_closed_revenue_by_practice(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
