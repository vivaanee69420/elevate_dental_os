-- ============================================================================
-- GoHighLevel upsert conflict targets — make them non-partial.
-- ============================================================================
-- Migration 000013 created the GHL mapping columns with PARTIAL unique indexes
-- (WHERE ghl_id IS NOT NULL). PostgREST's upsert emits `ON CONFLICT (cols)`
-- without the predicate, so Postgres can't infer a partial index and the
-- contact / opportunity upserts fail with "no unique or exclusion constraint
-- matching the ON CONFLICT specification". Replace them with plain unique
-- indexes. NULLs are distinct in a Postgres unique index, so the many rows with
-- a NULL ghl id are still allowed (no false collisions). Idempotent.
--
-- (Already applied to hosted project mkfhpzjbijbachoonytt as migrations
-- gohighlevel_contacts_leads_columns + ghl_upsert_conflict_indexes_nonpartial;
-- this file keeps `supabase db reset` in sync.)
-- ============================================================================

-- Ensure the columns exist even if 000013's contacts/leads block was skipped
-- on this database (it was, on hosted — only contacts.source had been applied).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ghl_opportunity_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ghl_pipeline_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_sync_status_check;
ALTER TABLE leads
  ADD CONSTRAINT leads_sync_status_check
  CHECK (sync_status IN ('synced', 'manual', 'pending_sync'));

DROP INDEX IF EXISTS idx_contacts_ghl_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_ghl_id
  ON contacts (organisation_id, ghl_contact_id);

DROP INDEX IF EXISTS idx_leads_ghl_opportunity;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_ghl_opportunity
  ON leads (organisation_id, ghl_opportunity_id);
