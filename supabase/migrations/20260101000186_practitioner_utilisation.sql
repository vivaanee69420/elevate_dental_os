-- ============================================================================
-- 000186 — practitioner utilisation, per practitioner per day
--
-- Recreates what Dentally's "Practitioner utilisation" view shows, from data we
-- already hold. Dentally's own guidance for rebuilding it:
--
--   available = practitioner working hours from the calendar schedule
--   utilised  = appointments that have a PATIENT attached
--   appointments with no patient (meetings, blocks, holidays) are UNUSED time,
--   not utilisation
--
-- The second and third parts we can do exactly: 100% of this group's Dentally
-- appointments carry a practitioner and a duration, and 80,401 of 118,334 carry
-- a patient. The 37,933 without one are the blocks — nearly a third of the
-- diary — so excluding them is the difference between a real number and a
-- meaningless one.
--
-- THE DENOMINATOR IS DERIVED, AND THAT IS A LIMITATION WORTH STATING.
--
-- Dentally does not expose practitioner rosters. Probed 2026-09-08 against the
-- live API: /practitioners carries no working hours, and ten candidate roster
-- endpoints (/working_hours, /availability, /rotas, /schedules, /duties,
-- /practitioner_schedules, /practitioner_availability, /appointment_slots,
-- /calendars, /practitioner_working_hours) all 404. The one that exists,
-- /appointments/availability, refuses a start_time in the past — it is a
-- booking slot-finder, so it cannot answer "what were they rostered for last
-- Tuesday".
--
-- So available time is the practitioner's own booked DAY SPAN: first
-- appointment start to last appointment end, of any kind. Measured over the
-- first week of September, the mean span is 7.9 HOURS — a working day — which
-- is what justifies the proxy. It is still a proxy: a clinician whose first
-- patient is at 10:00 on a 09:00 shift has that hour counted as neither used
-- nor available, so their utilisation reads slightly high.
--
-- A day with no appointments at all yields NO ROW. That is the "practitioner
-- unavailable" state, and it must stay distinct from 0% — a clinician who was
-- not working is not a clinician who sat idle.
--
-- Utilisation can legitimately exceed 100%: overlapping or overrunning
-- appointments are real, and Dentally's own chart carries a ">100%" band.
--
-- Idempotent.
-- ============================================================================

create or replace function public.practitioner_utilisation_daily(
  p_org uuid,
  p_since date,
  p_until date,
  p_practice uuid default null
)
returns table (
  practitioner_id text,
  practitioner_name text,
  practice_id uuid,
  day date,
  available_secs bigint,
  utilised_secs bigint,
  patient_appts bigint,
  block_appts bigint,
  revenue_pence bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return query execute $q$
    with day_rows as (
      select
        a.pms_practitioner_id                                   as practitioner_id,
        -- London dates throughout. `starts_at` is an instant; bucketing it in
        -- UTC would put an 00:30 BST appointment on the previous day.
        (a.starts_at at time zone 'Europe/London')::date         as day,
        -- (array_agg(...))[1], not min(): Postgres has no min(uuid). A
        -- practitioner-day sits at one practice, so the first non-null is it.
        (array_agg(a.practice_id) filter (where a.practice_id is not null))[1] as practice_id,
        min(a.starts_at)                                         as first_start,
        max(a.ends_at)                                           as last_end,
        coalesce(sum(extract(epoch from (a.ends_at - a.starts_at))
          ) filter (where a.pms_patient_id is not null), 0)::bigint as utilised_secs,
        count(*) filter (where a.pms_patient_id is not null)::bigint as patient_appts,
        count(*) filter (where a.pms_patient_id is null)::bigint     as block_appts
      from public.appointments a
      where a.organisation_id = $1
        and a.source = 'dentally'
        and a.pms_practitioner_id is not null
        -- A zero or negative duration cannot contribute time. Keeping them
        -- would let a bad row inflate the count of appointments while adding
        -- nothing to either side of the ratio.
        and a.ends_at > a.starts_at
        and (a.starts_at at time zone 'Europe/London')::date >= $2
        and (a.starts_at at time zone 'Europe/London')::date <= $3
        and ($4::uuid is null or a.practice_id = $4)
      group by 1, 2
    ),
    -- Fees invoiced by that practitioner on that day. 96.1% of this group's
    -- invoice items carry a practitioner. LEFT JOINed, so a day with no
    -- invoicing keeps its utilisation row and simply reports no revenue —
    -- never a zero that looks like "earned nothing".
    fees as (
      select
        ii.pms_practitioner_id as practitioner_id,
        ii.invoiced_on         as day,
        sum(ii.fee_pence)::bigint as revenue_pence
      from public.invoice_items ii
      where ii.organisation_id = $1
        and ii.pms_practitioner_id is not null
        and ii.invoiced_on >= $2 and ii.invoiced_on <= $3
        and ($4::uuid is null or ii.practice_id = $4)
      group by 1, 2
    )
    select
      d.practitioner_id::text,
      -- The clinician's name, or their PMS id when they are not in associates.
      -- Never blank: an unnamed row is unreadable in a per-practitioner grid.
      coalesce(nullif(btrim(s.full_name), ''), 'Practitioner ' || d.practitioner_id)::text,
      d.practice_id,
      d.day,
      greatest(extract(epoch from (d.last_end - d.first_start)), 0)::bigint as available_secs,
      d.utilised_secs,
      d.patient_appts,
      d.block_appts,
      f.revenue_pence
    from day_rows d
    -- Explicit org-scoped join, never a PostgREST embed: an embed resolves the
    -- FK with no org predicate under the service client.
    left join public.associates s
      on s.organisation_id = $1 and s.pms_external_id = d.practitioner_id
    left join fees f
      on f.practitioner_id = d.practitioner_id and f.day = d.day
    order by d.day, 2
  $q$ using p_org, p_since, p_until, p_practice;
end;
$fn$;

comment on function public.practitioner_utilisation_daily(uuid, date, date, uuid) is
  'Per practitioner per London day: available seconds (booked day span), utilised '
  'seconds (patient appointments only), appointment counts and fees invoiced. '
  'No row = the practitioner was not working that day, which is not 0%.';

revoke all on function public.practitioner_utilisation_daily(uuid, date, date, uuid) from public, anon, authenticated;
grant execute on function public.practitioner_utilisation_daily(uuid, date, date, uuid) to service_role;

-- The group-by walks org + practitioner + day; this is the covering shape.
create index if not exists idx_appointments_org_practitioner_starts
  on public.appointments (organisation_id, pms_practitioner_id, starts_at);

create index if not exists idx_invoice_items_org_practitioner_invoiced
  on public.invoice_items (organisation_id, pms_practitioner_id, invoiced_on);

notify pgrst, 'reload schema';
