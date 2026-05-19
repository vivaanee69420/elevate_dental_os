-- ============================================================================
-- USER PROVISIONING STATUS
-- ============================================================================
-- A member can only obtain a session once an admin has provisioned them AND
-- they have accepted the invite (set a password). Login is gated on
-- status = 'active' (see auth.service.login).
--
--   invited : admin created the row + sent the Supabase invite; the member
--             has not completed setup. NO login permitted.
--   active  : member authenticated post-invite (password set). Login allowed.
--
-- Existing users default to 'active' so the current owner is not locked out.
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('invited', 'active'));

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- NOTE: orphaned Supabase auth.users entries (rows deleted from public.users
-- while the auth identity lingered — the login/re-signup bug) cannot be
-- cleaned from a SQL migration because auth.users is Supabase-managed. They
-- are removed going forward by the admin "remove member" flow
-- (serviceClient.auth.admin.deleteUser). To clear pre-existing orphans now,
-- delete them from the Supabase dashboard → Authentication → Users, or via
-- the service-role admin API for any email with no matching public.users row.
