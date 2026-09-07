-- ============================================================================
-- ghl_dashboard_aggregate — separate OPEN pipeline from decided pipeline.
--
-- `pipeline_value_pence` sums estimated_value_pence over EVERY lead created in
-- the window, whatever its status, and the Business Hub renders it on a card
-- labelled "GHL Pipeline". Measured on the live org for August 2026:
--
--     open   895 leads   £397,500
--     lost   481 leads   £190,000   <- one third of the "pipeline"
--     won     57 leads         £0
--                        --------
--     card said          £587,500
--
-- A third of the pipeline belonged to leads already marked not_proceeding or
-- failed_to_attend. Pipeline means money still in play; money attached to a
-- lead that has said no is not in play.
--
-- `pipeline_value_pence` is LEFT ALONE — some readers legitimately want the
-- total value of everything that came in — and `pipeline_open_value_pence` is
-- added beside it, so the card can name which one it shows. Appended LAST so
-- positional consumers are unaffected.
--
-- DROP/CREATE is required to widen a RETURNS TABLE. Verified first that no
-- other function references this one.
-- ============================================================================

DROP FUNCTION IF EXISTS public.ghl_dashboard_aggregate(uuid, timestamptz, timestamptz, uuid, uuid);

CREATE FUNCTION public.ghl_dashboard_aggregate(
  p_org uuid,
  p_since timestamptz,
  p_until timestamptz,
  p_practice uuid DEFAULT NULL::uuid,
  p_account_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  integration_account_id uuid, practice_id uuid,
  contacts_total bigint, contacts_new bigint, contacts_by_source jsonb,
  leads_total bigint, leads_new bigint, leads_open bigint, leads_won bigint, leads_lost bigint,
  pipeline_value_pence bigint, leads_by_stage jsonb,
  conversations_total bigint, conversations_inbound bigint, conversations_outbound bigint,
  conversations_last7d bigint,
  pipeline_open_value_pence bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      -- total = all contacts up to the end of the period (CUMULATIVE, not the
      -- window's own intake — `new_in` below is the windowed figure)
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
      -- The same money, restricted to leads that have NOT been decided — the
      -- figure a card called "pipeline" is claiming to show.
      coalesce(sum(r.estimated_value_pence) filter (
        where r.status not in (
          'treatment_started', 'treatment_completed', 'not_proceeding', 'failed_to_attend'
        ) and r.created_at >= p_since and r.created_at < p_until), 0) as open_value_pence,
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
    coalesce(m.last7d,      0),
    coalesce(l.open_value_pence, 0)
  from keys k
  left join c on c.integration_account_id is not distinct from k.integration_account_id
  left join l on l.integration_account_id is not distinct from k.integration_account_id
  left join m on m.integration_account_id is not distinct from k.integration_account_id;
$function$;

-- Service-role only, the idiom every p_org RPC here follows: a SECURITY DEFINER
-- function that takes the organisation as a PARAMETER must never be callable by
-- a client that could pass someone else's.
REVOKE ALL ON FUNCTION public.ghl_dashboard_aggregate(uuid, timestamptz, timestamptz, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ghl_dashboard_aggregate(uuid, timestamptz, timestamptz, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.ghl_dashboard_aggregate(uuid, timestamptz, timestamptz, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ghl_dashboard_aggregate(uuid, timestamptz, timestamptz, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
