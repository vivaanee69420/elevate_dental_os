-- 20260101000092_ghl_dashboard_account_filter.sql
-- Fixes: when viewing a single GHL sub-account (accountId filter), the dashboard
-- was showing ALL org-wide data instead of just that sub-account's data.
--
-- Root cause: the previous ghl_dashboard_aggregate only accepted p_practice (UUID),
-- but when a sub-account has practice_id = NULL (unmapped), p_practice = NULL means
-- "no filter" in SQL, so every org row was returned.
--
-- Fix: add p_account_id (integration_account_id) as an authoritative account-level
-- filter. When provided, rows are narrowed to that specific integration_account_id,
-- regardless of practice_id. The p_practice filter is kept for practice-level
-- drill-downs (e.g., from the Scope bar) and works alongside p_account_id.
--
-- Both ghl_dashboard_aggregate and ghl_appointments_aggregate are updated.
-- The old 4-argument signatures are dropped first so the new 5-argument versions
-- can be created cleanly (PostgreSQL function overloading would otherwise keep both).
--
-- Idempotent. After hosted apply run: NOTIFY pgrst, 'reload schema';

-- Drop old 4-argument versions so we can replace with 5-argument versions.
drop function if exists public.ghl_dashboard_aggregate(uuid, timestamptz, timestamptz, uuid);
drop function if exists public.ghl_appointments_aggregate(uuid, timestamptz, timestamptz, uuid);

