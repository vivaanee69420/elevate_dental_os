-- Agency + sub-accounts (phase A1): organisations hierarchy + org_features
-- entitlement overrides. org_features rows OVERRIDE the code catalog defaults
-- in backend/src/lib/features.js — internal features default off, product
-- modules default on; absent row = catalog default.
-- Spec: docs/superpowers/specs/2026-08-31-saas-feature-gating-and-isolation-design.md

alter table public.organisations
  add column if not exists parent_organisation_id UUID references public.organisations(id),
  add column if not exists is_agency BOOLEAN not null default false;

create index if not exists idx_organisations_parent
  on public.organisations(parent_organisation_id);

create table if not exists public.org_features (
  organisation_id UUID not null references public.organisations(id) on delete cascade,
  feature TEXT not null,
  enabled BOOLEAN not null,
  created_at TIMESTAMPTZ not null default NOW(),
  updated_at TIMESTAMPTZ not null default NOW(),
  primary key (organisation_id, feature)
);

alter table public.org_features enable row level security;
-- Service-role-only table: RLS enabled with NO policies (same idiom as the
-- platform_admins hardening in 000104). anon/authenticated are default-denied;
-- the app path is serviceClient + explicit .eq('organisation_id', ...).

-- Seed: every parentless org existing at migration time is ours -> mark as
-- agency and switch the four internal features on. Sub-accounts created later
-- carry parent_organisation_id, so a re-apply never touches them, and the
-- ON CONFLICT keeps any later manual toggle.
update public.organisations set is_agency = true where parent_organisation_id is null;

insert into public.org_features (organisation_id, feature, enabled)
select o.id, f.feature, true
from public.organisations o
cross join (values ('data_room'), ('emergent'), ('call_reporting'), ('sheet_export')) as f(feature)
where o.parent_organisation_id is null
on conflict (organisation_id, feature) do nothing;

notify pgrst, 'reload schema';
