-- ============================================================================
-- auth_bootstrap(p_uid) — single round-trip for the request auth hot path.
--
-- Before this, middleware/auth.js did THREE sequential network calls per
-- authenticated request: Supabase getUser, a users SELECT, then a
-- role_permissions SELECT. getUser stays (token validation must hit the auth
-- server), but this collapses the two DB reads into one: it returns the
-- users row plus that user's (org, role) role_permissions rows as one JSONB
-- payload.
--
-- SECURITY DEFINER: serviceClient already bypasses RLS for this path, and the
-- function is locked to service_role only (revoked from anon/authenticated),
-- so it cannot widen access. It only reads by primary key + the user's own
-- (org, role) — no cross-org surface.
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
        select id, email, organisation_id, role, permissions
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

-- PostgREST caches the schema; new RPCs are invisible until reload.
notify pgrst, 'reload schema';
