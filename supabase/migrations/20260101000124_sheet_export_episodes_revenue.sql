-- Living-sheet upgrade for the conversion export:
--   1. EPISODES — a patient who enquires again (new GHL lead after their last
--      exported conversion) and then books another appointment gets a SECOND
--      row: unique key becomes (org, contact, episode). episode_lead_at
--      records the re-enquiry lead's created_at so the matcher scopes that
--      row's journey/incoming-date to the new enquiry, not the original one.
--   2. REVENUE — one RPC returning both views for a contact since a moment:
--      invoiced (invoices.amount_pence by dated_on) and collected (settled
--      payments by processed_at/created_at).

alter table public.sheet_export_queue
  add column if not exists episode int not null default 1;
alter table public.sheet_export_queue
  add column if not exists episode_lead_at timestamptz;

drop index if exists sheet_export_queue_org_contact;
create unique index if not exists sheet_export_queue_org_contact_episode
  on public.sheet_export_queue(organisation_id, contact_id, episode);

-- Enqueue: episode-1 rows (first-ever non-cancelled appointment created at/after
-- p_since, go-forward-only) PLUS re-enquiry episodes (new pipeline lead created
-- after the last exported conversion, followed by a newly created appointment).
create or replace function public.sheet_export_enqueue(p_org uuid, p_since timestamptz)
returns integer
language sql
security definer
set search_path = public as $$
  with firsts as (
    select distinct on (a.contact_id)
           a.contact_id, a.id as appointment_id, a.practice_id, a.starts_at
    from public.appointments a
    where a.organisation_id = p_org
      and a.contact_id is not null
      and a.status <> 'cancelled'
      and a.created_at >= p_since
    order by a.contact_id, a.starts_at asc
  ), ins as (
    insert into public.sheet_export_queue
      (organisation_id, practice_id, contact_id, appointment_id, appointment_starts_at, episode)
    select p_org, f.practice_id, f.contact_id, f.appointment_id, f.starts_at, 1
    from firsts f
    join public.contacts c on c.id = f.contact_id and c.organisation_id = p_org
    where c.pms_external_id is not null
      and not exists (
        select 1 from public.appointments prior
        where prior.organisation_id = p_org
          and prior.contact_id = f.contact_id
          and prior.status <> 'cancelled'
          and prior.created_at < p_since)
    on conflict (organisation_id, contact_id, episode) do nothing
    returning 1
  ), last_conversions as (
    select q.contact_id,
           max(q.episode) as last_episode,
           max(q.exported_at) as last_exported_at
    from public.sheet_export_queue q
    where q.organisation_id = p_org and q.status = 'exported'
    group by q.contact_id
  ), re_ins as (
    insert into public.sheet_export_queue
      (organisation_id, practice_id, contact_id, appointment_id, appointment_starts_at, episode, episode_lead_at)
    select p_org, a.practice_id, r.contact_id, a.id, a.starts_at, r.last_episode + 1, nl.created_at
    from last_conversions r
    join lateral (
      select l.created_at from public.leads l
      where l.organisation_id = p_org and l.contact_id = r.contact_id
        and l.ghl_pipeline_id is not null and l.created_at > r.last_exported_at
      order by l.created_at asc limit 1
    ) nl on true
    join lateral (
      select a2.id, a2.practice_id, a2.starts_at from public.appointments a2
      where a2.organisation_id = p_org and a2.contact_id = r.contact_id
        and a2.status <> 'cancelled' and a2.created_at > nl.created_at
      order by a2.created_at asc limit 1
    ) a on true
    -- Only one open (not-yet-exported) episode per contact at a time.
    where not exists (
      select 1 from public.sheet_export_queue q2
      where q2.organisation_id = p_org and q2.contact_id = r.contact_id
        and q2.episode > r.last_episode)
    on conflict (organisation_id, contact_id, episode) do nothing
    returning 1
  )
  select (select count(*)::int from ins) + (select count(*)::int from re_ins);
$$;

-- Both revenue views for one contact since a moment, in one round trip.
create or replace function public.sheet_export_revenue(p_org uuid, p_contact uuid, p_since timestamptz)
returns table (invoiced_pence bigint, collected_pence bigint)
language sql
security definer
set search_path = public as $$
  select
    coalesce((select sum(i.amount_pence) from public.invoices i
      where i.organisation_id = p_org and i.contact_id = p_contact
        and i.dated_on >= p_since::date), 0)::bigint,
    coalesce((select sum(p.amount_pence) from public.payments p
      where p.organisation_id = p_org and p.contact_id = p_contact
        and p.status = 'settled'
        and coalesce(p.processed_at, p.created_at) >= p_since), 0)::bigint;
$$;

grant execute on function public.sheet_export_enqueue(uuid, timestamptz) to service_role;
grant execute on function public.sheet_export_revenue(uuid, uuid, timestamptz) to service_role;
revoke all on function public.sheet_export_enqueue(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.sheet_export_revenue(uuid, uuid, timestamptz) from public, anon, authenticated;

notify pgrst, 'reload schema';
