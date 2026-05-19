-- ============================================================================
-- DYNAMIC RBAC — role_permissions
-- ============================================================================
-- Org-scoped, admin-editable permission matrix. The SET of grantable
-- permission keys lives in code (PERMISSION_CATALOG, backend/src/lib/
-- permissions.js) so every key maps to a real enforcement point. This table
-- only stores, per organisation + role, which catalog keys are allowed.
--
-- Effective permission resolution (backend permission service):
--     catalog default (deny)  <-  role_permissions (admin-set)
--                             <-  users.permissions JSONB (per-user override)
--
-- RLS keeps org isolation as the hard boundary: a row is only visible/
-- writable within its own organisation; only the owner may mutate it.
-- ============================================================================

CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'practice_manager', 'reception')),
  permission_key TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, role, permission_key)
);

CREATE TRIGGER role_permissions_updated_at BEFORE UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- P1: resolution does one lookup per request keyed by (org, role).
CREATE INDEX idx_role_permissions_org_role
  ON role_permissions (organisation_id, role);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Everyone in the org may read the matrix (the UI shows it; reception sees
-- its own effective perms). Only the owner may change it.
CREATE POLICY "role_permissions_read" ON role_permissions
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "role_permissions_owner_write" ON role_permissions
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner')
  WITH CHECK (organisation_id = current_org_id() AND current_user_role() = 'owner');

-- ============================================================================
-- Seed defaults for an organisation. Idempotent (ON CONFLICT DO NOTHING) so
-- it is safe to call on every signup and to backfill existing orgs. The
-- default grant map mirrors project rule 5:
--   owner             -> everything
--   practice_manager  -> operations/growth/CRM/patients; NOT finance/wealth/
--                         system/permissions (owner toggles those on later)
--   reception         -> CRM essentials only
-- Keys MUST stay in sync with PERMISSION_CATALOG in code.
-- ============================================================================
CREATE OR REPLACE FUNCTION seed_role_permissions(p_org UUID)
RETURNS VOID AS $$
DECLARE
  -- (role, permission_key, allowed) default grant rows
  defaults TEXT[][] := ARRAY[
    -- owner: all true
    ['owner','finance.view','t'], ['owner','valuation.view','t'],
    ['owner','businesshealth.manage','t'], ['owner','operations.view','t'],
    ['owner','intelligence.view','t'], ['owner','growth.view','t'],
    ['owner','crm.view','t'], ['owner','crm.manage','t'],
    ['owner','wealth.view','t'], ['owner','training.view','t'],
    ['owner','system.manage','t'], ['owner','users.invite','t'],
    ['owner','users.manage','t'], ['owner','permissions.manage','t'],
    -- practice_manager: ops/growth/crm/training, no finance/wealth/system/perms
    ['practice_manager','finance.view','f'], ['practice_manager','valuation.view','f'],
    ['practice_manager','businesshealth.manage','f'], ['practice_manager','operations.view','t'],
    ['practice_manager','intelligence.view','f'], ['practice_manager','growth.view','t'],
    ['practice_manager','crm.view','t'], ['practice_manager','crm.manage','t'],
    ['practice_manager','wealth.view','f'], ['practice_manager','training.view','t'],
    ['practice_manager','system.manage','f'], ['practice_manager','users.invite','f'],
    ['practice_manager','users.manage','f'], ['practice_manager','permissions.manage','f'],
    -- reception: CRM essentials only
    ['reception','finance.view','f'], ['reception','valuation.view','f'],
    ['reception','businesshealth.manage','f'], ['reception','operations.view','f'],
    ['reception','intelligence.view','f'], ['reception','growth.view','f'],
    ['reception','crm.view','t'], ['reception','crm.manage','f'],
    ['reception','wealth.view','f'], ['reception','training.view','f'],
    ['reception','system.manage','f'], ['reception','users.invite','f'],
    ['reception','users.manage','f'], ['reception','permissions.manage','f']
  ];
  i INT;
BEGIN
  FOR i IN 1 .. array_length(defaults, 1) LOOP
    INSERT INTO role_permissions (organisation_id, role, permission_key, allowed)
    VALUES (p_org, defaults[i][1], defaults[i][2], defaults[i][3] = 't')
    ON CONFLICT (organisation_id, role, permission_key) DO NOTHING;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Backfill every existing organisation.
DO $$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM organisations LOOP
    PERFORM seed_role_permissions(o.id);
  END LOOP;
END $$;
