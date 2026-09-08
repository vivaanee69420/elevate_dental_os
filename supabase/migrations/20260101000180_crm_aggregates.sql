-- ============================================================================
-- 000180 — Elevate CRM server-side aggregates
--
-- Three CRM screens counted and summed a CAPPED PAGE of rows in the browser,
-- which is the failure already fixed once on CRM Reports and left everywhere
-- else. Measured on live data before this migration:
--
--   Pipeline  `limit: 500`, then summed estimated_value_pence over the page.
--             Pipeline r2preQuq…: 2,092 leads / £1,421,317 rendered as
--             "500 leads · £0.00" — every valued lead sat older than the
--             newest 500. zFc250up…: 1,693 / £1,551,250 rendered £0.00 too.
--             17 of 126 pipelines exceed the cap.
--   Today     `limit: 500`, then "Active leads" = open.length. Read 500
--             against a true 17,285. "Needs follow-up" sorted oldest-first
--             out of the NEWEST 500, so it never showed an actually old lead.
--   Inbox     `.limit(200)` server-side, no paging. 105 of 12,764 threads
--             (0.8%); unread badge read 10 against a true 5,753.
--
-- None of them failed loudly. Each rendered a clean, confident, wrong number.
--
-- Every function here is org-scoped on p_org and takes the organisation from
-- the caller's session, never from a request. plpgsql + RETURN QUERY EXECUTE
-- … USING is deliberate: LANGUAGE sql + SECURITY DEFINER + SET search_path
-- never inlines, so the planner builds a generic plan with p_org unknown and
-- ignores the org indexes (measured at 11.1s vs 55ms elsewhere in this repo).
--
-- Idempotent.
-- ============================================================================

-- Lead statuses that mean the opportunity is finished. Mirrors CLOSED in
-- frontend/features/crm/components/TodayScreen.tsx exactly — the point of this
-- migration is to make the same figure correct, not to quietly redefine it.
-- Note treatment_started is NOT closed: it is work in progress.

