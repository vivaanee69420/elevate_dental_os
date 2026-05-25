-- Phase 2: snapshot cadence (weekly|monthly) + provenance tagging on data tables.
-- Applies after baseline schema in 000001.

ALTER TABLE business_health
  ADD COLUMN IF NOT EXISTS snapshot_frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (snapshot_frequency IN ('weekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS last_snapshot_at TIMESTAMPTZ;

-- Provenance tag — where each row came from. Free-text (no CHECK) so providers
-- can be added without migrations. Valid values documented in code:
--   manual | stripe | xero | quickbooks | dentally | soe | google_ads
--   meta_ads | google_calendar | mailchimp | webhook | seed
ALTER TABLE payments      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE leads         ADD COLUMN IF NOT EXISTS source_provider TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE appointments  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE contacts      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- Note: leads already has a "source" TEXT column (marketing channel label).
-- We add source_provider to disambiguate provenance from marketing channel.

CREATE INDEX IF NOT EXISTS idx_payments_source     ON payments(organisation_id, source);
CREATE INDEX IF NOT EXISTS idx_leads_provider      ON leads(organisation_id, source_provider);
CREATE INDEX IF NOT EXISTS idx_appointments_source ON appointments(organisation_id, source);
CREATE INDEX IF NOT EXISTS idx_contacts_source     ON contacts(organisation_id, source);

-- Reload PostgREST cache after applying:
--   NOTIFY pgrst, 'reload schema';
