-- 20260101000079_growth_perf_match_hub.sql
-- Make growth_practice_performance count new patients + appointments with the
-- SAME logic as the Business Hub (GET /api/analytics/business-hub), so the
-- Practices & Patients page matches the Group Overview.
--
-- Two fixes vs 000073:
--   1. NEW PATIENTS — drop the COALESCE(pms_registered_at, first-appointment)
--      fallback. The first-appointment proxy over-reports ~3x (our synced
--      appointment window is bounded, so a long-standing patient with one recent
--      synced visit looks "new"). The Hub counts ONLY pms_registered_at (real
--      Dentally registration) via org_new_patients_registered_by_practice
--      (000077); mirror that here. Non-PMS / not-yet-resynced contacts (NULL
--      pms_registered_at) are correctly excluded — they have no real reg date.
--   2. APPOINTMENTS — filter to pms_patient_id is not null. The Hub's
--      appointments_rollup_by_practice (000076) excludes patient-less rows
--      (diary blocks: lunch / not-working / nurse-cover, ~139/mo) so the count
--      matches Dentally's "With patients" figure. completed / no_shows are
--      likewise scoped to patient-present rows.
-- Revenue (settled payments) unchanged.

create or replace function public.growth_practice_performance(
  p_org uuid,
  p_since timestamptz,
  p_until timestamptz default null,
  p_practice uuid default null
)
returns table(
  practice_id uuid,
  name text,
  new_patients bigint,
  appts bigint,
  completed bigint,
  no_shows bigint,
  revenue_pence bigint
)
language sql stable security definer set search_path = public as $$
  with pr as (
    select id, name from public.practices
    where organisation_id = p_org
      and kind = 'practice'
      and (p_practice is null or id = p_practice)
  ),
  -- New patients = real Dentally registration date only (matches the Hub).
  pat as (
    select c.practice_id, count(*)::bigint as n
    from public.contacts c
    where c.organisation_id = p_org and c.type = 'patient'
      and c.pms_registered_at is not null
      and c.pms_registered_at >= p_since
      and (p_until is null or c.pms_registered_at <= p_until)
      and (p_practice is null or c.practice_id = p_practice)
    group by c.practice_id
  ),
  -- Appointments = patient-present rows only (drops diary blocks; matches Hub).
  appt as (
    select practice_id,
           count(*) filter (where pms_patient_id is not null)::bigint as total,
           count(*) filter (where pms_patient_id is not null and status = 'completed')::bigint as completed,
           count(*) filter (where pms_patient_id is not null and status = 'no_show')::bigint as no_shows
    from public.appointments
    where organisation_id = p_org
      and starts_at >= p_since
      and (p_until is null or starts_at <= p_until)
      and (p_practice is null or practice_id = p_practice)
    group by practice_id
  ),
  pay as (
    select practice_id, coalesce(sum(amount_pence), 0)::bigint as pence
    from public.payments
    where organisation_id = p_org and status = 'settled'
      and processed_at >= p_since
      and (p_until is null or processed_at <= p_until)
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
$$;

-- PostgREST schema cache goes stale after DDL (recurring gotcha).
notify pgrst, 'reload schema';
