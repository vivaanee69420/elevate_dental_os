-- ============================================================================
-- PHASE 5 — Platform-admin (SaaS-owner) layer
-- ============================================================================
-- Completely separate from tenant users. Platform admins are the SaaS
-- operators (us). They authenticate against their own table with a
-- dedicated JWT (PLATFORM_ADMIN_JWT_SECRET, NOT the Supabase JWT) and
-- their actions are written to platform_audit_log on every request.
--
-- These tables do NOT use RLS. Only serviceClient touches them and
-- ONLY through middleware/platform-auth.js, which validates the
-- platform JWT before any handler runs. No tenant code path can reach
-- platform_admins.
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform_admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'support'
       CHECK (role IN ('superadmin', 'support', 'readonly')),
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS platform_admins_updated_at ON platform_admins;
CREATE TRIGGER platform_admins_updated_at
  BEFORE UPDATE ON platform_admins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS platform_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_admin_id UUID NOT NULL REFERENCES platform_admins(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  target_organisation_id UUID,
  target_user_id UUID,
  ip_address INET,
  user_agent TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_admin
  ON platform_audit_log(platform_admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_org
  ON platform_audit_log(target_organisation_id, created_at DESC)
  WHERE target_organisation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_audit_action
  ON platform_audit_log(action, created_at DESC);

ALTER TABLE platform_admins    DISABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_log DISABLE ROW LEVEL SECURITY;

-- After applying on hosted Supabase, run in SQL Editor:
--   NOTIFY pgrst, 'reload schema';
