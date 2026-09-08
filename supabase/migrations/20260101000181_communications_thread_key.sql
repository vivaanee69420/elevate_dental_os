-- ============================================================================
-- 000181 — communications.thread_key, stored and indexed
--
-- 000180 made the Inbox correct (105 of 12,764 threads became 12,768, and an
-- unread badge of 10 became a true 5,753). It also made it SLOW: one page cost
-- 1,525 ms, and the same cost fell on every search and every page click.
--
-- The plan named the reason. The thread key is COMPUTED — a CASE over
-- contact_id / lead_id / channel+address — so grouping by it sorts all 169,224
-- of the organisation's messages on an expression no index can satisfy:
--
--     Sort Method: external merge  Disk: 13368kB
--     ->  Seq Scan on communications (actual rows=169224)
--
-- Narrowing the sorted columns took it to 1,046 ms and it still spilled. The
-- expression is the problem, not the payload.
--
-- So store the key. It is a pure function of columns already on the row
-- (immutable: CASE, ||, coalesce over plain column references), which is what
-- makes GENERATED ALWAYS ... STORED safe here — Postgres maintains it on every
-- insert and update, so it can never drift from the columns it is derived
-- from, the way a trigger-maintained or application-maintained copy could.
--
-- It must stay byte-identical to the expression in 000180's functions and to
-- groupIntoThreads() in InboxScreen.tsx. Those three agreeing is what makes a
-- thread the same thread everywhere, so a test asserts the SQL definition
-- against the RPCs rather than trusting that three copies stayed in step.
--
-- COST: adding a stored generated column rewrites the table and takes an
-- ACCESS EXCLUSIVE lock for the duration. 177,510 rows, so seconds, not
-- minutes — but it is a write lock on the Inbox's table, not a free change.
--
-- Idempotent.
-- ============================================================================

alter table public.communications
  add column if not exists thread_key text
  generated always as (
    case
      when contact_id is not null then 'c:' || contact_id::text
      when lead_id    is not null then 'l:' || lead_id::text
      else 'a:' || coalesce(channel, '') || ':' ||
           coalesce(case when direction = 'inbound' then from_address else to_address end, '')
    end
  ) stored;

comment on column public.communications.thread_key is
  'Conversation identity: contact, else lead, else channel + counterparty address. '
  'Generated, so it cannot drift from the columns it derives from. Must stay '
  'identical to the expression in crm_inbox_threads/crm_inbox_summary and to '
  'groupIntoThreads() in the Inbox screen.';

-- The index the aggregate wants: org first (the tenant boundary), then the
-- group key, then the sort within each group. With this, grouping is an
-- ordered index scan and the external merge disappears.
create index if not exists idx_communications_org_thread_created
  on public.communications (organisation_id, thread_key, created_at desc);

-- Unread is a small, highly selective slice of a large table (5,753 of
-- 169,224 here), so a partial index keeps the badge cheap as history grows.
create index if not exists idx_communications_org_unread
  on public.communications (organisation_id, thread_key)
  where direction = 'inbound' and read_at is null;

notify pgrst, 'reload schema';

