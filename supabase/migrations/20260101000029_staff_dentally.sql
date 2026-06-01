-- 20260101000029_staff_dentally.sql
-- Make the `staff` table Dentally-syncable. Dentally `/users` is the practice
-- team roster (name, role, email, phone, practice, last_login). It does NOT
-- carry HR data — hourly rate, weekly hours, scheduled hours, attendance — so
-- those columns stay nullable / owner-entered (never sourced from Dentally).
-- Idempotent; re-applies cleanly.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS pms_external_id TEXT,
  -- Raw Dentally role string ("Dentist", "Receptionist", …). The enum `role`
  -- column is a coarse bucket; pms_role preserves the exact PMS label for display.
  ADD COLUMN IF NOT EXISTS pms_role TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Idempotent upsert arbiter for the sync. A FULL (non-partial) unique index so
-- supabase-js `.upsert({ onConflict })` can infer it. Manually-created staff
-- carry NULL source/pms_external_id; Postgres treats NULLs as distinct, so any
-- number of manual rows coexist while each synced (org, 'dentally', user-id) is
-- unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_src_ext
  ON staff(organisation_id, source, pms_external_id);

NOTIFY pgrst, 'reload schema';
