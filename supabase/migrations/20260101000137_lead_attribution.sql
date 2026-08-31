-- ============================================================================
-- Ad attribution on contacts. GoHighLevel returns an attributions[] array on
-- every contact in the LIST response; the sync has always discarded it. These
-- columns persist it so a lead can be joined to the campaign that produced it.
--
-- ON CONTACTS, NOT LEADS: attribution arrives in the contact pull and is
-- contact-level (one person, one first touch). A contact may own several leads;
-- storing it per-lead would duplicate it and let the copies disagree. Reads
-- join leads -> contacts.
--
-- attribution_captured_at is the "have we filled this row" flag. A single
-- nullable timestamp beats testing several columns, and records when we got it.
--
-- Additive + idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_campaign_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_set_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS gclid TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS landing_page_url TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attribution_source TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attribution_medium TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attribution_campaign_name TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attribution_captured_at TIMESTAMPTZ;
-- utm_* exist on `leads` but NOT on `contacts`. contactRow spreads the whole
-- extractor output into a contacts upsert, so without these three every contact
-- write fails with "column does not exist" and the entire GHL sync breaks.
-- utmMedium is not redundant: for Meta it carries the AD SET name
-- ("Photos | 35+ | 258K | 03/08/26"), which no other column holds.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

-- The hot read: join a lead's contact to ad_metrics by campaign.
CREATE INDEX IF NOT EXISTS idx_contacts_ad_campaign
  ON contacts(organisation_id, ad_campaign_id)
  WHERE ad_campaign_id IS NOT NULL;

-- The opportunistic-fill probe: which already-synced contacts still need
-- attribution. Partial, so it stays small as coverage grows.
CREATE INDEX IF NOT EXISTS idx_contacts_attribution_pending
  ON contacts(organisation_id, ghl_contact_id)
  WHERE attribution_captured_at IS NULL AND ghl_contact_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
