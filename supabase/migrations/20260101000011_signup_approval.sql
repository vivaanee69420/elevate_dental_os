-- ============================================================================
-- SELF-SIGNUP APPROVAL GATE
-- ============================================================================
-- Public POST /auth/signup creates an org + owner, but the owner now lands in
-- 'pending' and CANNOT obtain a session until a platform admin approves them
-- (POST /api/platform/signups/:id/approve). Rejection marks the row 'rejected'
-- (kept for the record; login stays blocked; email stays taken).
--
--   invited  : member created via tenant invite, not yet set a password.
--   active   : may log in.
--   pending  : self-signup owner awaiting platform approval. NO login.
--   rejected : platform admin declined the signup. NO login, ever.
--
-- Platform-admin-created owners (POST /api/platform/orgs) skip 'pending' and
-- are inserted 'active' directly. Existing rows keep the 'active' default, so
-- no current user is locked out.
-- ============================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_status_check
  CHECK (status IN ('invited', 'active', 'pending', 'rejected'));

-- (idx_users_status from migration …000006 already covers status lookups,
--  including the platform "list pending signups" query.)

NOTIFY pgrst, 'reload schema';
