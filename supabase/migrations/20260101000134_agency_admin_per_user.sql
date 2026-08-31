-- Agency access becomes PER USER, not per organisation.
--
-- 000133 seeded is_agency=true on every parentless org, which over-granted:
-- an agency org can hold both our staff AND client users (Plan4growth does),
-- so "owner of an agency org" handed agency powers — sub-account creation,
-- practice mapping, production logs — to real client users.
--
-- users.is_agency_admin is now the single grant. organisations.is_agency is
-- demoted to "may parent sub-accounts", derived below from where the agency
-- admins actually sit, and is no longer sufficient on its own.

alter table public.users
  add column if not exists is_agency_admin BOOLEAN not null default false;

create index if not exists idx_users_agency_admin
  on public.users(is_agency_admin) where is_agency_admin;

-- Seed the current agency staff. Idempotent and additive: re-applying never
-- revokes a grant made later through the platform console.
-- The agency-operated logins. Granting is per USER precisely because the
-- agency org also holds client users (Plan4growth has four) — they stay false
-- and never see the agency switcher.
update public.users
   set is_agency_admin = true
 where lower(email) in ('dev.ruhithpasha@gmail.com', 'ruhithpasha813@gmail.com');

-- Exactly ONE agency org, which owns every sub-account. Agency admins may sit
-- in a different org (they are granted per user above) and still administer
-- it, so this is not derived from where the admins happen to live. Clears the
-- blanket 000133 seed from every other org. Existing sub-accounts already
-- parent to Plan4growth, so no re-parenting is needed.
update public.organisations set is_agency = false where lower(name) <> 'plan4growth';
update public.organisations set is_agency = true where lower(name) = 'plan4growth';

-- authenticate() reads is_agency_admin on every request via this RPC, so it
-- has to travel in the same single round trip as the rest of the user row.
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
    ), '[]'::jsonb)
  );
$function$;

notify pgrst, 'reload schema';