-- ----------------------------------------------------------------------------
-- 1. Pipeline board: per-stage counts and value, for one pipeline.
--
-- valued_count exists so the UI can tell "£0 of recorded value" apart from
-- "no value recorded". Only 22.5% of this group's leads carry an
-- estimated_value_pence at all, so a bare £0.00 on the other 77.5% is a
-- fabricated figure — null is not zero.
-- ----------------------------------------------------------------------------
create or replace function public.crm_pipeline_stage_summary(
  p_org uuid,
  p_pipeline text,
  p_account uuid default null
)
returns table (
  stage_id text,
  lead_count bigint,
  valued_count bigint,
  value_pence bigint,
  open_count bigint,
  open_valued_count bigint,
  open_value_pence bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return query execute $q$
    select
      coalesce(l.ghl_pipeline_stage_id, '')::text                              as stage_id,
      count(*)::bigint                                                          as lead_count,
      count(*) filter (where coalesce(l.estimated_value_pence, 0) > 0)::bigint  as valued_count,
      coalesce(sum(l.estimated_value_pence), 0)::bigint                         as value_pence,
      count(*) filter (
        where l.status not in ('not_proceeding', 'treatment_completed', 'failed_to_attend')
      )::bigint                                                                 as open_count,
      count(*) filter (
        where l.status not in ('not_proceeding', 'treatment_completed', 'failed_to_attend')
          and coalesce(l.estimated_value_pence, 0) > 0
      )::bigint                                                                 as open_valued_count,
      coalesce(sum(l.estimated_value_pence) filter (
        where l.status not in ('not_proceeding', 'treatment_completed', 'failed_to_attend')
      ), 0)::bigint                                                             as open_value_pence
    from public.leads l
    where l.organisation_id = $1
      and l.ghl_pipeline_id = $2
      and ($3::uuid is null or l.integration_account_id = $3)
    group by 1
  $q$ using p_org, p_pipeline, p_account;
end;
$fn$;

comment on function public.crm_pipeline_stage_summary(uuid, text, uuid) is
  'Per-stage lead counts and estimated value for one GHL pipeline, org-scoped. '
  'valued_count distinguishes zero value from unrecorded value.';

revoke all on function public.crm_pipeline_stage_summary(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.crm_pipeline_stage_summary(uuid, text, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 2. Today: the four headline counters, in one round trip.
--
-- p_since is the window start the screen already computes (local midnight
-- minus N days). Passed in rather than derived here so the counter and the
-- list below it can never disagree about where the window starts.
-- p_since null = all time ("All time" option).
-- ----------------------------------------------------------------------------
create or replace function public.crm_today_counters(
  p_org uuid,
  p_since timestamptz default null,
  p_account uuid default null
)
returns table (
  new_leads bigint,
  follow_ups bigint,
  active_leads bigint,
  inbound_messages bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return query execute $q$
    with scoped as (
      select l.status, l.created_at
      from public.leads l
      where l.organisation_id = $1
        and ($3::uuid is null or l.integration_account_id = $3)
    ),
    open_leads as (
      select * from scoped
      where status not in ('not_proceeding', 'treatment_completed', 'failed_to_attend')
    )
    select
      (select count(*) from open_leads
        where $2::timestamptz is null or created_at >= $2)::bigint            as new_leads,
      -- Leads awaiting a first move, OLDER than the window. Counted over the
      -- whole population: the screen lists only the oldest 25, but the counter
      -- must say how many there really are.
      (select count(*) from open_leads
        where status in ('new', 'contact_attempted', 'contact_made')
          and $2::timestamptz is not null
          and created_at < $2)::bigint                                        as follow_ups,
      (select count(*) from open_leads)::bigint                               as active_leads,
      (select count(*) from public.communications c
        where c.organisation_id = $1
          and c.direction = 'inbound'
          and ($3::uuid is null or c.integration_account_id = $3)
          and ($2::timestamptz is null or c.created_at >= $2))::bigint        as inbound_messages
  $q$ using p_org, p_since, p_account;
end;
$fn$;

comment on function public.crm_today_counters(uuid, timestamptz, uuid) is
  'Today screen headline counters (new / follow-up / active leads, inbound messages), org-scoped.';

revoke all on function public.crm_today_counters(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.crm_today_counters(uuid, timestamptz, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 3. Inbox: one row per conversation, aggregated in SQL, paged and searchable.
--
-- The thread key mirrors groupIntoThreads() in InboxScreen.tsx exactly:
-- contact_id, else lead_id, else channel + counterparty address. The
-- counterparty is from_address on an inbound message and to_address on an
-- outbound one.
--
-- Search runs HERE rather than in the browser. Searching a filtered page is
-- not a search: it answered "no results" for 99.2% of this group's real
-- conversations, because only 105 of 12,764 threads were ever loaded.
--
-- VISIBILITY. communications carries a per-row `visibility`
-- ('org' | 'role:<role>' | 'user:<uuid>') plus assigned_user_id, and
-- commRepository.list() filters on it. Moving the aggregate into SQL without
-- carrying that filter would WIDEN what a non-owner can see — a security
-- regression smuggled in as a performance fix. Every row is 'org' today, so
-- this changes nothing now and is the whole point: the first restricted
-- message ever written must not become visible to everyone.
-- ----------------------------------------------------------------------------
create or replace function public.crm_inbox_threads(
  p_org uuid,
  p_viewer_role text,
  p_viewer_id uuid,
  p_account uuid default null,
  p_search text default null,
  p_channel text default null,
  p_unread_only boolean default false,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  thread_key text,
  contact_id uuid,
  lead_id uuid,
  channel text,
  counterparty text,
  contact_first_name text,
  contact_last_name text,
  last_at timestamptz,
  last_subject text,
  last_body text,
  message_count bigint,
  unread_count bigint,
  total_threads bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return query execute $q$
    with scoped as (
      select
        c.id, c.contact_id, c.lead_id, c.channel, c.direction, c.subject,
        c.body, c.read_at, c.created_at,
        case when c.direction = 'inbound' then c.from_address else c.to_address end as counterparty,
        case
          when c.contact_id is not null then 'c:' || c.contact_id::text
          when c.lead_id    is not null then 'l:' || c.lead_id::text
          else 'a:' || coalesce(c.channel, '') || ':' ||
               coalesce(case when c.direction = 'inbound' then c.from_address else c.to_address end, '')
        end as thread_key
      from public.communications c
      where c.organisation_id = $1
        and ($4::uuid is null or c.integration_account_id = $4)
        and (
          $2 = 'owner'
          or coalesce(c.visibility, 'org') in ('org', 'role:' || $2, 'user:' || $3::text)
          or c.assigned_user_id = $3
        )
    ),
    grouped as (
      select
        s.thread_key,
        (array_agg(s.contact_id  order by s.created_at desc) filter (where s.contact_id is not null))[1] as contact_id,
        (array_agg(s.lead_id     order by s.created_at desc) filter (where s.lead_id    is not null))[1] as lead_id,
        (array_agg(s.channel     order by s.created_at desc))[1]                                        as channel,
        (array_agg(s.counterparty order by s.created_at desc) filter (where s.counterparty is not null))[1] as counterparty,
        max(s.created_at)                                                                               as last_at,
        (array_agg(s.subject     order by s.created_at desc))[1]                                        as last_subject,
        (array_agg(s.body        order by s.created_at desc))[1]                                        as last_body,
        count(*)::bigint                                                                                as message_count,
        count(*) filter (where s.direction = 'inbound' and s.read_at is null)::bigint                   as unread_count
      from scoped s
      group by s.thread_key
    ),
    named as (
      select g.*, ct.first_name as contact_first_name, ct.last_name as contact_last_name
      from grouped g
      -- Explicit org-scoped join, never a PostgREST embed: an embed resolves
      -- the FK with no org predicate under the service client.
      left join public.contacts ct
        on ct.id = g.contact_id and ct.organisation_id = $1
    ),
    filtered as (
      select * from named n
      where ($6::text is null or n.channel = $6)
        and ($7::boolean is not true or n.unread_count > 0)
        and (
          $5::text is null or $5 = '' or
          coalesce(n.contact_first_name, '') || ' ' || coalesce(n.contact_last_name, '')
            ilike '%' || $5 || '%'
          or coalesce(n.counterparty, '') ilike '%' || $5 || '%'
          or coalesce(n.last_subject, '')  ilike '%' || $5 || '%'
          or coalesce(n.last_body, '')     ilike '%' || $5 || '%'
        )
    )
    select
      f.thread_key, f.contact_id, f.lead_id, f.channel, f.counterparty,
      f.contact_first_name, f.contact_last_name,
      f.last_at, f.last_subject, f.last_body,
      f.message_count, f.unread_count,
      count(*) over ()::bigint as total_threads
    from filtered f
    -- thread_key breaks ties: last_at alone is not unique, and a non-unique
    -- sort key makes OFFSET paging drop and repeat rows between pages.
    order by f.last_at desc, f.thread_key asc
    limit $8 offset $9
  $q$ using p_org, p_viewer_role, p_viewer_id, p_account, p_search, p_channel,
            p_unread_only, p_limit, p_offset;
end;
$fn$;

comment on function public.crm_inbox_threads(uuid, text, uuid, uuid, text, text, boolean, int, int) is
  'Inbox conversation list aggregated in SQL: one row per thread with unread count, '
  'paged, with server-side search, filtered to what the viewer may see. '
  'total_threads is the full match count, not the page.';

revoke all on function public.crm_inbox_threads(uuid, text, uuid, uuid, text, text, boolean, int, int) from public, anon, authenticated;
grant execute on function public.crm_inbox_threads(uuid, text, uuid, uuid, text, text, boolean, int, int) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Inbox totals. Separate from the thread page because the unread badge must
--    count every unread message in the organisation, not the ones on screen.
-- ----------------------------------------------------------------------------
create or replace function public.crm_inbox_summary(
  p_org uuid,
  p_viewer_role text,
  p_viewer_id uuid,
  p_account uuid default null
)
returns table (
  total_messages bigint,
  total_threads bigint,
  unread_messages bigint,
  unread_threads bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return query execute $q$
    with scoped as (
      select
        c.direction, c.read_at,
        case
          when c.contact_id is not null then 'c:' || c.contact_id::text
          when c.lead_id    is not null then 'l:' || c.lead_id::text
          else 'a:' || coalesce(c.channel, '') || ':' ||
               coalesce(case when c.direction = 'inbound' then c.from_address else c.to_address end, '')
        end as thread_key
      from public.communications c
      where c.organisation_id = $1
        and ($4::uuid is null or c.integration_account_id = $4)
        and (
          $2 = 'owner'
          or coalesce(c.visibility, 'org') in ('org', 'role:' || $2, 'user:' || $3::text)
          or c.assigned_user_id = $3
        )
    )
    select
      count(*)::bigint                                                          as total_messages,
      count(distinct thread_key)::bigint                                        as total_threads,
      count(*) filter (where direction = 'inbound' and read_at is null)::bigint as unread_messages,
      count(distinct thread_key) filter (
        where direction = 'inbound' and read_at is null
      )::bigint                                                                 as unread_threads
    from scoped
  $q$ using p_org, p_viewer_role, p_viewer_id, p_account;
end;
$fn$;

comment on function public.crm_inbox_summary(uuid, text, uuid, uuid) is
  'Inbox totals across the organisation, filtered to what the viewer may see: '
  'messages, threads, unread messages, unread threads.';

revoke all on function public.crm_inbox_summary(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_inbox_summary(uuid, text, uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Supporting indexes.
--
-- Deliberately org-leading: every read above filters organisation_id first,
-- which is the tenant boundary on the service-client path.
-- ----------------------------------------------------------------------------
create index if not exists idx_leads_org_pipeline_stage
  on public.leads (organisation_id, ghl_pipeline_id, ghl_pipeline_stage_id);

create index if not exists idx_leads_org_status_created
  on public.leads (organisation_id, status, created_at desc);

create index if not exists idx_communications_org_created
  on public.communications (organisation_id, created_at desc);

create index if not exists idx_communications_org_contact
  on public.communications (organisation_id, contact_id);

notify pgrst, 'reload schema';
