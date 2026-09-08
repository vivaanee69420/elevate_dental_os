-- ============================================================================
-- 000187 — practitioner schedules: the rota Dentally will not give us
--
-- Utilisation needs available time, and available time comes from the
-- practitioner's working schedule. Dentally holds one. Its API does not expose
-- it — 29 paths probed on 2026-09-08, including every nested form
-- (/practitioners/{id}/availability, /schedule, /schedules, /working_hours,
-- /working_patterns, /sessions) and every plural top-level one
-- (/availabilities, /working_patterns, /sessions, /time_off, /absences,
-- /holidays, /breaks, /diary, /calendar_events). All 404. Dentally support
-- confirmed it: the schedule lives in the calendar and is not published.
--
-- WHY NOT INFER IT FROM THE DIARY. Because it does not hold still. Across 73
-- practitioner-weekday slots with three or more days of history, only 7 had a
-- start time consistent within half an hour and only ONE had a consistent end
-- time; the average scatter is 96 minutes on the start and 131 on the end. A
-- median would look authoritative and be wrong by an hour and a half either
-- way. The observed range is shown BESIDE the input as a sanity check, never
-- written into it.
--
-- SHAPE. Dentally's support describes a weekly pattern that repeats
-- indefinitely (Mon-Fri 09:00-17:00) with per-day overrides for exceptions, so
-- that is what these two tables are. 49 practitioners see patients here across
-- 135 practitioner-weekday slots — most work two or three days — so the whole
-- pattern is roughly 135 rows entered once, not 49 x 7.
--
-- Times are MINUTES FROM LOCAL MIDNIGHT, never timestamps, matching
-- practice_opening_hours from 000184. These are wall-clock working hours; as
-- instants they would shift an hour across the BST boundary and silently
-- change every practitioner's day twice a year.
--
-- Breaks are deducted, because Dentally deducts them: "if breaks are not
-- excluded, your utilisation will appear higher than the Analytics dashboard".
--
-- Idempotent.
-- ============================================================================

-- ── 1. the repeating weekly pattern ─────────────────────────────────────────
create table if not exists public.practitioner_schedules (
  id                  uuid primary key default uuid_generate_v4(),
  organisation_id     uuid not null references public.organisations(id) on delete cascade,
  -- The Dentally practitioner id (appointments.pms_practitioner_id). NOT the
  -- person: Dentally models a practitioner as a person AT A SITE, so someone
  -- working at three practices holds three ids and three schedules, which is
  -- correct — their Tuesday at Ashford is not their Tuesday at Barnet.
  practitioner_id     text not null,
  weekday             smallint not null check (weekday between 1 and 7),   -- ISO Mon..Sun
  start_min           smallint not null check (start_min between 0 and 1440),
  end_min             smallint not null check (end_min   between 0 and 1440),
  break_min           smallint not null default 0 check (break_min >= 0),
  -- Dentally's pattern "runs indefinitely if no end date is set". Same here:
  -- effective_to null means still current.
  effective_from      date not null default current_date,
  effective_to        date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  -- A day cannot both start and end at the same minute, and cannot end before
  -- it starts. Either would make available time zero or negative and the
  -- utilisation for that day meaningless rather than merely wrong.
  constraint practitioner_schedules_span_chk check (end_min > start_min),
  -- Breaks cannot exceed the day they are deducted from.
  constraint practitioner_schedules_break_chk check (break_min < end_min - start_min)
);

-- One live pattern per practitioner per weekday per start date. The partial
-- index is what makes "the current pattern" unambiguous: two open-ended rows
-- for the same weekday would leave the reader to guess which applies.
create unique index if not exists uq_practitioner_schedules_current
  on public.practitioner_schedules (organisation_id, practitioner_id, weekday)
  where effective_to is null;

create index if not exists idx_practitioner_schedules_org
  on public.practitioner_schedules (organisation_id, practitioner_id, weekday);