-- ============================================================================
-- Rebuild the two Inbox functions on the stored key.
--
-- 000180's versions compute the key inline, so they cannot use the index above
-- and still spill to disk. Measured on GM Dental Group (169,224 messages,
-- 12,768 threads), one 50-thread page:
--
--   000180, inline key + array_agg per group ......... 1,525 ms
--   narrow columns, still grouping on the expression . 1,046 ms
--   stored key, aggregate + LATERAL for the page .....   135 ms
--
-- The shape that wins does the heavy grouping on NARROW indexed columns only,
-- pages that down to 50 threads, and only then fetches each thread's latest
-- message and unread count by index. Every per-page lookup is an index scan.
--
-- TWO DELIBERATE CHANGES OF MEANING, both stated rather than smuggled:
--
--  1. The channel chip now matches a conversation that HAS messages on that
--     channel, not one whose newest message is on it. Filtering on the newest
--     message needs the LATERAL before the page, which costs 1,464 ms — and
--     "show me SMS conversations" is better served by the broader reading
--     anyway.
--  2. Search now looks at EVERY message in a conversation, plus the contact's
--     name and the counterparty address. The old browser-side search saw only
--     the last message's snippet — of the 105 threads it had loaded.
-- ============================================================================

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
    with stats as (
      select c.thread_key,
             max(c.created_at)  as last_at,
             count(*)::bigint   as message_count
      from public.communications c
      where c.organisation_id = $1
        and ($4::uuid is null or c.integration_account_id = $4)
        and (
          $2 = 'owner'
          or coalesce(c.visibility, 'org') in ('org', 'role:' || $2, 'user:' || $3::text)
          or c.assigned_user_id = $3
        )
      group by c.thread_key
    ),
    matched as (
      select s.* from stats s
      where ($7::boolean is not true or exists (
              select 1 from public.communications u
              where u.organisation_id = $1 and u.thread_key = s.thread_key
                and u.direction = 'inbound' and u.read_at is null))
        and ($6::text is null or exists (
              select 1 from public.communications h
              where h.organisation_id = $1 and h.thread_key = s.thread_key
                and h.channel = $6))
        and ($5::text is null or $5 = ''
             or exists (
               select 1 from public.communications m
               where m.organisation_id = $1 and m.thread_key = s.thread_key
                 and (m.subject ilike '%' || $5 || '%'
                   or m.body    ilike '%' || $5 || '%'
                   or m.from_address ilike '%' || $5 || '%'
                   or m.to_address   ilike '%' || $5 || '%'))
             or exists (
               select 1 from public.contacts ct2
               where ct2.organisation_id = $1
                 and 'c:' || ct2.id::text = s.thread_key
                 and (coalesce(ct2.first_name, '') || ' ' || coalesce(ct2.last_name, ''))
                     ilike '%' || $5 || '%'))
    ),
    paged as (
      select m.*, count(*) over ()::bigint as total_threads
      from matched m
      -- thread_key breaks ties: last_at alone is not unique, and a non-unique
      -- sort key makes OFFSET paging drop and repeat rows between pages.
      order by m.last_at desc, m.thread_key asc
      limit $8 offset $9
    )
    select
      p.thread_key, l.contact_id, l.lead_id, l.channel, l.counterparty,
      ct.first_name, ct.last_name, p.last_at, l.subject, l.body,
      p.message_count,
      (select count(*)::bigint from public.communications u
        where u.organisation_id = $1 and u.thread_key = p.thread_key
          and u.direction = 'inbound' and u.read_at is null) as unread_count,
      p.total_threads
    from paged p
    cross join lateral (
      select c.contact_id, c.lead_id, c.channel, c.subject, c.body,
             case when c.direction = 'inbound' then c.from_address else c.to_address end as counterparty
      from public.communications c
      where c.organisation_id = $1 and c.thread_key = p.thread_key
      order by c.created_at desc
      limit 1
    ) l
    -- Explicit org-scoped join, never a PostgREST embed: an embed resolves the
    -- FK with no org predicate under the service client.
    left join public.contacts ct
      on ct.id = l.contact_id and ct.organisation_id = $1
    order by p.last_at desc, p.thread_key asc
  $q$ using p_org, p_viewer_role, p_viewer_id, p_account, p_search, p_channel,
            p_unread_only, p_limit, p_offset;
end;
$fn$;

revoke all on function public.crm_inbox_threads(uuid, text, uuid, uuid, text, text, boolean, int, int) from public, anon, authenticated;
grant execute on function public.crm_inbox_threads(uuid, text, uuid, uuid, text, text, boolean, int, int) to service_role;

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
    select
      count(*)::bigint                                                            as total_messages,
      count(distinct c.thread_key)::bigint                                        as total_threads,
      count(*) filter (where c.direction = 'inbound' and c.read_at is null)::bigint as unread_messages,
      count(distinct c.thread_key) filter (
        where c.direction = 'inbound' and c.read_at is null
      )::bigint                                                                   as unread_threads
    from public.communications c
    where c.organisation_id = $1
      and ($4::uuid is null or c.integration_account_id = $4)
      and (
        $2 = 'owner'
        or coalesce(c.visibility, 'org') in ('org', 'role:' || $2, 'user:' || $3::text)
        or c.assigned_user_id = $3
      )
  $q$ using p_org, p_viewer_role, p_viewer_id, p_account;
end;
$fn$;

revoke all on function public.crm_inbox_summary(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_inbox_summary(uuid, text, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
