-- ============================================================================
-- 000054 — Manual-input history on business_health_snapshots.
--
-- Problem: business_health.baseline/targets/manual are single JSONB blobs that
-- OVERWRITE in place — picking a past period in the app cannot show what a
-- target/KPI WAS at that time. We reuse the existing per-day snapshots table to
-- carry a point-in-time copy of the owner's manual inputs alongside the cron's
-- computed `metrics`. Every manual save writes/refreshes today's `inputs` blob;
-- an as-of read takes the latest row with snapshot_date <= period-end.
--
-- `inputs` shape: { baseline: {...}, targets: {...}, manual: {...} }
-- Kept in a SEPARATE column from `metrics` so the nightly cron (writes metrics)
-- and manual saves (write inputs) never clobber each other on the same daily
-- row (unique on organisation_id, snapshot_date).
-- Idempotent; re-applies cleanly.
-- ============================================================================
ALTER TABLE business_health_snapshots
  ADD COLUMN IF NOT EXISTS inputs JSONB;

-- Partial index: as-of reads only ever scan rows that actually carry inputs.
CREATE INDEX IF NOT EXISTS idx_snapshots_inputs_org_date
  ON business_health_snapshots(organisation_id, snapshot_date DESC)
  WHERE inputs IS NOT NULL;

NOTIFY pgrst, 'reload schema';
