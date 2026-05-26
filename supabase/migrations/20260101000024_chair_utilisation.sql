-- 20260101000024_chair_utilisation.sql
-- Manual chair utilisation: owner-entered booked vs available minutes per
-- practice + chair + weekday + slot. No Dentally involvement. Idempotent.

CREATE TABLE IF NOT EXISTS chair_utilisation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  chair_name TEXT NOT NULL,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- ISO 1=Mon..7=Sun
  slot TEXT NOT NULL CHECK (slot IN ('morning','midday','afternoon','evening')),
  booked_minutes INT NOT NULL DEFAULT 0 CHECK (booked_minutes >= 0),
  available_minutes INT NOT NULL DEFAULT 0 CHECK (available_minutes >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chair_util_cell
  ON chair_utilisation(organisation_id, practice_id, chair_name, weekday, slot);

DROP TRIGGER IF EXISTS chair_utilisation_updated_at ON chair_utilisation;
CREATE TRIGGER chair_utilisation_updated_at BEFORE UPDATE ON chair_utilisation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE chair_utilisation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chair_utilisation_org ON chair_utilisation;
CREATE POLICY chair_utilisation_org ON chair_utilisation
  USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());

NOTIFY pgrst, 'reload schema';
