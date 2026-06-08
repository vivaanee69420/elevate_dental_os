-- 20260101000058_treatment_breakdown_rpc.sql
-- Flat "by treatment" breakdown — real invoiced fee + distinct patient count
-- grouped by treatment_name ALONE (no practice split), from invoice_items (the
-- real per-treatment fee feed, migration 000040). This is the honest source for
-- the CRM Reports "By treatment" card, which previously mis-grouped GHL leads by
-- opp.name (junk like "New Lead || 22/03/2026").
--   fee_pence      = qty-inclusive total_price in integer pence (patient retail fee)
--   item_count     = COUNT(*) invoice lines
--   patient_count  = COUNT(DISTINCT contact_id) — unique patients invoiced
-- invoiced_on is a DATE; the timestamptz window bounds are cast to date. Both
-- window bounds are optional (NULL = unbounded). NULL/'' names -> 'Unspecified'.
-- Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION treatment_breakdown(
  p_org   UUID,
  p_since TIMESTAMPTZ DEFAULT NULL,
  p_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (treatment_name TEXT, fee_pence BIGINT, item_count BIGINT, patient_count BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(ii.treatment_name, ''), 'Unspecified') AS treatment_name,
         COALESCE(SUM(ii.fee_pence), 0)::BIGINT                 AS fee_pence,
         COUNT(*)::BIGINT                                       AS item_count,
         COUNT(DISTINCT ii.contact_id)::BIGINT                  AS patient_count
  FROM invoice_items ii
  WHERE ii.organisation_id = p_org
    AND (p_since IS NULL OR ii.invoiced_on >= p_since::date)
    AND (p_until IS NULL OR ii.invoiced_on <  p_until::date)
  GROUP BY COALESCE(NULLIF(ii.treatment_name, ''), 'Unspecified');
$$;

GRANT EXECUTE ON FUNCTION treatment_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
