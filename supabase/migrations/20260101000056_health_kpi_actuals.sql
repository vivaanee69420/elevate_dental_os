-- 20260101000056_health_kpi_actuals.sql
-- Live actuals for the KPI Scorecard's previously-manual metrics, sourced from
-- the Dentally-synced tables. Two RPCs (GROUP BY in Postgres so the 1000-row
-- read cap never truncates appointment/invoice scans). Both are STABLE, pure
-- reads, org-scoped by p_org, and idempotent (CREATE OR REPLACE).
--
-- Resolution semantics (business-health.service.metrics): a non-null value here
-- WINS over the owner's manual entry and renders as an auto/source-chip tile;
-- a null result (no source data yet) falls back to the manual entry. So a
-- metric with no Dentally signal (e.g. recall dates never synced) stays manual
-- with zero fabrication.

-- ----------------------------------------------------------------------------
-- Patient KPIs from appointments + contacts:
--   new_patients_month : avg new patients/month over the trailing 12 months,
--                        where "new" = a contact whose FIRST appointment falls
--                        in the window (registration date is not synced, so the
--                        first-ever visit is the honest proxy).
--   active_patients    : distinct patients with an appointment in the last 12mo.
--   retention_12mo     : of patients active in the prior year (24-12mo ago), the
--                        share also active in the last 12mo. NULL if no prior
--                        cohort exists.
--   recall_compliance  : of patients whose next_recall_date is due (<= as-of),
--                        the share with an appointment on/after that date. NULL
--                        when no recall dates are synced (Dentally often omits
--                        them) -> falls back to manual.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION health_patient_actuals(p_org UUID, p_asof DATE DEFAULT NULL)
RETURNS JSON
LANGUAGE sql
STABLE
AS $$
  WITH ref AS (SELECT COALESCE(p_asof, CURRENT_DATE) AS d),
  appt AS (
    SELECT a.contact_id, a.starts_at::date AS day
    FROM appointments a, ref
    WHERE a.organisation_id = p_org
      AND a.contact_id IS NOT NULL
      AND a.starts_at::date <= ref.d
  ),
  first_appt AS (
    SELECT contact_id, MIN(day) AS first_day FROM appt GROUP BY contact_id
  ),
  new_pat AS (
    SELECT COUNT(*)::numeric AS c
    FROM first_appt, ref
    WHERE first_day > ref.d - INTERVAL '12 months'
  ),
  active AS (
    SELECT COUNT(DISTINCT contact_id) AS c
    FROM appt, ref WHERE day > ref.d - INTERVAL '12 months'
  ),
  prior AS (
    SELECT DISTINCT contact_id FROM appt, ref
    WHERE day > ref.d - INTERVAL '24 months' AND day <= ref.d - INTERVAL '12 months'
  ),
  recent AS (
    SELECT DISTINCT contact_id FROM appt, ref WHERE day > ref.d - INTERVAL '12 months'
  ),
  retained AS (
    SELECT COUNT(*) AS c FROM prior p
    WHERE EXISTS (SELECT 1 FROM recent r WHERE r.contact_id = p.contact_id)
  ),
  recall_due AS (
    SELECT c.id, c.next_recall_date
    FROM contacts c, ref
    WHERE c.organisation_id = p_org
      AND c.type = 'patient'
      AND c.next_recall_date IS NOT NULL
      AND c.next_recall_date <= ref.d
  ),
  recall_met AS (
    SELECT COUNT(*) AS c FROM recall_due rd
    WHERE EXISTS (
      SELECT 1 FROM appointments a
      WHERE a.organisation_id = p_org AND a.contact_id = rd.id
        AND a.starts_at::date >= rd.next_recall_date
    )
  )
  SELECT json_build_object(
    'new_patients_month', ROUND((SELECT c FROM new_pat) / 12.0),
    'active_patients',    (SELECT c FROM active),
    'retention_12mo',
      CASE WHEN (SELECT COUNT(*) FROM prior) = 0 THEN NULL
           ELSE ROUND(100.0 * (SELECT c FROM retained) / (SELECT COUNT(*) FROM prior), 1) END,
    'recall_compliance',
      CASE WHEN (SELECT COUNT(*) FROM recall_due) = 0 THEN NULL
           ELSE ROUND(100.0 * (SELECT c FROM recall_met) / (SELECT COUNT(*) FROM recall_due), 1) END
  );
$$;

GRANT EXECUTE ON FUNCTION health_patient_actuals(UUID, DATE) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Production KPIs from invoice_items (real Dentally invoiced fees):
--   avg_case_value_pence          : mean total fee per treatment_plan_id (a
--                                   "case" is billed as multiple line items).
--                                   NULL when no plan-tagged items in window.
--   production_per_associate_pence: total invoiced fee / distinct producing
--                                   associates / months in window. NULL when no
--                                   associate-tagged items.
-- Window is [p_since, p_until); p_until NULL = open (uses NOW() for the month
-- span). Money stays integer pence.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION health_production_actuals(p_org UUID, p_since TIMESTAMPTZ, p_until TIMESTAMPTZ DEFAULT NULL)
RETURNS JSON
LANGUAGE sql
STABLE
AS $$
  WITH items AS (
    SELECT ii.treatment_plan_id, ii.associate_id, ii.fee_pence
    FROM invoice_items ii
    WHERE ii.organisation_id = p_org
      AND ii.invoiced_on >= p_since::date
      AND (p_until IS NULL OR ii.invoiced_on < p_until::date)
  ),
  cases AS (
    SELECT treatment_plan_id, SUM(fee_pence) AS case_fee
    FROM items WHERE treatment_plan_id IS NOT NULL
    GROUP BY treatment_plan_id
  ),
  assoc AS (
    SELECT associate_id, SUM(fee_pence) AS fee
    FROM items WHERE associate_id IS NOT NULL
    GROUP BY associate_id
  ),
  span AS (
    SELECT GREATEST(1.0, EXTRACT(EPOCH FROM (COALESCE(p_until, NOW()) - p_since)) / 2629746.0) AS months
  )
  SELECT json_build_object(
    'avg_case_value_pence', (SELECT ROUND(AVG(case_fee)) FROM cases),
    'production_per_associate_pence',
      CASE WHEN (SELECT COUNT(*) FROM assoc) = 0 THEN NULL
           ELSE ROUND( (SELECT SUM(fee) FROM assoc)::numeric
                       / (SELECT COUNT(*) FROM assoc)
                       / (SELECT months FROM span) ) END
  );
$$;

GRANT EXECUTE ON FUNCTION health_production_actuals(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
