-- 20260101000042_invoice_case_rollup_rpc.sql
-- Per-invoice rollup of invoice_items: the treatment names on an invoice + its
-- total fee. Feeds the Treatment Economics Workbench "real case fee" seeding:
-- a dental "case" (implant, full arch, Invisalign) is billed as MULTIPLE line
-- items, so the honest case fee = the average INVOICE total for invoices that
-- contain that procedure — not a single line. Classification by treatment name
-- happens in JS (formulas.classifyCaseFees), not SQL. Idempotent.

CREATE OR REPLACE FUNCTION invoice_case_rollup(
  p_org   UUID,
  p_since TIMESTAMPTZ
)
RETURNS TABLE (pms_invoice_id TEXT, names TEXT[], total_pence BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT ii.pms_invoice_id,
         array_agg(COALESCE(ii.treatment_name, '')) AS names,
         COALESCE(SUM(ii.fee_pence), 0)::BIGINT AS total_pence
  FROM invoice_items ii
  WHERE ii.organisation_id = p_org
    AND ii.pms_invoice_id IS NOT NULL
    AND ii.invoiced_on >= p_since::date
  GROUP BY ii.pms_invoice_id;
$$;

GRANT EXECUTE ON FUNCTION invoice_case_rollup(UUID, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
