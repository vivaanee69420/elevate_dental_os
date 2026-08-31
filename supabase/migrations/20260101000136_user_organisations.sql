-- Multi-organisation membership: one login may belong to several accounts.
--
-- Until now users.id (the Supabase auth user id) was the whole primary key, so
-- a login mapped to exactly ONE organisation and the same email could never
-- exist in two accounts. users.organisation_id is kept as the HOME/default org
-- so every existing read still works; memberships are additive.

create table if not exists public.user_organisations (
  user_id UUID not null references public.users(id) on delete cascade,
  organisation_id UUID not null references public.organisations(id) on delete cascade,
  role TEXT not null,
  permissions JSONB not null default '{}'::jsonb,
  created_at TIMESTAMPTZ not null default NOW(),
  primary key (user_id, organisation_id)
);

-- "Who is in this account?"
create index if not exists idx_user_organisations_org
  on public.user_organisations(organisation_id);

alter table public.user_organisations enable row level security;
-- Service-role-only table: RLS on with NO policies (same idiom as org_features
-- / dashboard_cache). The app path is serviceClient with explicit filters.

-- Backfill one membership per existing user, so behaviour is unchanged on day
-- one: everyone keeps exactly the account they already had.
insert into public.user_organisations (user_id, organisation_id, role, permissions)
select u.id, u.organisation_id, u.role, coalesce(u.permissions, '{}'::jsonb)
from public.users u
where u.organisation_id is not null
on conflict (user_id, organisation_id) do nothing;

-- authenticate() needs the memberships on every request. They travel in the
-- SAME single round trip as the rest of the user row — a second query per
-- request would undo the dashboard performance work.
create or replace function public.auth_bootstrap(p_uid uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'user', (
      select to_jsonb(u)
      from (
        select id, email, organisation_id, role, permissions, status, is_agency_admin
        from public.users
        where id = p_uid
      ) u
    ),
    'role_permissions', coalesce((
      select jsonb_agg(
        jsonb_build_object('permission_key', rp.permission_key, 'allowed', rp.allowed)
      )
      from public.role_permissions rp
      join public.users uu on uu.id = p_uid
      where rp.organisation_id = uu.organisation_id
        and rp.role = uu.role
    ), '[]'::jsonb),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organisation_id', m.organisation_id,
        'name', o.name,
        'role', m.role,
        'permissions', m.permissions
      ) order by o.name)
      from public.user_organisations m
      join public.organisations o on o.id = m.organisation_id
      where m.user_id = p_uid
    ), '[]'::jsonb)
  );
$function$;

notify pgrst, 'reload schema';
