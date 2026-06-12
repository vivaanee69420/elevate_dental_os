-- 20260101000087_ghl_dashboard_rpc.sql
-- Live aggregate for the GHL CRM dashboard. Groups GHL-sourced contacts, leads
-- (opportunities), and conversations (communications) by practice_id for an org
-- over a [since, until) window. One row per practice bucket; the caller sums for
-- totals and uses rows for the per-subaccount breakdown. Money stays in pence.
-- Idempotent. Depends on 000085_integration_accounts. After hosted apply run:
--   NOTIFY pgrst, 'reload schema';
--
-- DEVIATIONS FROM ORIGINAL PLAN (verified against actual schema):
--
-- 1. communications has NO practice_id column (only organisation_id, contact_id,
--    lead_id). The m CTE derives practice_id by LEFT JOINing to contacts on
--    contact_id. Rows where contact_id IS NULL (org-level comms, no contact link)
--    are bucketed under practice_id = NULL (same as unmapped contacts/leads).
--
-- 2. leads.status value vocabulary does NOT include 'won'/'lost'. The actual
--    CHECK constraint is:
--      'new', 'contact_attempted', 'contact_made', 'consultation_booked',
--      'consultation_attended', 'treatment_started', 'treatment_completed',
--      'not_proceeding', 'failed_to_attend'
--    The GHL sync (gohighlevel-sync.js mapStage) maps:
--      won  -> 'treatment_started'  (regex: won|treatment start|started|sold)
--      lost -> 'not_proceeding'     (regex: lost|dead|not proceed|unqualified|abandoned)
--    Therefore:
--      leads_won  uses: status IN ('treatment_started', 'treatment_completed')
--      leads_lost uses: status IN ('not_proceeding', 'failed_to_attend')
--      leads_open uses: status NOT IN the above four values
--    Downstream service code MUST use the same status sets.
--
-- 3. direction column EXISTS on communications with check ('inbound','outbound').
--    No change needed there.

create or replace function public.ghl_dashboard_aggregate(
  p_org uuid,
  p_since timestamptz,
  p_until timestamptz,
  p_practice uuid default null
)
returns table (
  practice_id uuid,
  contacts_total bigint,
  contacts_new bigint,
  contacts_by_source jsonb,
  leads_total bigint,
  leads_new bigint,
  leads_open bigint,
  leads_won bigint,
  leads_lost bigint,
  pipeline_value_pence bigint,
  leads_by_stage jsonb,
  conversations_total bigint,
  conversations_inbound bigint,
  conversations_outbound bigint,
  conversations_last7d bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with
  -- contacts: raw rows first, then pre-group per (practice_id, source)
  c_rows as (
    select practice_id,
           coalesce(source, 'unknown') as source,
           created_at
    from public.contacts
    where organisation_id = p_org
      and ghl_contact_id is not null
      and (p_practice is null or practice_id = p_practice)
  ),
  c_src as (
    -- genuinely distinct (practice_id, source) counts — no window-function trick
    select practice_id, source, count(*) as cnt
    from c_rows
    group by practice_id, source
  ),
  c as (
    select
      r.practice_id,
      count(*) as total,
      count(*) filter (where r.created_at >= p_since and r.created_at < p_until) as new_in,
      coalesce(
        (select jsonb_object_agg(s.source, s.cnt)
         from c_src s
         where s.practice_id is not distinct from r.practice_id),
        '{}'::jsonb
      ) as by_source
    from c_rows r
    group by r.practice_id
  ),
  -- leads: raw rows first, then pre-group per (practice_id, stage)
  l_rows as (
    select practice_id,
           coalesce(ghl_stage_name, 'Unstaged') as stage,
           status,
           estimated_value_pence,
           created_at
    from public.leads
    where organisation_id = p_org
      and source = 'gohighlevel'
      and (p_practice is null or practice_id = p_practice)
  ),
  l_stage as (
    -- genuinely distinct (practice_id, stage) counts
    select practice_id, stage, count(*) as cnt
    from l_rows
    group by practice_id, stage
  ),
  l as (
    select
      r.practice_id,
      count(*) as total,
      count(*) filter (where r.created_at >= p_since and r.created_at < p_until) as new_in,
      -- open = none of the terminal won/lost statuses
      count(*) filter (where r.status not in (
        'treatment_started', 'treatment_completed', 'not_proceeding', 'failed_to_attend'
      )) as open_cnt,
      -- won = treatment underway or completed
      count(*) filter (where r.status in ('treatment_started', 'treatment_completed')) as won_cnt,
      -- lost = not proceeding or failed to attend
      count(*) filter (where r.status in ('not_proceeding', 'failed_to_attend')) as lost_cnt,
      coalesce(sum(r.estimated_value_pence), 0) as value_pence,
      coalesce(
        (select jsonb_object_agg(s.stage, s.cnt)
         from l_stage s
         where s.practice_id is not distinct from r.practice_id),
        '{}'::jsonb
      ) as by_stage
    from l_rows r
    group by r.practice_id
  ),
  -- communications has no practice_id; derive it by joining to contacts.
  -- Rows with no contact_id fall into practice_id = NULL (unmapped bucket).
  m as (
    select
      co.practice_id,
      count(*) as total,
      count(*) filter (where cm.direction = 'inbound') as inbound_cnt,
      count(*) filter (where cm.direction = 'outbound') as outbound_cnt,
      count(*) filter (where cm.created_at >= (p_until - interval '7 days')) as last7d
    from public.communications cm
    left join public.contacts co on co.id = cm.contact_id
    where cm.organisation_id = p_org
      and (p_practice is null or co.practice_id = p_practice)
    group by co.practice_id
  ),
  keys as (
    select practice_id from c
    union select practice_id from l
    union select practice_id from m
  )
  select
    k.practice_id,
    coalesce(c.total, 0), coalesce(c.new_in, 0), coalesce(c.by_source, '{}'::jsonb),
    coalesce(l.total, 0), coalesce(l.new_in, 0), coalesce(l.open_cnt, 0),
    coalesce(l.won_cnt, 0), coalesce(l.lost_cnt, 0), coalesce(l.value_pence, 0),
    coalesce(l.by_stage, '{}'::jsonb),
    coalesce(m.total, 0), coalesce(m.inbound_cnt, 0), coalesce(m.outbound_cnt, 0),
    coalesce(m.last7d, 0)
  from keys k
  left join c on c.practice_id is not distinct from k.practice_id
  left join l on l.practice_id is not distinct from k.practice_id
  left join m on m.practice_id is not distinct from k.practice_id;
$$;

grant execute on function public.ghl_dashboard_aggregate(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
