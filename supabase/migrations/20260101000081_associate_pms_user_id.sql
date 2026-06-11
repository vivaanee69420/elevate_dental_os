-- 20260101000081_associate_pms_user_id.sql
-- Collapse per-site practitioner duplicates on the Associates roster.
--
-- Dentally models one clinician as a SEPARATE practitioner record per site
-- (distinct practitioner.id + site_id, distinct associates.pms_external_id) that
-- all share one user.id. So "Amit Coonar" legitimately appears once per site he
-- works at — 216 practitioner rows but ~157 actual people. Deleting rows is wrong
-- (the sync recreates them on the (org, pms_external_id) upsert, and each carries
-- its own per-site invoice_items/appointments). The fix is to GROUP the roster by
-- the shared Dentally user.id and aggregate metrics, which needs the id stored.
--
-- pms_user_id is backfilled by the practitioners sync (practitionerRow). Index it
-- for the per-person grouping lookup. Idempotent.

ALTER TABLE associates ADD COLUMN IF NOT EXISTS pms_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_associates_org_pms_user
  ON associates(organisation_id, pms_user_id);

NOTIFY pgrst, 'reload schema';
