-- Sheet export queue: one row per Dentally patient whose FIRST appointment
-- was created after the google_sheets_writer connection was set up. Outbox
-- for the GHL→Dentally conversion export. Spec:
-- docs/superpowers/specs/2026-08-06-ghl-dentally-sheet-export-design.md

create table if not exists public.sheet_export_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  practice_id UUID REFERENCES public.practices(id) ON DELETE SET NULL,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  appointment_starts_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','exported','no_match','failed')),
  matched_contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  matched_lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  claimed_at TIMESTAMPTZ,
  exported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

create unique index if not exists sheet_export_queue_org_contact
  on public.sheet_export_queue(organisation_id, contact_id);
create index if not exists idx_sheet_export_queue_org_status
  on public.sheet_export_queue(organisation_id, status);
-- Supports the enqueue RPC's first-appointment scan.
create index if not exists idx_appointments_org_contact_created
  on public.appointments(organisation_id, contact_id, created_at);
-- Supports the enqueue RPC's created_at >= p_since filter.
create index if not exists idx_appointments_org_created
  on public.appointments(organisation_id, created_at);

alter table public.sheet_export_queue enable row level security;
-- Worker/webhook-only table: RLS enabled with NO tenant policy — identical to
-- sheet_sources/sheet_leads (000118). The anon/tenant path is fully blocked;
-- the app path is serviceClient + explicit .eq('organisation_id', orgId)
-- (rule 3), and the RPCs below are SECURITY DEFINER taking p_org.

-- Enqueue: patients whose FIRST-ever non-cancelled Dentally appointment was
-- created at/after p_since. Patients with ANY appointment created before
-- p_since never enqueue (go-forward-only). Idempotent via ON CONFLICT.
create or replace function public.sheet_export_enqueue(p_org UUID, p_since TIMESTAMPTZ)
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
      (organisation_id, practice_id, contact_id, appointment_id, appointment_starts_at)
    select p_org, f.practice_id, f.contact_id, f.appointment_id, f.starts_at
    from firsts f
    join public.contacts c on c.id = f.contact_id and c.organisation_id = p_org
    where c.pms_external_id is not null
      and not exists (
        select 1 from public.appointments prior
        where prior.organisation_id = p_org
          and prior.contact_id = f.contact_id
          and prior.status <> 'cancelled'
          and prior.created_at < p_since)
    on conflict (organisation_id, contact_id) do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;

-- Atomic claim: pending (respecting exponential backoff), stale processing
-- (crashed drainer >10 min), and optionally young no_match rows (gated by a
-- 4h backoff so they don't get re-claimed every 15-min sweep and starve
-- pending rows). SKIP LOCKED keeps concurrent drains (webhook kick vs cron
-- sweep) on disjoint sets. Pending rows are prioritised ahead of no_match
-- retries in the ordering.
create or replace function public.sheet_export_claim(
  p_org UUID, p_limit INT default 50, p_include_no_match BOOLEAN default false)
returns setof public.sheet_export_queue
language sql
security definer
set search_path = public as $$
  update public.sheet_export_queue q
  set status = 'processing', claimed_at = now(), updated_at = now()
  where q.id in (
    select id from public.sheet_export_queue
    where organisation_id = p_org
      and attempts < 10
      and (
        (status = 'pending' and (attempts = 0 or
          updated_at < now() - make_interval(mins =>
            least(power(2, least(attempts, 10)), 1440)::int)))
        or (status = 'processing' and claimed_at < now() - interval '10 minutes')
        or (p_include_no_match and status = 'no_match'
            and created_at > now() - interval '30 days'
            and updated_at < now() - interval '4 hours'))
    order by (status = 'pending') desc, created_at asc
    limit p_limit
    for update skip locked)
  returning q.*;
$$;

-- Phone-candidate lookup: GHL contacts whose digits-only phone ends with
-- p_digits (last 9 significant digits). SQL-side because stored phone
-- formatting varies ("07123 456789" vs "+447123456789").
create or replace function public.sheet_export_phone_candidates(p_org UUID, p_digits TEXT)
returns table (id UUID, first_name TEXT, last_name TEXT, email TEXT, phone TEXT,
               ghl_contact_id TEXT, created_at TIMESTAMPTZ)
language sql
security definer
set search_path = public as $$
  select c.id, c.first_name, c.last_name, c.email, c.phone,
         c.ghl_contact_id, c.created_at
  from public.contacts c
  where c.organisation_id = p_org
    and c.ghl_contact_id is not null
    and length(regexp_replace(coalesce(p_digits, ''), '\D', '', 'g')) >= 9
    and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')
        like '%' || regexp_replace(coalesce(p_digits, ''), '\D', '', 'g');
$$;

grant execute on function public.sheet_export_enqueue(UUID, TIMESTAMPTZ) to service_role;
grant execute on function public.sheet_export_claim(UUID, INT, BOOLEAN) to service_role;
grant execute on function public.sheet_export_phone_candidates(UUID, TEXT) to service_role;

-- House idiom (see 000010/000021): these are SECURITY DEFINER RPCs exposed at
-- /rest/v1/rpc/* — without an explicit revoke, PostgREST grants EXECUTE to
-- PUBLIC by default, letting an anon-key holder pass an arbitrary org UUID
-- and read contact PII / write cross-org queue rows.
revoke all on function public.sheet_export_enqueue(UUID, TIMESTAMPTZ) from public, anon, authenticated;
revoke all on function public.sheet_export_claim(UUID, INT, BOOLEAN) from public, anon, authenticated;
revoke all on function public.sheet_export_phone_candidates(UUID, TEXT) from public, anon, authenticated;

notify pgrst, 'reload schema';
