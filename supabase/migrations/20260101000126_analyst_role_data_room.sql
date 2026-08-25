-- ============================================================================
-- Data Room: `analyst` role + `data.export` permission + keyset indexes.
--
-- 1. Widen the role CHECKs (users, role_permissions) to admit 'analyst'.
-- 2. Re-create seed_role_permissions with the new key `data.export`
--    (owner t / practice_manager f / reception f / analyst t) and a full
--    deny row-set for analyst on every other key. Backfill is ON CONFLICT DO
--    NOTHING so owner-edited rows are never clobbered. Code defaults in
--    backend/src/lib/permissions.js remain the safety net.
-- 3. (organisation_id, <date>, id) btrees for the Data Room keyset iterator
--    on the event tables that lacked an (organisation_id, <date>) index.
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('owner', 'practice_manager', 'reception', 'analyst'));

ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_check;
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_check
  CHECK (role IN ('owner', 'practice_manager', 'reception', 'analyst'));

CREATE OR REPLACE FUNCTION seed_role_permissions(p_org UUID)
RETURNS VOID AS $$
DECLARE
  defaults TEXT[][] := ARRAY[
    -- owner: all true
    ['owner','finance.view','t'], ['owner','valuation.view','t'],
    ['owner','businesshealth.manage','t'], ['owner','operations.view','t'],
    ['owner','intelligence.view','t'], ['owner','growth.view','t'],
    ['owner','crm.view','t'], ['owner','crm.manage','t'],
    ['owner','wealth.view','t'], ['owner','training.view','t'],
    ['owner','system.manage','t'], ['owner','users.invite','t'],
    ['owner','users.manage','t'], ['owner','permissions.manage','t'],
    ['owner','data.export','t'],
    -- practice_manager: ops/growth/crm/training, no finance/wealth/system/perms/data
    ['practice_manager','finance.view','f'], ['practice_manager','valuation.view','f'],
    ['practice_manager','businesshealth.manage','f'], ['practice_manager','operations.view','t'],
    ['practice_manager','intelligence.view','f'], ['practice_manager','growth.view','t'],
    ['practice_manager','crm.view','t'], ['practice_manager','crm.manage','t'],
    ['practice_manager','wealth.view','f'], ['practice_manager','training.view','t'],
    ['practice_manager','system.manage','f'], ['practice_manager','users.invite','f'],
    ['practice_manager','users.manage','f'], ['practice_manager','permissions.manage','f'],
    ['practice_manager','data.export','f'],
    -- reception: CRM essentials only
    ['reception','finance.view','f'], ['reception','valuation.view','f'],
    ['reception','businesshealth.manage','f'], ['reception','operations.view','f'],
    ['reception','intelligence.view','f'], ['reception','growth.view','f'],
    ['reception','crm.view','t'], ['reception','crm.manage','f'],
    ['reception','wealth.view','f'], ['reception','training.view','f'],
    ['reception','system.manage','f'], ['reception','users.invite','f'],
    ['reception','users.manage','f'], ['reception','permissions.manage','f'],
    ['reception','data.export','f'],
    -- analyst: Data Room only
    ['analyst','finance.view','f'], ['analyst','valuation.view','f'],
    ['analyst','businesshealth.manage','f'], ['analyst','operations.view','f'],
    ['analyst','intelligence.view','f'], ['analyst','growth.view','f'],
    ['analyst','crm.view','f'], ['analyst','crm.manage','f'],
    ['analyst','wealth.view','f'], ['analyst','training.view','f'],
    ['analyst','system.manage','f'], ['analyst','users.invite','f'],
    ['analyst','users.manage','f'], ['analyst','permissions.manage','f'],
    ['analyst','data.export','t']
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

DO $$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM organisations LOOP
    PERFORM seed_role_permissions(o.id);
  END LOOP;
END $$;

-- Keyset iterator support: ORDER BY <date>, id under WHERE organisation_id = ?
-- Tables already covered by an (organisation_id, <date>) index are skipped:
-- appointments(starts_at), ad_metrics(metric_date), ghl_appointments(starts_at),
-- treatment_accepted(accepted_date), emergent_daily_cashup(cashup_date),
-- emergent_monthly_pl(period_month).
CREATE INDEX IF NOT EXISTS idx_payments_org_processed_id
  ON payments (organisation_id, processed_at, id);
CREATE INDEX IF NOT EXISTS idx_invoices_org_dated_id
  ON invoices (organisation_id, dated_on, id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_org_invoiced_id
  ON invoice_items (organisation_id, invoiced_on, id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_org_start_id
  ON treatment_plans (organisation_id, start_date, id);
CREATE INDEX IF NOT EXISTS idx_dentally_treatment_items_org_completed_id
  ON dentally_treatment_items (organisation_id, completed_at, id);
CREATE INDEX IF NOT EXISTS idx_contacts_org_created_id
  ON contacts (organisation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_leads_org_created_id
  ON leads (organisation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_communications_org_created_id
  ON communications (organisation_id, created_at, id);

NOTIFY pgrst, 'reload schema';
