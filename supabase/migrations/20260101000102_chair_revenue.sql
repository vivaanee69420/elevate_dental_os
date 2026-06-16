-- 20260101000102_chair_revenue.sql
-- Manual per-slot revenue on the chair-utilisation grid. revenue_pence is the
-- typical-WEEK revenue earned by that chair + weekday + slot (matches the weekly
-- booked/available minutes). Yield/hr on Chair Efficiency is now derived from
-- this owner-entered figure (Σ revenue / Σ booked hrs) instead of settled
-- receipts. Integer pence, never floats. Idempotent.

ALTER TABLE chair_utilisation
  ADD COLUMN IF NOT EXISTS revenue_pence INT NOT NULL DEFAULT 0 CHECK (revenue_pence >= 0);

NOTIFY pgrst, 'reload schema';
