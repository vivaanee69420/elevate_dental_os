-- Emergent → practice mapping. Explicit owner-set mapping of each Emergent
-- "business" (business_id) to a Dental-os practice, replacing the fuzzy
-- name-match as the primary resolver for treatment_accepted.practice_id.
-- Also adds a real business_id column on treatment_accepted (extracted from raw)
-- so re-stamping on a mapping change and discovery queries are clean.
-- Idempotent. Additive only — safe to re-apply.
-- After applying on hosted run: NOTIFY pgrst, 'reload schema';

-- 1) Map table -------------------------------------------------------------
create table if not exists public.emergent_practice_map (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  business_id     text not null,
  business_name   text,
  practice_id     uuid references public.practices(id) on delete set null,  -- null = intentionally unmapped
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, business_id)
);
create index if not exists emergent_practice_map_org_idx
  on public.emergent_practice_map (organisation_id);
alter table public.emergent_practice_map enable row level security;
-- App path uses serviceClient + explicit .eq('organisation_id', orgId) (rule 3).

-- 2) business_id column on treatment_accepted ------------------------------
alter table public.treatment_accepted
  add column if not exists business_id text;
update public.treatment_accepted
  set business_id = raw->>'business_id'
  where business_id is null and raw ? 'business_id';
create index if not exists treatment_accepted_org_business_idx
  on public.treatment_accepted (organisation_id, business_id);

-- 3) Seed the map from data already synced (preserve current fuzzy links) ---
insert into public.emergent_practice_map (organisation_id, business_id, business_name, practice_id)
select distinct on (t.organisation_id, t.business_id)
       t.organisation_id, t.business_id,
       t.raw->>'business_name' as business_name,
       t.practice_id
from public.treatment_accepted t
where t.business_id is not null
order by t.organisation_id, t.business_id, (t.practice_id is null) asc  -- prefer a non-null practice_id
on conflict (organisation_id, business_id) do nothing;

notify pgrst, 'reload schema';
