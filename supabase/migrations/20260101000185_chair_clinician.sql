-- ============================================================================
-- 20260101000185_chair_clinician.sql
--
-- Who is in the chair. Neither the original chair grid nor the 000184 rebuild
-- recorded a clinician, so "Surgery 1 was 80% booked on Monday morning" could
-- never answer "by whom".
--
-- ONE clinician per (chair, weekday, slot). A morning and an afternoon are
-- already separate cells, so a chair used by one associate before lunch and
-- another after is expressible; two sharing a single slot is not, and that is
-- a deliberate limit rather than an oversight -- the alternative changes the
-- cell grain and puts a row per clinician in the entry grid.
--
-- MANUAL, and it has to be: Dentally appointments carry practitioner_id but
-- room_id is null on every row of this group's data and /rooms returns zero,
-- so the PMS can say which clinician and which practice, never which chair.
--
-- ON DELETE SET NULL, never CASCADE: removing an associate must not delete the
-- record of how busy a chair was. The chair-time is a fact about the chair.
--
-- Idempotent; re-applies cleanly.
-- ============================================================================

ALTER TABLE chair_utilisation
  ADD COLUMN IF NOT EXISTS associate_id UUID REFERENCES associates(id) ON DELETE SET NULL;

COMMENT ON COLUMN chair_utilisation.associate_id IS
  'Clinician occupying this chair in this slot, in a typical week. Nullable: a slot may be recorded without naming who worked it.';

-- Partial: most rows will carry a clinician once the feature is used, but the
-- index only ever serves the per-clinician rollup, which ignores null rows.
CREATE INDEX IF NOT EXISTS idx_chair_util_associate
  ON chair_utilisation(organisation_id, associate_id)
  WHERE associate_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
