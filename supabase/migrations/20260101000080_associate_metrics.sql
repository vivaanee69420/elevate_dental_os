-- 20260101000080_associate_metrics.sql
-- Fill the Associates roster's empty PRODUCTION / UDAs / CONV columns with REAL
-- Dentally data, and surface the practitioner-endpoint metadata the sync never
-- stored.
--
-- Two parts:
--  1) Practitioner metadata columns on `associates`. The Dentally /practitioners
--     payload carries gdc_number, nhs_number, colour, user.role and
--     contract_targets[].{uda_target,uoa_target} — none were persisted (only
--     name/email/practice/active were). Add them so the roster can show role +
--     GDC + the practitioner colour + the NHS contract UDA target.
--  2) `associate_metrics` RPC — one round trip returning, per associate:
--       production_pence  = SUM(invoice_items.fee_pence) — REAL invoiced fees
--                           attributed to the practitioner (associate_id resolved
--                           at sync time via pms_practitioner_id). This is the
--                           same money basis as turnover (000040/000074), NOT the
--                           sparse treatment_plans.private_value_pence.
--       uda_delivered     = SUM(treatment_plans.nhs_completed_uda_value) — NHS UDA
--                           units actually completed in the window.
--       plans_total       = COUNT(treatment_plans) started in the window
--       plans_completed   = COUNT(... WHERE completed) — drives CONV%
--                           (completed / total; the only acceptance proxy Dentally
--                           exposes, treatment_plans has no proposed/accepted flag).
-- invoice_items.invoiced_on + treatment_plans.start_date are DATEs; the timestamptz
-- window bounds are cast to date (matches 000041/000074). Idempotent.

ALTER TABLE associates ADD COLUMN IF NOT EXISTS nhs_number    TEXT;
ALTER TABLE associates ADD COLUMN IF NOT EXISTS colour        TEXT;
ALTER TABLE associates ADD COLUMN IF NOT EXISTS dentally_role TEXT;
ALTER TABLE associates ADD COLUMN IF NOT EXISTS uda_target    INTEGER;
ALTER TABLE associates ADD COLUMN IF NOT EXISTS uoa_target    INTEGER;

CREATE OR REPLACE FUNCTION associate_metrics(
  p_org   UUID,
  p_since TIMESTAMPTZ,
  p_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  associate_id     UUID,
  production_pence BIGINT,
  uda_delivered    NUMERIC,
  plans_total      BIGINT,
  plans_completed  BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH prod AS (
    SELECT ii.associate_id,
           COALESCE(SUM(ii.fee_pence), 0)::BIGINT AS production_pence
    FROM invoice_items ii
    WHERE ii.organisation_id = p_org
      AND ii.associate_id IS NOT NULL
      AND ii.invoiced_on >= p_since::date
      AND (p_until IS NULL OR ii.invoiced_on < p_until::date)
    GROUP BY ii.associate_id
  ),
  plans AS (
    SELECT tp.associate_id,
           COALESCE(SUM(tp.nhs_completed_uda_value), 0)::NUMERIC      AS uda_delivered,
           COUNT(*)::BIGINT                                           AS plans_total,
           COUNT(*) FILTER (WHERE tp.completed)::BIGINT               AS plans_completed
    FROM treatment_plans tp
    WHERE tp.organisation_id = p_org
      AND tp.associate_id IS NOT NULL
      AND tp.start_date >= p_since::date
      AND (p_until IS NULL OR tp.start_date < p_until::date)
    GROUP BY tp.associate_id
  )
  SELECT COALESCE(prod.associate_id, plans.associate_id)        AS associate_id,
         COALESCE(prod.production_pence, 0)::BIGINT             AS production_pence,
         COALESCE(plans.uda_delivered, 0)::NUMERIC             AS uda_delivered,
         COALESCE(plans.plans_total, 0)::BIGINT                AS plans_total,
         COALESCE(plans.plans_completed, 0)::BIGINT            AS plans_completed
  FROM prod
  FULL OUTER JOIN plans ON prod.associate_id = plans.associate_id;
$$;

GRANT EXECUTE ON FUNCTION associate_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
