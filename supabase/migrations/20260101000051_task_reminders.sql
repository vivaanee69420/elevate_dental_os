-- ============================================================================
-- 000051 — task reminder tracking
-- Adds reminder bookkeeping to tasks so the Task Manager can show
-- "X reminders sent / last reminded" and the nightly cron can throttle.
-- Idempotent: re-applies cleanly.
-- ============================================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_count INT NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
