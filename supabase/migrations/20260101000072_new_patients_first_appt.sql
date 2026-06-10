-- 20260101000072_new_patients_first_appt.sql
-- Fix inflated "new patient" counts.
--
-- BUG: new-patient metrics counted contacts whose contacts.created_at fell in
-- the window. But contacts.created_at is the Dentally SYNC insert time (every
-- patient row is written when a sync runs), NOT the patient's registration
-- date. So "new patients in the last 30 days" returned the ENTIRE patient base
-- whenever a sync ran in that window (~30k instead of ~300 for a real group).
--
-- FIX: a patient is "new" in a window when their FIRST-EVER appointment
-- (MIN starts_at) falls in that window. This is the same honest proxy already
-- used by health_patient_actuals (registration date is not synced, so the
-- first-ever visit is the best available signal). Patient identity keys on the
-- linked contact_id, falling back to the raw Dentally pms_patient_id so a visit
-- with no CRM contact still counts once.
--
-- Both functions are STABLE pure reads, org-scoped by p_org, idempotent
-- (CREATE OR REPLACE).

-- ----------------------------------------------------------------------------
-- Count of patients whose first-ever appointment is in [p_since, p_until].
-- p_until NULL = open upper bound. p_practice NULL = org-wide; otherwise scoped
-- to that practice (first-ever appointment AT THAT PRACTICE). Backs
-- /growth/patients and /growth/marketing/roi (which has an optional practice scope).
-- ----------------------------------------------------------------------------
create or replace function public.org_new_patients_count(
  p_org uuid,
  p_since timestamptz,
  p_until timestamptz default null,
  p_practice uuid default null
)
returns bigint
language sql stable security definer set search_path = public as $$
  select count(*)::bigint
  from (
    select coalesce('c:' || contact_id::text, 'p:' || pms_patient_id::text) as pid,
           min(starts_at) as first_seen
    from public.appointments
    where organisation_id = p_org
      and (contact_id is not null or pms_patient_id is not null)
      and (p_practice is null or practice_id = p_practice)
    group by 1
  ) f
  where f.first_seen >= p_since
    and (p_until is null or f.first_seen <= p_until);
$$;

grant execute on function public.org_new_patients_count(uuid, timestamptz, timestamptz, uuid)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Per-practice performance: identical to 000035 EXCEPT the `pat` CTE now counts
-- patients whose first-ever appointment AT THAT PRACTICE lands in the window,
-- instead of contacts.created_at (sync time).
-- ----------------------------------------------------------------------------
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
      and kind = 'practice'                         -- T2: exclude academy/lab
      and (p_practice is null or id = p_practice)
  ),
  pat as (
    select practice_id, count(*)::bigint as n
    from (
      select practice_id,
             coalesce('c:' || contact_id::text, 'p:' || pms_patient_id::text) as pid,
             min(starts_at) as first_seen
      from public.appointments
      where organisation_id = p_org
        and (contact_id is not null or pms_patient_id is not null)
        and (p_practice is null or practice_id = p_practice)
      group by practice_id, 2
    ) f
    where f.first_seen >= p_since
      and (p_until is null or f.first_seen <= p_until)
    group by practice_id
  ),
  appt as (
    select practice_id,
           count(*)::bigint as total,
           count(*) filter (where status = 'completed')::bigint as completed,
           count(*) filter (where status = 'no_show')::bigint as no_shows
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
