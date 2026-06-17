-- ============================================================================
-- 000104 — Enable default-deny RLS on the platform-admin tables.
--
-- platform_admins holds superadmin password hashes; platform_audit_log holds the
-- platform action trail. They were created with RLS DISABLED (migration 000009).
-- The app only ever reaches them via the service-role client (server-side), which
-- BYPASSES RLS — so enabling RLS with NO policies changes nothing for the app, but
-- closes the gap where the public anon key (shipped to the browser) could query
-- these tables directly through PostgREST.
--
-- RLS enabled + zero policies = default deny for anon/authenticated roles;
-- service_role (and the postgres owner) bypass RLS, so backend access is unaffected.
-- Idempotent: ENABLE is safe to re-run.
-- ============================================================================

ALTER TABLE platform_admins    ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_log ENABLE ROW LEVEL SECURITY;

-- NOTE: deliberately NOT using FORCE ROW LEVEL SECURITY. Plain ENABLE denies the
-- anon/authenticated PostgREST roles (the actual exposure) while service_role
-- still bypasses via its BYPASSRLS attribute, so the backend is unaffected. FORCE
-- would additionally subject the table-owner role to RLS — unnecessary for this
-- threat and a needless breakage risk.

-- PostgREST schema cache must be reloaded after DDL (recurring gotcha).
NOTIFY pgrst, 'reload schema';
