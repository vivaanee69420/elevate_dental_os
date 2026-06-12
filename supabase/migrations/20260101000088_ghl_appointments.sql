-- 20260101000088_ghl_appointments.sql
-- GoHighLevel calendar appointments (CRM bookings), stored SEPARATELY from the
-- clinical `appointments` table (which is Dentally-driven, practice_id NOT NULL,
-- analytics keyed on pms_patient_id). Idempotent. After hosted apply run:
--   NOTIFY pgrst, 'reload schema';

create table if not exists public.ghl_appointments (
  id uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  integration_account_id uuid references public.integration_accounts(id) on delete cascade,
  practice_id uuid references public.practices(id),
  contact_id uuid references public.contacts(id),
  ghl_event_id text not null,
  ghl_calendar_id text,
  calendar_name text,
  title text,
  -- normalized status: booked|confirmed|showed|noshow|cancelled|invalid
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organisation_id, ghl_event_id)
);

create index if not exists idx_ghl_appts_org_start on public.ghl_appointments(organisation_id, starts_at);
create index if not exists idx_ghl_appts_account on public.ghl_appointments(integration_account_id);
create index if not exists idx_ghl_appts_practice on public.ghl_appointments(practice_id, starts_at);

-- updated_at trigger (reuses the project-wide set_updated_at() function from 000001_schema.sql)
drop trigger if exists ghl_appointments_updated_at on public.ghl_appointments;
create trigger ghl_appointments_updated_at before update on public.ghl_appointments
  for each row execute function set_updated_at();

-- Aggregate per practice for the GHL dashboard. starts_at-windowed.
create or replace function public.ghl_appointments_aggregate(
  p_org uuid,
  p_since timestamptz,
  p_until timestamptz,
  p_practice uuid default null
)
returns table (
  practice_id uuid,
  appts_total bigint,           -- all-time for this practice bucket
  appts_in_window bigint,       -- starts_at in [since, until)
  appts_upcoming bigint,        -- starts_at >= now()
  appts_showed bigint,          -- showed, in window
  appts_noshow bigint,          -- noshow, in window
  appts_cancelled bigint,       -- cancelled, in window
  appts_booked bigint,          -- booked|confirmed, in window
  appts_by_calendar jsonb       -- {calendar_name: count} in window
)
language sql
stable
security definer
set search_path = public
as $$
  with rows as (
    select practice_id,
           coalesce(calendar_name, 'Unassigned') as calendar_name,
           status, starts_at
    from public.ghl_appointments
    where organisation_id = p_org
      and (p_practice is null or practice_id = p_practice)
  ),
  cal as (
    select practice_id, calendar_name, count(*) filter (where starts_at >= p_since and starts_at < p_until) as cnt
    from rows group by practice_id, calendar_name
  )
  select
    r.practice_id,
    count(*) as appts_total,
    count(*) filter (where r.starts_at >= p_since and r.starts_at < p_until) as appts_in_window,
    count(*) filter (where r.starts_at >= now()) as appts_upcoming,
    count(*) filter (where r.status = 'showed' and r.starts_at >= p_since and r.starts_at < p_until) as appts_showed,
    count(*) filter (where r.status = 'noshow' and r.starts_at >= p_since and r.starts_at < p_until) as appts_noshow,
    count(*) filter (where r.status = 'cancelled' and r.starts_at >= p_since and r.starts_at < p_until) as appts_cancelled,
    count(*) filter (where r.status in ('booked','confirmed') and r.starts_at >= p_since and r.starts_at < p_until) as appts_booked,
    coalesce((select jsonb_object_agg(c.calendar_name, c.cnt) from cal c where c.practice_id is not distinct from r.practice_id and c.cnt > 0), '{}'::jsonb) as appts_by_calendar
  from rows r
  group by r.practice_id;
$$;

grant execute on function public.ghl_appointments_aggregate(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
