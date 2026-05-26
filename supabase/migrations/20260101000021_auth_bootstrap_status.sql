-- ============================================================================
-- auth_bootstrap(p_uid) — add `status` to the returned user payload.
--
-- middleware/auth.js gates authenticated requests on user status: a 'pending'
-- (awaiting platform approval) or 'rejected' owner must not reach /api/* even
-- if they obtain a Supabase session directly (e.g. signing in against Supabase
-- with the anon key, bypassing our login route's approval gate). The RPC
-- previously omitted status, so authenticate could not see it. This recreates
-- the function with status included; everything else is unchanged.
--
-- Idempotent (create or replace). Locked to service_role only.
-- ============================================================================

create or replace function public.auth_bootstrap(p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user', (
      select to_jsonb(u)
      from (
        select id, email, organisation_id, role, permissions, status
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
$$;

revoke all on function public.auth_bootstrap(uuid) from public, anon, authenticated;
grant execute on function public.auth_bootstrap(uuid) to service_role;

-- PostgREST caches the schema; recreated RPCs are invisible until reload.
notify pgrst, 'reload schema';
