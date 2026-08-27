-- ============================================================================
-- Custom Access Token Hook: restore what it needs under the 000129/000130 lockdown.
--
-- Symptom: every password sign-in failed with
--   "Error running hook URI: pg-functions://postgres/public/custom_access_token_hook"
-- (surfaced to users as 401 "Invalid email or password") from 2026-08-26.
--
-- Cause: the hook runs as `supabase_auth_admin` and does
--   SELECT * FROM public.users WHERE id = ...
-- 000130 re-enabled RLS on `users`; its policies call current_org_id() /
-- current_user_role(), and 000129 revoked EXECUTE on those from everyone but
-- anon/authenticated. Policy evaluation as supabase_auth_admin therefore
-- raised "permission denied for function", the hook errored, GoTrue refused
-- the sign-in.
--
-- Fix (Supabase's documented hook pattern): the auth role may execute the
-- policy helpers, and gets its own permissive SELECT policy on `users` so the
-- hook can stamp organisation_id/role claims regardless of JWT context.
-- Idempotent. No data change.
-- ============================================================================

grant usage on schema public to supabase_auth_admin;
grant execute on function public.current_org_id()    to supabase_auth_admin;
grant execute on function public.current_user_role() to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on table public.users to supabase_auth_admin;

drop policy if exists users_auth_admin_read on public.users;
create policy users_auth_admin_read on public.users
  as permissive for select
  to supabase_auth_admin
  using (true);

notify pgrst, 'reload schema';