-- ============================================================
-- ghl_dashboard_aggregate (v2: + p_account_id filter)
-- ============================================================
create or replace function public.ghl_dashboard_aggregate(
  p_org       uuid,
  p_since     timestamptz,
  p_until     timestamptz,
  p_practice  uuid    default null,
  p_account_id uuid   default null
)
returns table (
  practice_id              uuid,
  contacts_total           bigint,
  contacts_new             bigint,
  contacts_by_source       jsonb,
  leads_total              bigint,
  leads_new                bigint,
  leads_open               bigint,
  leads_won                bigint,
  leads_lost               bigint,
  pipeline_value_pence     bigint,
  leads_by_stage           jsonb,
  conversations_total      bigint,
  conversations_inbound    bigint,
  conversations_outbound   bigint,
  conversations_last7d     bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with
  -- contacts: raw rows filtered by org, optional account, optional practice
  c_rows as (
    select practice_id,
           coalesce(source, 'unknown') as source,
           created_at
    from public.contacts
    where organisation_id = p_org
      and ghl_contact_id is not null
      -- account-level isolation: when p_account_id given, ONLY that account's rows
      and (p_account_id is null or integration_account_id = p_account_id)
      -- practice drill-down (only applied when no account filter, to avoid double-filtering)
      and (p_account_id is not null or p_practice is null or practice_id = p_practice)
  ),
  c as (
    select
      r.practice_id,
      count(*) as total,
      count(*) filter (where r.created_at >= p_since and r.created_at < p_until) as new_in,
      coalesce(
        (select jsonb_object_agg(s.source, s.cnt)
         from (
           select source, count(*) as cnt
           from c_rows
           where created_at >= p_since and created_at < p_until
             and practice_id is not distinct from r.practice_id
           group by source
         ) s),
        '{}'::jsonb
      ) as by_source
    from c_rows r
    group by r.practice_id
  ),
  -- leads: raw rows filtered by org, optional account, optional practice
  l_rows as (
    select practice_id,
           coalesce(ghl_stage_name, 'Unstaged') as stage,
           status,
           estimated_value_pence,
           created_at
    from public.leads
    where organisation_id = p_org
      and source = 'gohighlevel'
      and (p_account_id is null or integration_account_id = p_account_id)
      and (p_account_id is not null or p_practice is null or practice_id = p_practice)
  ),
  l as (
    select
      r.practice_id,
      count(*) as total,
      count(*) filter (where r.created_at >= p_since and r.created_at < p_until) as new_in,
      count(*) filter (where r.status not in (
        'treatment_started', 'treatment_completed', 'not_proceeding', 'failed_to_attend'
      ) and r.created_at >= p_since and r.created_at < p_until) as open_cnt,
      count(*) filter (where r.status in ('treatment_started', 'treatment_completed')
        and r.created_at >= p_since and r.created_at < p_until) as won_cnt,
      count(*) filter (where r.status in ('not_proceeding', 'failed_to_attend')
        and r.created_at >= p_since and r.created_at < p_until) as lost_cnt,
      coalesce(sum(r.estimated_value_pence) filter (
        where r.created_at >= p_since and r.created_at < p_until), 0) as value_pence,
      coalesce(
        (select jsonb_object_agg(s.stage, s.cnt)
         from (
           select stage, count(*) as cnt
           from l_rows
           where created_at >= p_since and created_at < p_until
             and practice_id is not distinct from r.practice_id
           group by stage
         ) s),
        '{}'::jsonb
      ) as by_stage
    from l_rows r
    group by r.practice_id
  ),
  -- communications: derive practice_id from contacts join; filter by account via
  -- communications.integration_account_id (populated by migration 091).
  m as (
    select
      co.practice_id,
      count(*) as total,
      count(*) filter (where cm.direction = 'inbound'
        and cm.created_at >= p_since and cm.created_at < p_until) as inbound_cnt,
      count(*) filter (where cm.direction = 'outbound'
        and cm.created_at >= p_since and cm.created_at < p_until) as outbound_cnt,
      count(*) filter (where cm.created_at >= (p_until - interval '7 days')
        and cm.created_at < p_until) as last7d
    from public.communications cm
    left join public.contacts co on co.id = cm.contact_id
    where cm.organisation_id = p_org
      and (p_account_id is null or cm.integration_account_id = p_account_id)
      and (p_account_id is not null or p_practice is null or co.practice_id = p_practice)
    group by co.practice_id
  ),
  keys as (
    select practice_id from c
    union select practice_id from l
    union select practice_id from m
  )
  select
    k.practice_id,
    coalesce(c.total,      0), coalesce(c.new_in,    0), coalesce(c.by_source,  '{}'::jsonb),
    coalesce(l.total,      0), coalesce(l.new_in,    0), coalesce(l.open_cnt,   0),
    coalesce(l.won_cnt,    0), coalesce(l.lost_cnt,  0), coalesce(l.value_pence,0),
    coalesce(l.by_stage,   '{}'::jsonb),
    coalesce(m.total,      0), coalesce(m.inbound_cnt,0), coalesce(m.outbound_cnt,0),
    coalesce(m.last7d,     0)
  from keys k
  left join c on c.practice_id is not distinct from k.practice_id
  left join l on l.practice_id is not distinct from k.practice_id
  left join m on m.practice_id is not distinct from k.practice_id;
$$;

grant execute on function public.ghl_dashboard_aggregate(uuid, timestamptz, timestamptz, uuid, uuid)
  to authenticated, service_role;


-- ============================================================
-- ghl_appointments_aggregate (v2: + p_account_id filter)
-- ============================================================
create or replace function public.ghl_appointments_aggregate(
  p_org        uuid,
  p_since      timestamptz,
  p_until      timestamptz,
  p_practice   uuid  default null,
  p_account_id uuid  default null
)
returns table (
  practice_id       uuid,
  appts_total       bigint,
  appts_in_window   bigint,
  appts_upcoming    bigint,
  appts_showed      bigint,
  appts_noshow      bigint,
  appts_cancelled   bigint,
  appts_booked      bigint,
  appts_by_calendar jsonb
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
      and (p_account_id is null or integration_account_id = p_account_id)
      and (p_account_id is not null or p_practice is null or practice_id = p_practice)
  ),
  cal as (
    select practice_id, calendar_name,
           count(*) filter (where starts_at >= p_since and starts_at < p_until) as cnt
    from rows group by practice_id, calendar_name
  )
  select
    r.practice_id,
    count(*) as appts_total,
    count(*) filter (where r.starts_at >= p_since and r.starts_at < p_until)  as appts_in_window,
    count(*) filter (where r.starts_at >= now())                               as appts_upcoming,
    count(*) filter (where r.status = 'showed'
      and r.starts_at >= p_since and r.starts_at < p_until)                   as appts_showed,
    count(*) filter (where r.status = 'noshow'
      and r.starts_at >= p_since and r.starts_at < p_until)                   as appts_noshow,
    count(*) filter (where r.status = 'cancelled'
      and r.starts_at >= p_since and r.starts_at < p_until)                   as appts_cancelled,
    count(*) filter (where r.status in ('booked','confirmed')
      and r.starts_at >= p_since and r.starts_at < p_until)                   as appts_booked,
    coalesce(
      (select jsonb_object_agg(c.calendar_name, c.cnt)
       from cal c
       where c.practice_id is not distinct from r.practice_id and c.cnt > 0),
      '{}'::jsonb
    ) as appts_by_calendar
  from rows r
  group by r.practice_id;
$$;

grant execute on function public.ghl_appointments_aggregate(uuid, timestamptz, timestamptz, uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
