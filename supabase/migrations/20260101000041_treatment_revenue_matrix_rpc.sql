-- 20260101000041_treatment_revenue_matrix_rpc.sql
-- Treatment REVENUE heat matrix — real invoiced fee by treatment name x practice
-- within a window, from invoice_items (the real per-treatment fee feed, migration
-- 000040). This is the £ counterpart to treatment_mix_matrix (which is volume).
-- fee_pence is the qty-inclusive total_price in integer pence. invoiced_on is a
-- DATE; the timestamptz window bounds are cast to date. NULL names -> 'Unspecified'.
-- Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION treatment_revenue_matrix(
  p_org   UUID,
  p_since TIMESTAMPTZ,
  p_until TIMESTAMPTZ
)
RETURNS TABLE (practice_id UUID, treatment_name TEXT, fee_pence BIGINT, item_count BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT ii.practice_id,
         COALESCE(NULLIF(ii.treatment_name, ''), 'Unspecified') AS treatment_name,
         COALESCE(SUM(ii.fee_pence), 0)::BIGINT AS fee_pence,
         COUNT(*)::BIGINT AS item_count
  FROM invoice_items ii
  WHERE ii.organisation_id = p_org
    AND ii.invoiced_on >= p_since::date
    AND (p_until IS NULL OR ii.invoiced_on < p_until::date)
  GROUP BY ii.practice_id, COALESCE(NULLIF(ii.treatment_name, ''), 'Unspecified');
$$;

GRANT EXECUTE ON FUNCTION treatment_revenue_matrix(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
