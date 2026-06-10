-- 20260101000073_contacts_pms_registered_at.sql
-- Make "new patients" match Dentally's own report exactly.
--
-- 000072 switched new-patient counting from contacts.created_at (sync insert
-- time) to the patient's first SYNCED appointment. That killed the ~30k
-- over-count, but still over-reports ~3x vs Dentally's report (e.g. 314/mo vs
-- ~93/mo) because our appointment history is incomplete per patient: the sync
-- pulls a bounded appointment window, so a long-standing patient whose only
-- synced visit is recent looks "new". Dentally counts by the patient's real
-- registration date, which we never captured.
--
-- FIX: capture Dentally's patient registration timestamp into a new column
-- contacts.pms_registered_at (populated by the sync from the Dentally patient
-- payload's created_at). A patient is "new" in a window when their anchor date
-- falls in it, where anchor = COALESCE(pms_registered_at, first-ever synced
-- appointment). So:
--   * After a patient re-sync (column backfilled): exact registration date,
--     matches Dentally (~93/mo).
--   * Before backfill / non-Dentally contacts with no registration date:
--     falls back to the 000072 first-appointment proxy (no regression).
-- created_at is never used as an anchor again (it is sync insert time).

alter table public.contacts
  add column if not exists pms_registered_at timestamptz;

comment on column public.contacts.pms_registered_at is
  'Real patient registration timestamp from the source PMS (Dentally patient.created_at). NULL for non-PMS or not-yet-resynced contacts. Anchor for new-patient metrics; NOT contacts.created_at (= our insert/sync time).';

-- ----------------------------------------------------------------------------
-- Count of patients whose anchor date (registration, else first appointment)
-- is in [p_since, p_until]. p_until NULL = open. p_practice NULL = org-wide.
-- ----------------------------------------------------------------------------
create or replace function public.org_new_patients_count(
  p_org uuid,
  p_since timestamptz,
  p_until timestamptz default null,
  p_practice uuid default null
)
returns bigint
language sql stable security definer set search_path = public as $$
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
    and (p_until is null or anchor <= p_until);
$$;

grant execute on function public.org_new_patients_count(uuid, timestamptz, timestamptz, uuid)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Per-practice performance: same anchor (registration, else first appointment)
-- for the `pat` (new_patients) column. appts/completed/no_shows/revenue unchanged.
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
      and kind = 'practice'
      and (p_practice is null or id = p_practice)
  ),
  first_appt as (
    select contact_id, min(starts_at) as first_seen
    from public.appointments
    where organisation_id = p_org and contact_id is not null
    group by contact_id
  ),
  pat as (
    select practice_id, count(*)::bigint as n
    from (
      select c.practice_id,
             coalesce(c.pms_registered_at, fa.first_seen) as anchor
      from public.contacts c
      left join first_appt fa on fa.contact_id = c.id
      where c.organisation_id = p_org and c.type = 'patient'
        and (p_practice is null or c.practice_id = p_practice)
    ) a
    where a.anchor is not null
      and a.anchor >= p_since
      and (p_until is null or a.anchor <= p_until)
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
