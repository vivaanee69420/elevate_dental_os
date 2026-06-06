-- ============================================================================
-- 000055 — Chair-utilisation history.
--
-- chair_utilisation is a current-state "typical week" grid: one row per
-- (org, practice, chair, weekday, slot), updated IN PLACE. Picking a past
-- period cannot show what the grid WAS. We snapshot the whole per-practice
-- cell set on every change into a date-keyed table; an as-of read takes the
-- latest snapshot with snapshot_date <= period-end.
--
-- `cells` shape: [{chair_name, weekday, slot, booked_minutes, available_minutes}, ...]
-- (exactly what lib/chair-utilisation.js aggregateGrid() consumes).
-- Idempotent; re-applies cleanly.
-- ============================================================================
CREATE TABLE IF NOT EXISTS chair_utilisation_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  cells JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organisation_id, practice_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_chair_snapshots_org_practice_date
  ON chair_utilisation_snapshots(organisation_id, practice_id, snapshot_date DESC);

NOTIFY pgrst, 'reload schema';
