-- 20260101000101_treatments_closed_proportional_paid.sql
-- Redefine paid_value_pence ("Plan Fees Collected") to match Dentally EXACTLY.
--
-- The previous form (migration 000074) counted a treatment line as collected only
-- when its WHOLE invoice was fully paid (invoice_paid IS TRUE) — an all-or-nothing
-- per-invoice rule. Dentally's reports (Invoice Timeline "Paid", Patient Accounts)
-- instead count the amount ACTUALLY collected, including partial payments. So a
-- £11,900 invoice with £27.80 still outstanding shows ~£11,872 collected in Dentally
-- but contributed £0 to our card — understating "Plan Fees Collected" badly (live
-- Ashford Jun 2026: ours £57,222 / 69% vs Dentally ~96%).
--
-- New definition: allocate each invoice's collected amount across its lines pro-rata
-- by value, then sum the treatment-plan lines' share:
--   collected_ratio(invoice) = (amount_pence - amount_outstanding_pence) / amount_pence
--   paid_value_pence         = SUM( line.fee_pence * collected_ratio )   over plan lines
-- This is the same basis Dentally uses (payments settle the invoice as a whole;
-- pro-rata splits that across the invoice's lines). closed_value_pence is unchanged
-- (all plan-linked billed fees). The gap (closed - paid) is the real outstanding
-- treatment debtors.
--
-- amount_pence is the invoice GROSS (treatments + sundries); the ratio is the same
-- for every line on the invoice, so treatment lines get their fair collected share.
-- LEFT JOIN so a line whose parent invoice row hasn't synced yet still counts as
-- billed (closed) and simply contributes 0 to paid until the invoice lands.
-- Idempotent (CREATE OR REPLACE, same signature/return).

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
         COALESCE(SUM(
           ii.fee_pence
           * CASE
               WHEN inv.amount_pence IS NULL OR inv.amount_pence = 0 THEN 0
               -- clamp to [0,1]: a credit/over-payment must not push collected
               -- above the line's billed value or negative.
               ELSE GREATEST(0, LEAST(1,
                 (inv.amount_pence - COALESCE(inv.amount_outstanding_pence, 0))::numeric
                 / inv.amount_pence))
             END
         ), 0)::BIGINT AS paid_value_pence
  FROM invoice_items ii
  LEFT JOIN invoices inv
    ON inv.organisation_id = ii.organisation_id
   AND inv.source          = ii.source
   AND inv.external_id      = ii.pms_invoice_id
  WHERE ii.organisation_id = p_org
    AND ii.treatment_plan_id IS NOT NULL
    AND ii.invoiced_on >= p_since::date
    AND (p_until IS NULL OR ii.invoiced_on < p_until::date)
  GROUP BY ii.practice_id;
$$;

GRANT EXECUTE ON FUNCTION treatments_closed_revenue_by_practice(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
