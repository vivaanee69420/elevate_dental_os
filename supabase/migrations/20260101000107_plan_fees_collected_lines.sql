-- 20260101000107_plan_fees_collected_lines.sql
-- Drill-down behind the "Plan Fees Collected" card (Business Hub / Group
-- Performance). The card sums treatment-plan invoice lines, pro-rated by how
-- much of each parent invoice was actually collected (see migration 000101,
-- treatments_closed_revenue_by_practice). Owners asked to SEE every line behind
-- the number to verify it, so this returns the raw source rows: one row per
-- invoice_items line that contributes to the card, with the exact pieces the
-- pro-rata uses (invoice gross + outstanding) so the maths is auditable.
--
-- SAME WHERE clause + SAME collected-ratio as treatments_closed_revenue_by_practice,
-- so SUM(billed_pence) == the card's "Treatments Closed" and the collected total
-- reconciles to "Plan Fees Collected" (per-line collected is ROUNDed to the penny
-- for display; the canonical total comes from the aggregate RPC, which rounds the
-- summed products once — a few pence of rounding drift across the lines is normal).
-- Optional p_practice scopes to one practice (matches the card's practice filter).
-- Idempotent (CREATE OR REPLACE). After applying on hosted: NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION plan_fees_collected_lines(
  p_org      UUID,
  p_since    TIMESTAMPTZ,
  p_until    TIMESTAMPTZ DEFAULT NULL,
  p_practice UUID DEFAULT NULL
)
RETURNS TABLE (
  invoice_item_id           UUID,
  invoiced_on               DATE,
  practice_id               UUID,
  practice_name             TEXT,
  patient_name              TEXT,
  treatment_name            TEXT,
  treatment_plan_id         TEXT,
  invoice_id                TEXT,
  billed_pence              BIGINT,
  collected_pence           BIGINT,
  invoice_amount_pence      BIGINT,
  invoice_outstanding_pence BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    ii.id,
    ii.invoiced_on,
    ii.practice_id,
    pr.name,
    NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
    ii.treatment_name,
    ii.treatment_plan_id,
    ii.pms_invoice_id,
    ii.fee_pence::BIGINT,
    ROUND(
      ii.fee_pence
      * CASE
          WHEN inv.amount_pence IS NULL OR inv.amount_pence = 0 THEN 0
          ELSE GREATEST(0, LEAST(1,
            (inv.amount_pence - COALESCE(inv.amount_outstanding_pence, 0))::numeric
            / inv.amount_pence))
        END
    )::BIGINT,
    inv.amount_pence::BIGINT,
    inv.amount_outstanding_pence::BIGINT
  FROM invoice_items ii
  LEFT JOIN invoices  inv ON inv.organisation_id = ii.organisation_id
                         AND inv.source          = ii.source
                         AND inv.external_id      = ii.pms_invoice_id
  LEFT JOIN practices pr  ON pr.id = ii.practice_id
  LEFT JOIN contacts  c   ON c.id  = ii.contact_id
  WHERE ii.organisation_id   = p_org
    AND ii.treatment_plan_id IS NOT NULL
    AND ii.invoiced_on      >= p_since::date
    AND (p_until    IS NULL OR ii.invoiced_on < p_until::date)
    AND (p_practice IS NULL OR ii.practice_id = p_practice)
  ORDER BY ii.invoiced_on DESC, ii.fee_pence DESC;
$$;

GRANT EXECUTE ON FUNCTION plan_fees_collected_lines(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
