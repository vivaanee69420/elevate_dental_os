-- ============================================================================
-- ONE WINDOW CONVENTION, RESOLVED IN Europe/London.
--
-- WHY. Every period picker in the app resolves to a half-open [since, until)
-- pair of INSTANTS built in Europe/London (frontend `londonISO`). The database
-- runs in UTC. Two independent things then went wrong, in OPPOSITE seasons,
-- which is exactly why neither ever looked like a consistent bug:
--
--   1. DATE COLUMNS. `invoiced_on >= p_since::date` casts a London instant in
--      UTC. In BST, "1 Aug London" is 2026-07-31T23:00Z, so ::date yields
--      31 JULY. Every BST month therefore read a window shifted one day early.
--      Measured on the live org: August 2026 group turnover read £399,066.22
--      against a true £379,347.12 (+£19,719.10, 5.2%); July 2026 +£21,607.62.
--      GMT months were correct, so the error vanished each winter.
--
--   2. TIMESTAMPTZ COLUMNS. `processed_at <= p_until` applies an INCLUSIVE
--      test to an EXCLUSIVE bound. Every payment row on this instance is
--      stamped at exactly midnight (it is a date-only feed coerced to
--      timestamptz), so in GMT — where the exclusive bound lands ON midnight —
--      the whole first day of the NEXT period was counted. Measured:
--      November 2025 takings read £366,313.91 against a true £337,041.41
--      (+£29,272.50, 8.7%); October 2025 +£12,391.16. BST months were correct,
--      so this error vanished each summer, in the opposite half of the year
--      from (1).
--
-- THE RULE, from here on, everywhere:
--   * timestamptz column -> `>= p_since AND < p_until`. The instant already
--     carries the London offset; it needs no reinterpretation.
--   * date column        -> `>= window_first_day(p_since)`
--                           `<= window_last_day(p_until)`.
--     Never `::date` on a window bound: that resolves in the server's zone,
--     not the user's.
--
-- window_last_day() TAKES AN EXCLUSIVE BOUND. It steps back one millisecond
-- before taking the London date, so an exclusive next-period-start resolves to
-- the last day actually inside the window. Handing it an inclusive
-- end-of-day (23:59:59.999) would push it a day forward in BST — callers must
-- pass the exclusive bound the period pickers already produce.
--
-- DELIBERATELY NOT TOUCHED: invoice_case_rollup() and sheet_export_revenue().
-- Both take a bare `p_since` cutoff with no `p_until` — they are "everything
-- since this instant" reads, not calendar windows, so reinterpreting their
-- bound as a London calendar day would move a cutoff that is correct today.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The two helpers. STABLE, not IMMUTABLE: the zone rules live in the tzdata
-- the server ships, which a Postgres minor upgrade can change.
-- ---------------------------------------------------------------------------
create or replace function public.window_first_day(p_since timestamptz)
returns date
language sql stable parallel safe
set search_path = public
as $$ select (p_since at time zone 'Europe/London')::date $$;

comment on function public.window_first_day(timestamptz) is
  'First London calendar day inside a [since, until) window. Use instead of p_since::date, which resolves in the server zone (UTC) and lands a day early through BST.';

create or replace function public.window_last_day(p_until timestamptz)
returns date
language sql stable parallel safe
set search_path = public
as $$ select ((p_until at time zone 'Europe/London') - interval '1 millisecond')::date $$;

comment on function public.window_last_day(timestamptz) is
  'Last London calendar day inside a [since, until) window. TAKES THE EXCLUSIVE UPPER BOUND (start of the next period), not an inclusive end-of-day.';

revoke all on function public.window_first_day(timestamptz) from public, anon, authenticated;
revoke all on function public.window_last_day(timestamptz)  from public, anon, authenticated;
grant execute on function public.window_first_day(timestamptz) to service_role;
grant execute on function public.window_last_day(timestamptz)  to service_role;

