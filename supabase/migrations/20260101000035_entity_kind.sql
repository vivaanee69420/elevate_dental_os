-- 000035  Entity kind discriminator + revenue lines (GM Intelligence OS, task T1/T2)
--
-- Academy and Lab become first-class non-clinical entities by reusing the
-- practices table (and therefore monthly_financials.practice_id, scope
-- resolution, and the Xero/CSV import pipeline) via a `kind` discriminator.
-- See GM-INTELLIGENCE-OS-PLAN.md A1.
--
-- Read-path audit (T2, critical): any rollup that ENUMERATES practices must
-- exclude academy/lab or they appear as phantom 0-chair rows / div-by-zero.
-- The only SQL RPC that selects FROM practices is growth_practice_performance;
-- it is re-created below with a kind='practice' filter. The JS repos
-- (analyticsRepository.practicesList/practicesFull, practices.routes list) are
-- filtered in code in the same change set.
--
-- Idempotent; re-applies cleanly on `supabase db reset`.

-- 1. kind discriminator -------------------------------------------------------
alter table public.practices
  add column if not exists kind text not null default 'practice';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'practices_kind_check'
  ) then
    alter table public.practices
      add constraint practices_kind_check check (kind in ('practice','academy','lab'));
  end if;
end $$;

create index if not exists idx_practices_org_kind on public.practices (organisation_id, kind);

-- 2. entity_revenue_lines (academy/lab revenue sub-lines) ---------------------
create table if not exists public.entity_revenue_lines (
  id uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  entity_id uuid not null references public.practices(id) on delete cascade,
  label text not null,
  revenue_pence bigint not null default 0,
  margin_bps integer not null default 0,          -- margin in basis points (e.g. 6200 = 62.0%)
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_entity_revenue_lines_org
  on public.entity_revenue_lines (organisation_id, entity_id);

drop trigger if exists entity_revenue_lines_updated_at on public.entity_revenue_lines;
create trigger entity_revenue_lines_updated_at
  before update on public.entity_revenue_lines
  for each row execute function set_updated_at();

alter table public.entity_revenue_lines enable row level security;

drop policy if exists entity_revenue_lines_rw on public.entity_revenue_lines;
create policy entity_revenue_lines_rw on public.entity_revenue_lines
  using (organisation_id = current_org_id())
  with check (organisation_id = current_org_id());

-- 3. T2 read-path fix: growth_practice_performance excludes non-practice kinds
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
    from public.contacts
    where organisation_id = p_org and type = 'patient'
      and created_at >= p_since
      and (p_until is null or created_at <= p_until)
      and (p_practice is null or practice_id = p_practice)
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