-- ── 2. per-day overrides ────────────────────────────────────────────────────
create table if not exists public.practitioner_schedule_overrides (
  id                  uuid primary key default uuid_generate_v4(),
  organisation_id     uuid not null references public.organisations(id) on delete cascade,
  practitioner_id     text not null,
  day                 date not null,
  -- A day off is an override with no hours, not a row with zeros: "not
  -- working" and "working zero hours" are the same arithmetic but different
  -- facts, and only one of them belongs in a utilisation denominator.
  not_working         boolean not null default false,
  start_min           smallint check (start_min between 0 and 1440),
  end_min             smallint check (end_min   between 0 and 1440),
  break_min           smallint not null default 0 check (break_min >= 0),
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  constraint practitioner_overrides_shape_chk check (
    (not_working and start_min is null and end_min is null)
    or (not not_working and start_min is not null and end_min is not null and end_min > start_min)
  )
);

create unique index if not exists uq_practitioner_overrides_day
  on public.practitioner_schedule_overrides (organisation_id, practitioner_id, day);

create index if not exists idx_practitioner_overrides_org_day
  on public.practitioner_schedule_overrides (organisation_id, day);

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
-- Enabled with no policies: every read here goes through the service client,
-- which bypasses RLS, and the explicit organisation_id filter in the
-- repository IS the tenant boundary. Enabling it anyway means a future
-- anon/authenticated path cannot read the table by accident.
alter table public.practitioner_schedules            enable row level security;
alter table public.practitioner_schedule_overrides   enable row level security;

-- ── 4. scheduled minutes per practitioner per day ───────────────────────────
--
-- The override wins where one exists; otherwise the weekly pattern in force on
-- that date. Returns nothing for a day the practitioner is not scheduled, so a
-- missing schedule stays distinguishable from a zero-hour one.
create or replace function public.practitioner_scheduled_minutes(
  p_org uuid,
  p_since date,
  p_until date
)
returns table (
  practitioner_id text,
  day date,
  scheduled_min int
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return query execute $q$
    with days as (
      select d::date as day from generate_series($2::date, $3::date, interval '1 day') d
    ),
    -- Every practitioner this org has a pattern OR an override for. A
    -- practitioner with neither simply has no scheduled time, which the
    -- caller reports as "no schedule set" rather than as zero.
    pract as (
      select distinct practitioner_id from public.practitioner_schedules where organisation_id = $1
      union
      select distinct practitioner_id from public.practitioner_schedule_overrides where organisation_id = $1
    ),
    grid as (
      select p.practitioner_id, d.day from pract p cross join days d
    )
    select
      g.practitioner_id,
      g.day,
      case
        when o.id is not null then
          case when o.not_working then 0
               else greatest(o.end_min - o.start_min - o.break_min, 0) end
        when s.id is not null then greatest(s.end_min - s.start_min - s.break_min, 0)
        else null
      end::int as scheduled_min
    from grid g
    left join public.practitioner_schedule_overrides o
      on o.organisation_id = $1
     and o.practitioner_id = g.practitioner_id
     and o.day = g.day
    left join public.practitioner_schedules s
      on s.organisation_id = $1
     and s.practitioner_id = g.practitioner_id
     and s.weekday = extract(isodow from g.day)
     and s.effective_from <= g.day
     and (s.effective_to is null or s.effective_to >= g.day)
    where o.id is not null or s.id is not null
  $q$ using p_org, p_since, p_until;
end;
$fn$;

comment on function public.practitioner_scheduled_minutes(uuid, date, date) is
  'Scheduled working minutes per practitioner per day: the per-day override if '
  'there is one, else the weekly pattern in force, both less breaks. No row '
  'means no schedule has been set, which is not the same as zero hours.';

revoke all on function public.practitioner_scheduled_minutes(uuid, date, date) from public, anon, authenticated;
grant execute on function public.practitioner_scheduled_minutes(uuid, date, date) to service_role;

notify pgrst, 'reload schema';
