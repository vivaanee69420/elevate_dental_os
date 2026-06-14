-- 20260101000093_ghl_dashboard_by_account.sql
-- PROBLEM: ghl_dashboard_aggregate groups data by practice_id. When multiple GHL
-- sub-accounts share the same practice_id (or both are NULL/unmapped), the service
-- layer's byPractice Map only holds ONE row per practice, so all those accounts
-- get the same row — producing repeated / doubled numbers.
--
-- SECOND PROBLEM: contacts_total, leads_total, and conversations_total count ALL
-- rows ever synced (no date filter), so they diverge from the selected period.
--
-- FIX: Re-group everything by integration_account_id. The RPC now returns one row
-- per sub-account. The service no longer needs the byPractice Map lookup hack —
-- it can match rows to accounts by integration_account_id directly.
--
-- The p_practice filter is kept as an additional drill-down. When p_account_id is
-- supplied, rows are still narrowed to that account first.
--
-- All "total" counts are now restricted to the [p_since, p_until) window so they
-- match what GHL shows for the same period.
--
-- Idempotent. After hosted apply run: NOTIFY pgrst, 'reload schema';

drop function if exists public.ghl_dashboard_aggregate(uuid, timestamptz, timestamptz, uuid, uuid);
drop function if exists public.ghl_appointments_aggregate(uuid, timestamptz, timestamptz, uuid, uuid);

-- ============================================================
-- ghl_dashboard_aggregate (v3: group by integration_account_id)
-- ============================================================
create or replace function public.ghl_dashboard_aggregate(
  p_org        uuid,
  p_since      timestamptz,
  p_until      timestamptz,
  p_practice   uuid  default null,
  p_account_id uuid  default null
)
returns table (
  integration_account_id   uuid,
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
    select
      integration_account_id,
      practice_id,
      coalesce(source, 'unknown') as source,
      created_at
    from public.contacts
    where organisation_id = p_org
      and ghl_contact_id is not null
      and (p_account_id is null or integration_account_id = p_account_id)
      and (p_practice is null or practice_id = p_practice)
      and created_at < p_until
  ),
  c as (
    select
      r.integration_account_id,
      -- use the most-common practice_id for this account (or NULL if all NULL)
      (select practice_id
       from c_rows
       where integration_account_id is not distinct from r.integration_account_id
       group by practice_id
       order by count(*) desc
       limit 1
      ) as practice_id,
      -- total = all contacts up to the end of the period
      count(*) filter (where r.created_at < p_until) as total,
      -- new_in = created within the period
      count(*) filter (where r.created_at >= p_since and r.created_at < p_until) as new_in,
      coalesce(
        (select jsonb_object_agg(s.source, s.cnt)
         from (
           select source, count(*) as cnt
           from c_rows
           where created_at >= p_since and created_at < p_until
             and integration_account_id is not distinct from r.integration_account_id
           group by source
         ) s),
        '{}'::jsonb
      ) as by_source
    from c_rows r
    group by r.integration_account_id
  ),
  -- leads: raw rows filtered by org, optional account, optional practice
  l_rows as (
    select
      integration_account_id,
      practice_id,
      coalesce(ghl_stage_name, 'Unstaged') as stage,
      status,
      estimated_value_pence,
      created_at
    from public.leads
    where organisation_id = p_org
      and source = 'gohighlevel'
      and (p_account_id is null or integration_account_id = p_account_id)
      and (p_practice is null or practice_id = p_practice)
      and created_at >= p_since and created_at < p_until
  ),
  l as (
    select
      r.integration_account_id,
      count(*) filter (where r.created_at >= p_since and r.created_at < p_until) as total,
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
             and integration_account_id is not distinct from r.integration_account_id
           group by stage
         ) s),
        '{}'::jsonb
      ) as by_stage
    from l_rows r
    group by r.integration_account_id
  ),
  -- communications: filter by account directly via integration_account_id
  m as (
    select
      cm.integration_account_id,
      count(*) filter (where cm.created_at >= p_since and cm.created_at < p_until) as total,
      count(*) filter (where cm.direction = 'inbound'
        and cm.created_at >= p_since and cm.created_at < p_until) as inbound_cnt,
      count(*) filter (where cm.direction = 'outbound'
        and cm.created_at >= p_since and cm.created_at < p_until) as outbound_cnt,
      count(*) filter (where cm.created_at >= (p_until - interval '7 days')
        and cm.created_at < p_until) as last7d
    from public.communications cm
    where cm.organisation_id = p_org
      and (p_account_id is null or cm.integration_account_id = p_account_id)
      and cm.created_at >= least(p_since, p_until - interval '7 days')
      and cm.created_at < p_until
      -- practice drill-down for comms: join contacts for practice_id filter
      and (p_practice is null or cm.contact_id in (
        select id from public.contacts
        where organisation_id = p_org and practice_id = p_practice
      ))
    group by cm.integration_account_id
  ),
  keys as (
    select integration_account_id from c
    union select integration_account_id from l
    union select integration_account_id from m
  )
  select
    k.integration_account_id,
    coalesce(c.practice_id, null),
    coalesce(c.total,       0), coalesce(c.new_in,    0), coalesce(c.by_source,  '{}'::jsonb),
    coalesce(l.total,       0), coalesce(l.new_in,    0), coalesce(l.open_cnt,   0),
    coalesce(l.won_cnt,     0), coalesce(l.lost_cnt,  0), coalesce(l.value_pence,0),
    coalesce(l.by_stage,    '{}'::jsonb),
    coalesce(m.total,       0), coalesce(m.inbound_cnt,0), coalesce(m.outbound_cnt,0),
    coalesce(m.last7d,      0)
  from keys k
  left join c on c.integration_account_id is not distinct from k.integration_account_id
  left join l on l.integration_account_id is not distinct from k.integration_account_id
  left join m on m.integration_account_id is not distinct from k.integration_account_id;
