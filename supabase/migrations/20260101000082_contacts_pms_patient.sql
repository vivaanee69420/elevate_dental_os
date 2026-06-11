-- ============================================================================
-- 000082  contacts.pms_patient — full Dentally patient detail blob
-- ----------------------------------------------------------------------------
-- The Dentally /patients sync historically mapped only 7 fields into contacts
-- (name, email, phone, dob, pms ids). Every other patient detail Dentally
-- returns — address lines, county, town, title, gender, NHS number, recall
-- dates/intervals, preferred dentist/hygienist, emergency contact, consents —
-- was discarded, so the patient detail view had nothing to show.
--
-- Rather than bloat the shared contacts table (which also holds leads/lapsed)
-- with ~20 patient-only columns, the curated Dentally patient payload is stored
-- as one JSONB blob. The few genuinely useful fields (address, postcode, dob,
-- recall) continue to land in their typed columns for app/query use; the blob
-- backs the read-only detail dialog.
--
-- NB: this blob carries PII (and may include a medical-alert summary). It is
-- display-only and is NOT included in the AI context snapshot.
-- Idempotent; re-applies cleanly.
-- ============================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS pms_patient JSONB;

-- PostgREST schema cache goes stale after DDL — force a reload.
NOTIFY pgrst, 'reload schema';