-- ---------------------------------------------------------------------------
-- (1) DATE-COLUMN FUNCTIONS — bounds now resolve in Europe/London.
-- Bodies are byte-identical to the deployed versions apart from the bounds.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.treatment_revenue_matrix(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone)
 RETURNS TABLE(practice_id uuid, treatment_name text, fee_pence bigint, item_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT ii.practice_id,
         COALESCE(NULLIF(ii.treatment_name, ''), 'Unspecified') AS treatment_name,
         COALESCE(SUM(ii.fee_pence), 0)::BIGINT AS fee_pence,
         COUNT(*)::BIGINT AS item_count
  FROM invoice_items ii
  WHERE ii.organisation_id = p_org
    AND ii.invoiced_on >= public.window_first_day(p_since)
    AND (p_until IS NULL OR ii.invoiced_on <= public.window_last_day(p_until))
  GROUP BY ii.practice_id, COALESCE(NULLIF(ii.treatment_name, ''), 'Unspecified');
$function$;

CREATE OR REPLACE FUNCTION public.treatments_closed_revenue_by_practice(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(practice_id uuid, closed_value_pence bigint, paid_value_pence bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT ii.practice_id,
         COALESCE(SUM(ii.fee_pence), 0)::BIGINT AS closed_value_pence,
         COALESCE(SUM(
           ii.fee_pence
           * CASE
               WHEN inv.amount_pence IS NULL OR inv.amount_pence = 0 THEN 0
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
    AND ii.invoiced_on >= public.window_first_day(p_since)
    AND (p_until IS NULL OR ii.invoiced_on <= public.window_last_day(p_until))
  GROUP BY ii.practice_id;
$function$;

CREATE OR REPLACE FUNCTION public.plan_fees_collected_lines(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_practice uuid DEFAULT NULL::uuid)
 RETURNS TABLE(invoice_item_id uuid, invoiced_on date, practice_id uuid, practice_name text, patient_name text, treatment_name text, treatment_plan_id text, invoice_id text, billed_pence bigint, collected_pence bigint, invoice_amount_pence bigint, invoice_outstanding_pence bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT ii.id, ii.invoiced_on, ii.practice_id, pr.name,
    NULLIF(TRIM(COALESCE(c.first_name,'')||' '||COALESCE(c.last_name,'')), ''),
    ii.treatment_name, ii.treatment_plan_id, ii.pms_invoice_id, ii.fee_pence::BIGINT,
    ROUND(ii.fee_pence * CASE WHEN inv.amount_pence IS NULL OR inv.amount_pence=0 THEN 0
      ELSE GREATEST(0, LEAST(1, (inv.amount_pence - COALESCE(inv.amount_outstanding_pence,0))::numeric/inv.amount_pence)) END)::BIGINT,
    inv.amount_pence::BIGINT, inv.amount_outstanding_pence::BIGINT
  FROM invoice_items ii
  LEFT JOIN invoices inv ON inv.organisation_id=ii.organisation_id AND inv.source=ii.source AND inv.external_id=ii.pms_invoice_id
  LEFT JOIN practices pr ON pr.id = ii.practice_id
  LEFT JOIN contacts c ON c.id = ii.contact_id
  WHERE ii.organisation_id=p_org AND ii.treatment_plan_id IS NOT NULL
    AND ii.invoiced_on >= public.window_first_day(p_since) AND (p_until IS NULL OR ii.invoiced_on <= public.window_last_day(p_until))
    AND (p_practice IS NULL OR ii.practice_id = p_practice)
  ORDER BY ii.invoiced_on DESC, ii.fee_pence DESC;
$function$;

CREATE OR REPLACE FUNCTION public.treatment_breakdown(p_org uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(treatment_name text, fee_pence bigint, item_count bigint, patient_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(NULLIF(ii.treatment_name, ''), 'Unspecified') AS treatment_name,
         COALESCE(SUM(ii.fee_pence), 0)::BIGINT                 AS fee_pence,
         COUNT(*)::BIGINT                                       AS item_count,
         COUNT(DISTINCT ii.contact_id)::BIGINT                  AS patient_count
  FROM invoice_items ii
  WHERE ii.organisation_id = p_org
    AND (p_since IS NULL OR ii.invoiced_on >= public.window_first_day(p_since))
    AND (p_until IS NULL OR ii.invoiced_on <= public.window_last_day(p_until))
  GROUP BY COALESCE(NULLIF(ii.treatment_name, ''), 'Unspecified');
$function$;

CREATE OR REPLACE FUNCTION public.billed_revenue_by_month(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_practice uuid DEFAULT NULL::uuid)
 RETURNS TABLE(month text, pence bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT to_char(ii.invoiced_on, 'YYYY-MM') AS month,
         COALESCE(SUM(ii.fee_pence), 0)::BIGINT AS pence
  FROM invoice_items ii
  WHERE ii.organisation_id = p_org
    AND ii.invoiced_on >= public.window_first_day(p_since)
    AND (p_until IS NULL OR ii.invoiced_on <= public.window_last_day(p_until))
    AND (p_practice IS NULL OR ii.practice_id = p_practice)
  GROUP BY to_char(ii.invoiced_on, 'YYYY-MM');
$function$;

CREATE OR REPLACE FUNCTION public.associate_metrics(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(associate_id uuid, production_pence bigint, uda_delivered numeric, plans_total bigint, plans_completed bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH prod AS (
    SELECT ii.associate_id,
           COALESCE(SUM(ii.fee_pence), 0)::BIGINT AS production_pence
    FROM invoice_items ii
    WHERE ii.organisation_id = p_org
      AND ii.associate_id IS NOT NULL
      AND ii.invoiced_on >= public.window_first_day(p_since)
      AND (p_until IS NULL OR ii.invoiced_on <= public.window_last_day(p_until))
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
      AND tp.start_date >= public.window_first_day(p_since)
      AND (p_until IS NULL OR tp.start_date <= public.window_last_day(p_until))
    GROUP BY tp.associate_id
  )
  SELECT COALESCE(prod.associate_id, plans.associate_id)        AS associate_id,
         COALESCE(prod.production_pence, 0)::BIGINT             AS production_pence,
         COALESCE(plans.uda_delivered, 0)::NUMERIC             AS uda_delivered,
         COALESCE(plans.plans_total, 0)::BIGINT                AS plans_total,
         COALESCE(plans.plans_completed, 0)::BIGINT            AS plans_completed
  FROM prod
  FULL OUTER JOIN plans ON prod.associate_id = plans.associate_id;
$function$;

CREATE OR REPLACE FUNCTION public.health_production_actuals(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH items AS (
    SELECT ii.treatment_plan_id, ii.associate_id, ii.fee_pence
    FROM invoice_items ii
    WHERE ii.organisation_id = p_org
      AND ii.invoiced_on >= public.window_first_day(p_since)
      AND (p_until IS NULL OR ii.invoiced_on <= public.window_last_day(p_until))
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
$function$;

CREATE OR REPLACE FUNCTION public.treatment_accepted_aggregate(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_practice uuid DEFAULT NULL::uuid)
 RETURNS TABLE(accepted_count bigint, accepted_value_pence bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::bigint, coalesce(sum(value_pence),0)::bigint
  from public.treatment_accepted
  where organisation_id = p_org and status = 'accepted'
    and (p_since is null or accepted_date >= public.window_first_day(p_since))
    and (p_until is null or accepted_date <= public.window_last_day(p_until))
    and (p_practice is null or practice_id = p_practice);
$function$;

CREATE OR REPLACE FUNCTION public.treatment_accepted_by_practice(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(practice_id uuid, accepted_count bigint, accepted_value_pence bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    t.practice_id,
    count(*)::bigint as accepted_count,
    coalesce(sum(t.value_pence), 0)::bigint as accepted_value_pence
  from public.treatment_accepted t
  where t.organisation_id = p_org
    and t.status = 'accepted'
    and (p_since is null or t.accepted_date >= public.window_first_day(p_since))
    and (p_until is null or t.accepted_date <= public.window_last_day(p_until))
  group by t.practice_id;
$function$;

-- Mixed: start_date is a DATE, completed_at is a TIMESTAMPTZ. Both rules apply.
CREATE OR REPLACE FUNCTION public.treatments_rollup_by_org(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(started bigint, completed bigint, closed_value_pence bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    count(*) filter (
      where start_date >= public.window_first_day(p_since)
        and (p_until is null or start_date <= public.window_last_day(p_until))
    )::bigint,
    count(*) filter (
      where completed and completed_at >= p_since
        and (p_until is null or completed_at < p_until)
    )::bigint,
    coalesce(sum(private_value_pence) filter (
      where completed and completed_at >= p_since
        and (p_until is null or completed_at < p_until)
        and private_value_pence > 0
    ), 0)::bigint
  from public.treatment_plans
  where organisation_id = p_org;
$function$;

-- ---------------------------------------------------------------------------
-- (2) TIMESTAMPTZ FUNCTIONS — `<= p_until` becomes `< p_until`.
-- The instant already carries the London offset, so the bound needs no
-- reinterpretation; it only needs to stop being inclusive of an exclusive end.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.settled_revenue_by_practice(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_exclude_sources text[] DEFAULT '{}'::text[])
 RETURNS TABLE(practice_id uuid, pence bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select practice_id, coalesce(sum(amount_pence), 0)::bigint
  from public.payments
  where organisation_id = p_org and status = 'settled' and processed_at >= p_since
    and (p_until is null or processed_at < p_until)
    and (cardinality(p_exclude_sources) = 0 or coalesce(source, '') <> all(p_exclude_sources))
  group by practice_id;
$function$;

CREATE OR REPLACE FUNCTION public.settled_receipts_by_day(p_org uuid, p_since timestamp with time zone, p_practice uuid DEFAULT NULL::uuid, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_exclude_sources text[] DEFAULT '{}'::text[])
 RETURNS TABLE(day date, pence bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select date_trunc('day', processed_at)::date as day,
         coalesce(sum(amount_pence), 0)::bigint as pence
  from public.payments
  where organisation_id = p_org
    and status = 'settled'
    and processed_at >= p_since
    and (p_until is null or processed_at < p_until)
    and (p_practice is null or practice_id = p_practice)
    and (coalesce(cardinality(p_exclude_sources), 0) = 0
         or coalesce(source, '') <> all(p_exclude_sources))
  group by 1
  order by 1;
$function$;

CREATE OR REPLACE FUNCTION public.appointments_rollup_by_practice(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(practice_id uuid, total bigint, completed bigint, no_shows bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select practice_id,
         count(*) filter (where pms_patient_id is not null)::bigint,
         count(*) filter (where pms_patient_id is not null and status = 'completed')::bigint,
         count(*) filter (where pms_patient_id is not null and status = 'no_show')::bigint
  from public.appointments
  where organisation_id = p_org and starts_at >= p_since
    and (p_until is null or starts_at < p_until)
  group by practice_id;
$function$;

CREATE OR REPLACE FUNCTION public.leads_rollup_by_practice(p_org uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(practice_id uuid, total bigint, converted bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select practice_id,
         count(*)::bigint,
         count(*) filter (
           where status in ('consultation_booked', 'treatment_started', 'treatment_completed')
         )::bigint
  from public.leads
  where organisation_id = p_org
    and (p_since is null or created_at >= p_since)
    and (p_until is null or created_at < p_until)
  group by practice_id;
$function$;

CREATE OR REPLACE FUNCTION public.chair_booked_minutes_by_practice(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(practice_id uuid, booked_minutes bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select practice_id,
         coalesce(sum(
           least(greatest(extract(epoch from (ends_at - starts_at)) / 60.0, 0), 480)
         ), 0)::bigint as booked_minutes
  from public.appointments
  where organisation_id = p_org
    and status = 'completed'
    and ends_at is not null
    and starts_at >= p_since
    and (p_until is null or starts_at < p_until)
  group by practice_id
$function$;

CREATE OR REPLACE FUNCTION public.treatment_mix_stats(p_org uuid, p_practice uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(appointment_type text, volume bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(a.appointment_type, 'Unspecified') AS appointment_type,
         COUNT(*)::BIGINT AS volume
  FROM public.appointments a
  WHERE a.organisation_id = p_org
    AND a.starts_at >= p_since
    AND (p_until IS NULL OR a.starts_at < p_until)
    AND (p_practice IS NULL OR a.practice_id = p_practice)
    AND a.pms_patient_id IS NOT NULL
  GROUP BY COALESCE(a.appointment_type, 'Unspecified')
  ORDER BY volume DESC;
$function$;

CREATE OR REPLACE FUNCTION public.org_new_patients_count(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_practice uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with first_appt as (
    select contact_id, min(starts_at) as first_seen
    from public.appointments
    where organisation_id = p_org and contact_id is not null
    group by contact_id
  ),
  anchors as (
    select c.practice_id,
           coalesce(c.pms_registered_at, fa.first_seen) as anchor
    from public.contacts c
    left join first_appt fa on fa.contact_id = c.id
    where c.organisation_id = p_org and c.type = 'patient'
      and (p_practice is null or c.practice_id = p_practice)
  )
  select count(*)::bigint
  from anchors
  where anchor is not null
    and anchor >= p_since
    and (p_until is null or anchor < p_until);
$function$;

CREATE OR REPLACE FUNCTION public.payment_summary(p_org uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_practice uuid DEFAULT NULL::uuid, p_exclude_sources text[] DEFAULT '{}'::text[])
 RETURNS TABLE(received_pence bigint, outstanding_pence bigint, refunded_pence bigint, txn_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with f as (
    select amount_pence, status,
           ((p_since is null or processed_at >= p_since)
            and (p_until is null or processed_at < p_until)) as in_range
    from public.payments
    where organisation_id = p_org
      and (p_practice is null or practice_id = p_practice)
      and (cardinality(p_exclude_sources) = 0 or coalesce(source, '') <> all(p_exclude_sources))
  )
  select
    coalesce(sum(amount_pence) filter (where status = 'settled' and in_range), 0)::bigint,
    coalesce(sum(amount_pence) filter (where status = 'pending'), 0)::bigint,
    coalesce(sum(amount_pence) filter (where status = 'refunded' and in_range), 0)::bigint,
    count(*) filter (where in_range)::bigint
  from f;
$function$;

CREATE OR REPLACE FUNCTION public.growth_practice_performance(p_org uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_practice uuid DEFAULT NULL::uuid)
 RETURNS TABLE(practice_id uuid, name text, new_patients bigint, appts bigint, completed bigint, no_shows bigint, revenue_pence bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with pr as (
    select id, name from public.practices
    where organisation_id = p_org
      and kind = 'practice'
      and (p_practice is null or id = p_practice)
  ),
  pat as (
    select c.practice_id, count(*)::bigint as n
    from public.contacts c
    where c.organisation_id = p_org and c.type = 'patient'
      and c.pms_registered_at is not null
      and c.pms_registered_at >= p_since
      and (p_until is null or c.pms_registered_at < p_until)
      and (p_practice is null or c.practice_id = p_practice)
    group by c.practice_id
  ),
  appt as (
    select practice_id,
           count(*) filter (where pms_patient_id is not null)::bigint as total,
           count(*) filter (where pms_patient_id is not null and status = 'completed')::bigint as completed,
           count(*) filter (where pms_patient_id is not null and status = 'no_show')::bigint as no_shows
    from public.appointments
    where organisation_id = p_org
      and starts_at >= p_since
      and (p_until is null or starts_at < p_until)
      and (p_practice is null or practice_id = p_practice)
    group by practice_id
  ),
  pay as (
    select practice_id, coalesce(sum(amount_pence), 0)::bigint as pence
    from public.payments
    where organisation_id = p_org and status = 'settled'
      and processed_at >= p_since
      and (p_until is null or processed_at < p_until)
      and (p_practice is null or practice_id = p_practice)
    group by practice_id
  )
  select pr.id, pr.name,
         coalesce(pat.n, 0),
         coalesce(appt.total, 0),
         coalesce(appt.completed, 0),
         coalesce(appt.no_shows, 0),
         coalesce(pay.pence, 0)
  from pr
  left join pat  on pat.practice_id  = pr.id
  left join appt on appt.practice_id = pr.id
  left join pay  on pay.practice_id  = pr.id
$function$;

-- ---------------------------------------------------------------------------
-- (3) AD-PLATFORM AGGREGATES — replace two reads that PostgREST truncates.
--
-- `.limit(5000)` does NOT lift PostgREST's server-side row ceiling; the server
-- stops at its db-max-rows and says nothing. adLeadsByProvider and
-- adMetricsInWindow both read ad_metrics row-by-row through that ceiling. The
-- live org holds 3,899 ad_metrics rows in a 90-day window and 1,079 in 30 days,
-- so the Business Hub's Leads KPI was summing roughly a quarter of them — and
-- with no ORDER BY, *which* quarter changed between calls. Because the lead
-- count is the DENOMINATOR of the conversion rate, truncation made conversion
-- look BETTER than it is.
--
-- Aggregating in SQL fixes the correctness problem and the load time together:
-- 3,899 rows crossing the wire become one row per provider (or per account).
-- ---------------------------------------------------------------------------
create or replace function public.ad_leads_by_provider(
  p_org uuid, p_from date, p_to date
)
returns table(provider text, conversions numeric, spend_pence bigint)
language sql stable security definer
set search_path = public
as $function$
  select m.provider,
         coalesce(sum(m.conversions), 0)::numeric,
         coalesce(sum(m.spend_pence), 0)::bigint
  from public.ad_metrics m
  where m.organisation_id = p_org
    and m.metric_date >= p_from
    and m.metric_date <= p_to
  group by m.provider;
$function$;

comment on function public.ad_leads_by_provider(uuid, date, date) is
  'Ad-platform conversions + spend summed per provider over an INCLUSIVE day range. Replaces a row-by-row ad_metrics read that PostgREST silently truncated.';

-- Per-account/practice grain, for the Marketing ROI cross-cut which needs to
-- split spend by account and practice and cannot use the provider rollup.
create or replace function public.ad_metrics_rollup(
  p_org uuid, p_from date, p_to date,
  p_practices uuid[] default null, p_accounts text[] default null
)
returns table(provider text, customer_id text, practice_id uuid,
              spend_pence bigint, impressions bigint, clicks bigint,
              reach bigint, conversions numeric)
language sql stable security definer
set search_path = public
as $function$
  select m.provider, m.customer_id, m.practice_id,
         coalesce(sum(m.spend_pence), 0)::bigint,
         coalesce(sum(m.impressions), 0)::bigint,
         coalesce(sum(m.clicks), 0)::bigint,
         coalesce(sum(m.reach), 0)::bigint,
         coalesce(sum(m.conversions), 0)::numeric
  from public.ad_metrics m
  where m.organisation_id = p_org
    and m.metric_date >= p_from
    and m.metric_date <= p_to
    and (p_practices is null or m.practice_id = any(p_practices))
    and (p_accounts  is null or m.customer_id = any(p_accounts))
  group by m.provider, m.customer_id, m.practice_id;
$function$;

comment on function public.ad_metrics_rollup(uuid, date, date, uuid[], text[]) is
  'ad_metrics summed per provider x account x practice over an INCLUSIVE day range. Same truncation fix as ad_leads_by_provider, at the grain Marketing ROI needs.';

revoke all on function public.ad_leads_by_provider(uuid, date, date) from public, anon, authenticated;
revoke all on function public.ad_metrics_rollup(uuid, date, date, uuid[], text[]) from public, anon, authenticated;
grant execute on function public.ad_leads_by_provider(uuid, date, date) to service_role;
grant execute on function public.ad_metrics_rollup(uuid, date, date, uuid[], text[]) to service_role;

-- Covers both new aggregates: org + day range, with the summed columns carried
-- so the grouping never has to visit the heap.
create index if not exists ad_metrics_org_date_rollup_idx
  on public.ad_metrics (organisation_id, metric_date)
  include (provider, customer_id, practice_id, spend_pence, impressions, clicks, reach, conversions);

notify pgrst, 'reload schema';