$$;

grant execute on function public.ghl_dashboard_aggregate(uuid, timestamptz, timestamptz, uuid, uuid)
  to authenticated, service_role;


-- ============================================================
-- ghl_appointments_aggregate (v3: group by integration_account_id)
-- ============================================================
create or replace function public.ghl_appointments_aggregate(
  p_org        uuid,
  p_since      timestamptz,
  p_until      timestamptz,
  p_practice   uuid  default null,
  p_account_id uuid  default null
)
returns table (
  integration_account_id uuid,
  practice_id            uuid,
  appts_total            bigint,
  appts_in_window        bigint,
  appts_upcoming         bigint,
  appts_showed           bigint,
  appts_noshow           bigint,
  appts_cancelled        bigint,
  appts_booked           bigint,
  appts_by_calendar      jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with rows as (
    select
      integration_account_id,
      practice_id,
      coalesce(calendar_name, 'Unassigned') as calendar_name,
      status,
      starts_at
    from public.ghl_appointments
    where organisation_id = p_org
      and (p_account_id is null or integration_account_id = p_account_id)
      and (p_practice is null or practice_id = p_practice)
      and starts_at >= least(p_since, now())
      and starts_at < greatest(p_until, now() + interval '10 years')
  ),
  cal as (
    select integration_account_id, calendar_name,
           count(*) filter (where starts_at >= p_since and starts_at < p_until) as cnt
    from rows group by integration_account_id, calendar_name
  )
  select
    r.integration_account_id,
    -- derive the dominant practice_id for this account
    (select practice_id
     from rows
     where integration_account_id is not distinct from r.integration_account_id
     group by practice_id
     order by count(*) desc
     limit 1
    ) as practice_id,
    -- all-window total
    count(*) filter (where r.starts_at >= p_since and r.starts_at < p_until) as appts_total,
    count(*) filter (where r.starts_at >= p_since and r.starts_at < p_until) as appts_in_window,
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
       where c.integration_account_id is not distinct from r.integration_account_id
         and c.cnt > 0),
      '{}'::jsonb
    ) as appts_by_calendar
  from rows r
  group by r.integration_account_id;
$$;

grant execute on function public.ghl_appointments_aggregate(uuid, timestamptz, timestamptz, uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
