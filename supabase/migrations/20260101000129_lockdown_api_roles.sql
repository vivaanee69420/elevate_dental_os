-- ============================================================================
-- Lock the PostgREST API roles out of the public schema.
-- ============================================================================
-- Context (CSO audit 2026-08-25): the hosted project had RLS disabled on 46
-- public tables with full SELECT/INSERT/UPDATE/DELETE granted to `anon` and
-- `authenticated`, and 45 org-keyed RPCs executable by `anon`. The anon /
-- publishable key ships in the browser bundle by design, so every tenant's
-- data was readable and writable by anyone on the internet.
--
-- Nothing in this app reads through those roles: the backend uses the
-- service-role client in every repository (bypasses RLS), and the frontend
-- talks only to the backend proxy. So revoking their grants closes the door
-- with zero application impact. RLS (migration 000130) is re-enabled on top
-- as defence in depth — but grants are the primary control.
--
-- Applied on hosted 2026-08-26 via the Supabase MCP. Idempotent.

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, public;

-- Make it the default for every object created from now on (migrations run
-- as postgres). Without this, the next CREATE TABLE re-opens the door.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, public;

-- RLS policies call these two helpers as the invoking role; keep them callable.
GRANT EXECUTE ON FUNCTION public.current_org_id(), public.current_user_role() TO anon, authenticated;

-- Outbound HTTP (pg_net) must not be callable by API roles.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA net FROM anon, authenticated;

-- Convention going forward: every CREATE FUNCTION migration ends with
--   REVOKE EXECUTE ON FUNCTION public.fn(args) FROM public, anon, authenticated;
--   GRANT  EXECUTE ON FUNCTION public.fn(args) TO service_role;
-- (auth_bootstrap and sheet_export_* already do this.)

NOTIFY pgrst, 'reload schema';
