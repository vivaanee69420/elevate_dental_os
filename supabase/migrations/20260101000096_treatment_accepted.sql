-- Treatments Accepted — sourced from the Emergent ops app (staff log acceptance
-- by hand; Dentally has NO accepted flag, only a `completed` boolean). See
-- treatmentaccepted.md. Idempotent. Additive only — safe to re-apply.
--
-- NOT YET APPLIED ON HOSTED: blocked on the Emergent API contract (base URL,
-- key, webhook secret, field names, patient link key, status enum). The
-- Business Hub aggregate is gated on an active `emergent` integration, so until
-- this is applied + Emergent is connected the card renders a placeholder.
-- After applying on hosted run: NOTIFY pgrst, 'reload schema';

create table if not exists public.treatment_accepted (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations(id) on delete cascade,
  source              text not null default 'emergent',
  external_id         text not null,                      -- Emergent record id
  patient_name        text,
  patient_external_id text,                               -- maps to dentally pms_external_id
  contact_id          uuid references public.contacts(id) on delete set null,
  practice_id         uuid references public.practices(id) on delete set null,
  practitioner_name   text,
  associate_id        uuid references public.associates(id) on delete set null,
  treatment_name      text,
  value_pence         bigint not null default 0,          -- value_gbp * 100, rounded
  accepted_date       date,
  status              text,                               -- accepted | declined | pending (Emergent's own)
  raw                 jsonb,                              -- full original payload for audit/replay
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organisation_id, source, external_id)           -- upsert key
);

create index if not exists treatment_accepted_org_date_idx
  on public.treatment_accepted (organisation_id, accepted_date);
create index if not exists treatment_accepted_org_practice_idx
  on public.treatment_accepted (organisation_id, practice_id);

alter table public.treatment_accepted enable row level security;
-- App path uses serviceClient + explicit .eq('organisation_id', orgId) (rule 3).

-- ============================================================
-- treatment_accepted_aggregate — totals for the Business Hub card.
-- Counts only status='accepted' rows in the [p_since, p_until) window,
-- optionally narrowed to a practice. Money is integer pence.
-- ============================================================
create or replace function public.treatment_accepted_aggregate(
  p_org      uuid,
  p_since    timestamptz,
  p_until    timestamptz default null,
  p_practice uuid        default null
)
returns table(accepted_count bigint, accepted_value_pence bigint)
language sql stable security definer set search_path = public as $$
  select
    count(*)::bigint as accepted_count,
    coalesce(sum(value_pence), 0)::bigint as accepted_value_pence
  from public.treatment_accepted
  where organisation_id = p_org
    and status = 'accepted'
    and (p_since is null or accepted_date >= p_since::date)
    and (p_until is null or accepted_date <= p_until::date)
    and (p_practice is null or practice_id = p_practice);
$$;

grant execute on function public.treatment_accepted_aggregate(uuid, timestamptz, timestamptz, uuid)
  to service_role, authenticated;

notify pgrst, 'reload schema';
