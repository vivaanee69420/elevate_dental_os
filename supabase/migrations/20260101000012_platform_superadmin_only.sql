-- ============================================================================
-- Platform admins are superadmin-only
-- ============================================================================
-- The original platform_admins table (migration ...000009) allowed three
-- roles ('superadmin', 'support', 'readonly') with DEFAULT 'support'. In
-- practice only 'superadmin' is ever used: every sensitive route is gated
-- with requirePlatformRole('superadmin'), and nothing assigns or branches on
-- 'support'/'readonly'. Worse, the 'support' default meant any newly-inserted
-- admin was born locked out of every sensitive route (403).
--
-- This migration makes superadmin the only valid tier:
--   1. promote any non-superadmin rows to superadmin (so the tighter CHECK
--      can be applied without violation),
--   2. replace the role CHECK with role IN ('superadmin'),
--   3. set the column DEFAULT to 'superadmin'.
--
-- The role column is intentionally kept (requirePlatformRole stays a valid,
-- now always-passing, guard) — see /plan-eng-review decision, May 2026.
--
-- Idempotent: re-applies cleanly on `supabase db reset`.
-- After running on hosted: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- 1. Promote existing rows.
UPDATE platform_admins SET role = 'superadmin' WHERE role <> 'superadmin';

-- 2. Tighten the CHECK constraint. The inline constraint from ...000009 is
--    auto-named platform_admins_role_check.
ALTER TABLE platform_admins DROP CONSTRAINT IF EXISTS platform_admins_role_check;
ALTER TABLE platform_admins
  ADD CONSTRAINT platform_admins_role_check CHECK (role IN ('superadmin'));

-- 3. New admins default to superadmin (was 'support' — the lock-out footgun).
ALTER TABLE platform_admins ALTER COLUMN role SET DEFAULT 'superadmin';
