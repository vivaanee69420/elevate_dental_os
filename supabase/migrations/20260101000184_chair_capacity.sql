-- ============================================================================
-- 20260101000184_chair_capacity.sql
--
-- Chairs become rows, and capacity becomes a fact.
--
-- WHY practice_chairs: the chair count was DISTINCT chair_name over the grid,
-- so "Surgery 1" and "Surgery 1 " were two chairs and capacity silently
-- doubled. The unique index below is on the NORMALISED name, so that class of
-- error is now impossible rather than merely unlikely. The practices.chairs
-- fallback it replaces is 1 for all 19 practices -- a default nobody ever set.
--
-- WHY practice_opening_hours: available minutes were typed by hand with
-- nothing to check them against, and were never read by the money figures
-- anyway (those came from chair_config's chairs x 8h x 230 days). Dentally's
-- /sites returns real per-weekday opening hours, so capacity is derived and
-- only booked time is entered.
--
-- Times are MINUTES FROM LOCAL MIDNIGHT, never timestamps. These are
-- wall-clock opening times; as instants they would shift across the BST
-- boundary.
--
-- Idempotent; re-applies cleanly. NOT applied to hosted -- owner's call.
-- ============================================================================

-- ── 1. practice_chairs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS practice_chairs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id     UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (btrim(name) <> ''),
  display_order   INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- The normalised-name key IS the fix for the doubling bug. Case and
-- surrounding whitespace can no longer create a second chair.
CREATE UNIQUE INDEX IF NOT EXISTS uq_practice_chairs_norm_name
  ON practice_chairs(organisation_id, practice_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_practice_chairs_practice
  ON practice_chairs(organisation_id, practice_id) WHERE active;

DROP TRIGGER IF EXISTS practice_chairs_updated_at ON practice_chairs;
CREATE TRIGGER practice_chairs_updated_at BEFORE UPDATE ON practice_chairs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE practice_chairs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_chairs_org ON practice_chairs;
CREATE POLICY practice_chairs_org ON practice_chairs
  USING (organisation_id = current_org_id())
  WITH CHECK (organisation_id = current_org_id());

-- ── 2. practice_opening_hours ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS practice_opening_hours (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id     UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- ISO Mon..Sun
  -- Minutes from LOCAL midnight. NULL/NULL means closed that day -- which is a
  -- fact, not missing data: Sunday is absent from every Dentally site payload.
  open_minute     SMALLINT CHECK (open_minute BETWEEN 0 AND 1440),
  close_minute    SMALLINT CHECK (close_minute BETWEEN 0 AND 1440),
  -- 'dentally' rows are refreshed by the sync; 'manual' rows never are, so an
  -- owner's correction survives every future sync.
  source          TEXT NOT NULL CHECK (source IN ('dentally', 'manual')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT practice_opening_hours_span_chk CHECK (
    (open_minute IS NULL AND close_minute IS NULL)
    OR (open_minute IS NOT NULL AND close_minute IS NOT NULL AND close_minute > open_minute)
  ),
  UNIQUE (organisation_id, practice_id, weekday)
);

DROP TRIGGER IF EXISTS practice_opening_hours_updated_at ON practice_opening_hours;
CREATE TRIGGER practice_opening_hours_updated_at BEFORE UPDATE ON practice_opening_hours
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE practice_opening_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_opening_hours_org ON practice_opening_hours;
CREATE POLICY practice_opening_hours_org ON practice_opening_hours
  USING (organisation_id = current_org_id())
  WITH CHECK (organisation_id = current_org_id());

-- ── 3. chair_utilisation.chair_id ───────────────────────────────────────────
-- Every guard below RAISES rather than proceeding. A backfill that silently
-- merged two chairs' cells would destroy real data in a way nothing downstream
-- could detect. Measured on hosted 2026-09-08: 9 rows, 3 distinct chair names,
-- no collisions -- so all three guards pass, and they exist for the tenant this
-- migration meets next.

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM chair_utilisation
   WHERE chair_name IS NULL OR btrim(chair_name) = '';
  IF n > 0 THEN
    RAISE EXCEPTION 'chair_utilisation has % row(s) with no chair name; cannot derive a chair', n;
  END IF;
END $$;

INSERT INTO practice_chairs (organisation_id, practice_id, name)
SELECT DISTINCT cu.organisation_id, cu.practice_id, btrim(cu.chair_name)
  FROM chair_utilisation cu
ON CONFLICT (organisation_id, practice_id, lower(btrim(name))) DO NOTHING;

ALTER TABLE chair_utilisation
  ADD COLUMN IF NOT EXISTS chair_id UUID REFERENCES practice_chairs(id) ON DELETE CASCADE;

UPDATE chair_utilisation cu
   SET chair_id = pc.id
  FROM practice_chairs pc
 WHERE pc.organisation_id = cu.organisation_id
   AND pc.practice_id     = cu.practice_id
   AND lower(btrim(pc.name)) = lower(btrim(cu.chair_name))
   AND cu.chair_id IS DISTINCT FROM pc.id;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM chair_utilisation WHERE chair_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'chair_id backfill left % row(s) unresolved', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT 1 FROM chair_utilisation
     GROUP BY organisation_id, practice_id, chair_id, weekday, slot
    HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION
      'backfill would merge % cell group(s) from differently-spelled chair names; resolve the spellings first', n;
  END IF;
END $$;

ALTER TABLE chair_utilisation ALTER COLUMN chair_id SET NOT NULL;

-- Identity moves from the free-text name to the chair row, so a rename keeps
-- its history instead of forking a new chair.
DROP INDEX IF EXISTS uq_chair_util_cell;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chair_util_cell_chair
  ON chair_utilisation(organisation_id, practice_id, chair_id, weekday, slot);

-- ── 4. available_minutes is now dead, but NOT dropped ───────────────────────
-- Capacity comes from practice_opening_hours. The read path stops reading this
-- column entirely and a test asserts it. Dropping it is a separate migration
-- needing the owner's explicit sign-off on that exact statement.
COMMENT ON COLUMN chair_utilisation.available_minutes IS
  'DEPRECATED (migration 000184). Capacity is derived from practice_opening_hours; nothing reads this. Drop pending owner sign-off.';

NOTIFY pgrst, 'reload schema';
