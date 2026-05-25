-- ============================================================================
-- GoHighLevel integration + integrations-table reconciliation.
-- ============================================================================
-- Two jobs:
--   1. Reconcile the `integrations` table. The canonical 000001 schema created
--      it with `encrypted_credentials TEXT` and a status CHECK of
--      (connected|disconnected|error|expired). Migration 000008 re-declared it
--      with CREATE TABLE IF NOT EXISTS (secrets BYTEA, verified_at, expires_at,
--      scopes, status pending|verifying|active|failed|revoked) — but on a clean
--      reset 000001 wins and 000008 is a no-op, so the repo's upsertSecrets
--      (writes secrets/verified_at/expires_at/scopes and status='active') failed
--      on a fresh DB. This migration makes the table match what the code expects,
--      idempotently, on both fresh-reset and already-migrated hosted DBs.
--   2. Add GoHighLevel mapping columns to contacts + leads.
-- All statements are idempotent; safe to re-run on `supabase db reset`.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. integrations table reconciliation
-- ----------------------------------------------------------------------------
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS secrets BYTEA;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS scopes TEXT[];
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
-- Optimistic refresh guard: a worker/manual refresh claims the row by setting
-- this to now(); a concurrent caller that finds it recently set backs off.
-- Avoids burning GHL's single-use refresh token. No SELECT FOR UPDATE needed
-- (the Supabase JS / PostgREST client can't take row locks).
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS refresh_in_progress_at TIMESTAMPTZ;

-- Status CHECK reconciliation. Migrate any legacy values to the new vocabulary
-- BEFORE swapping the constraint, or the ADD CONSTRAINT fails on existing rows.
UPDATE integrations SET status = 'active'   WHERE status = 'connected';
UPDATE integrations SET status = 'pending'  WHERE status = 'disconnected';
UPDATE integrations SET status = 'failed'   WHERE status IN ('error', 'expired');
UPDATE integrations SET status = 'pending'
  WHERE status NOT IN ('pending', 'verifying', 'active', 'failed', 'revoked');

ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_status_check;
ALTER TABLE integrations
  ADD CONSTRAINT integrations_status_check
  CHECK (status IN ('pending', 'verifying', 'active', 'failed', 'revoked'));
ALTER TABLE integrations ALTER COLUMN status SET DEFAULT 'pending';

-- ----------------------------------------------------------------------------
-- 2. GoHighLevel mappings on contacts
-- ----------------------------------------------------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_ghl_id
  ON contacts (organisation_id, ghl_contact_id)
  WHERE ghl_contact_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. GoHighLevel mappings on leads
-- ----------------------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ghl_opportunity_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ghl_pipeline_id TEXT;
-- Default 'manual': existing/seeded leads were entered by hand, not GHL-synced.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_sync_status_check;
ALTER TABLE leads
  ADD CONSTRAINT leads_sync_status_check
  CHECK (sync_status IN ('synced', 'manual', 'pending_sync'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_ghl_opportunity
  ON leads (organisation_id, ghl_opportunity_id)
  WHERE ghl_opportunity_id IS NOT NULL;
