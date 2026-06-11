-- 20260101000079_billed_revenue_by_month_rpc.sql
-- Billed turnover bucketed by calendar month — real invoiced production from
-- invoice_items (Dentally feed, migration 000040), the SAME accrual turnover
-- source Business Hub / Group Overview use (treatment_revenue_matrix). Powers
-- the Value & Growth valuation base (finance-series) so its TTM revenue agrees
-- with the dashboard turnover instead of using settled cash receipts.
--
-- fee_pence is the qty-inclusive total in integer pence. invoiced_on is a DATE;
-- the timestamptz window bounds are cast to date. p_practice scopes to one
-- practice (NULL = whole org). month is the 'YYYY-MM' key matching the service's
-- _monthWindow / _monthlyRevenueFromDays bucketing. Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION billed_revenue_by_month(
  p_org      UUID,
  p_since    TIMESTAMPTZ,
  p_until    TIMESTAMPTZ DEFAULT NULL,
  p_practice UUID        DEFAULT NULL
)
RETURNS TABLE (month TEXT, pence BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT to_char(ii.invoiced_on, 'YYYY-MM') AS month,
         COALESCE(SUM(ii.fee_pence), 0)::BIGINT AS pence
  FROM invoice_items ii
  WHERE ii.organisation_id = p_org
    AND ii.invoiced_on >= p_since::date
    AND (p_until IS NULL OR ii.invoiced_on < p_until::date)
    AND (p_practice IS NULL OR ii.practice_id = p_practice)
  GROUP BY to_char(ii.invoiced_on, 'YYYY-MM');
$$;

GRANT EXECUTE ON FUNCTION billed_revenue_by_month(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
